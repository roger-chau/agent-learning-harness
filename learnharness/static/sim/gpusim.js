/*
 * GPUSim: a teaching GPU simulator.
 *
 * Kernels are written in JavaScript with CUDA-style built-ins (threadIdx, blockIdx,
 * blockDim, gridDim). The simulator runs every thread, groups threads into warps of
 * 32, and reports what a performance engineer looks at:
 *   - global memory: warp-level memory instructions, 32-byte sector transactions,
 *     bytes requested vs bytes moved (coalescing efficiency)
 *   - control flow: warp-level branches and how many diverged
 *   - occupancy-ish counts: blocks, warps, idle lanes in partial warps
 *   - an estimated time from a simple roofline-style model
 *
 * Execution model (a deliberate simplification, explained in the course): threads of a
 * warp run one after another and their memory operations and branches are lined up by
 * order of execution. For code without divergence this matches lockstep hardware exactly.
 *
 * Works in the browser (window.GPUSim), in Web Workers, and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GPUSim = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_SPEC = Object.freeze({
    name: "GW-1 (simulated)",
    sms: 16,
    warpSize: 32,
    clockGHz: 1.5,
    dramBandwidthGBs: 512,
    dramLatencyCycles: 400,
    sectorBytes: 32,
    maxThreadsPerBlock: 1024,
    issuePerSmPerCycle: 1, // warp instructions issued per SM per cycle
    lanesPerSM: 32,        // FP32 lanes: peak = sms x lanes x 2 (FMA) x clock = 1536 GFLOP/s
    l2Bytes: 256 * 1024,
    l2BandwidthGBs: 1024,
    maxWarpsPerSM: 64,
    maxBlocksPerSM: 16,
    registersPerSM: 65536,
    registerAllocUnit: 256, // registers are allocated per warp in chunks of 256
    maxRegistersPerThread: 255,
    sharedPerSM: 65536,
    maxSharedPerBlock: 49152,
    sharedAllocUnit: 256,
    tensorFmaPerSmPerCycle: 256, // tensor cores: 8x the FP32 lanes (peak 12,288 GFLOP/s)
    sharedBanks: 32,
    // Wall clock (gpu.now / gpu.synchronize): launches are asynchronous and timings are noisy.
    launchOverheadUs: 4,    // host time to issue one launch
    moduleLoadUs: 150,      // extra device time the first time a kernel runs
    clockRampLaunches: 5,   // the first launches run at a lower clock while it ramps up
    jitter: 0.03,           // relative run-to-run noise
    outlierRate: 0.04,      // chance a run is interrupted and takes 1.5-3x longer
    seed: 1,
    pcieGBs: 25,            // host <-> device copies, each direction
  });

  const MAX_BRANCH_EVALS = 20_000_000;
  const TARGET = Symbol("gw.target");

  /** Round a number to the nearest IEEE half-precision value (round half to even). */
  function f16round(x) {
    if (!Number.isFinite(x) || x === 0) return x;
    const sgn = x < 0 ? -1 : 1, a = Math.abs(x);
    if (a >= 65520) return sgn * Infinity;
    let step;
    if (a < 6.103515625e-5) step = 5.960464477539063e-8; // subnormal spacing 2^-24
    else {
      let e = Math.floor(Math.log2(a));
      if (2 ** e > a) e--;
      if (2 ** (e + 1) <= a) e++;
      step = 2 ** (e - 10);
    }
    const q = a / step, f = Math.floor(q), d = q - f;
    const r = d > 0.5 || (d === 0.5 && f % 2 === 1) ? f + 1 : f;
    return sgn * r * step;
  }

  // ---------------------------------------------------------------------------
  // Source instrumentation: wrap `if`, `while`, `do..while` and `for` conditions so
  // every evaluation records (branch id, outcome) for the running thread.
  // Ternaries are left alone on purpose: compilers usually predicate them.
  // ---------------------------------------------------------------------------
  function instrument(src) {
    let nextId = 0;
    const sites = [];

    function skipString(s, i) {
      const q = s[i];
      i++;
      while (i < s.length) {
        if (s[i] === "\\") { i += 2; continue; }
        if (q === "`" && s[i] === "$" && s[i + 1] === "{") {
          i = matchBrace(s, i + 1) + 1;
          continue;
        }
        if (s[i] === q) return i + 1;
        i++;
      }
      return i;
    }
    function skipComment(s, i) {
      if (s[i + 1] === "/") { const j = s.indexOf("\n", i); return j < 0 ? s.length : j; }
      const j = s.indexOf("*/", i + 2);
      return j < 0 ? s.length : j + 2;
    }
    function matchBrace(s, i) { // s[i] === "{"
      let depth = 0;
      for (; i < s.length; i++) {
        const c = s[i];
        if (c === '"' || c === "'" || c === "`") { i = skipString(s, i) - 1; continue; }
        if (c === "/" && (s[i + 1] === "/" || s[i + 1] === "*")) { i = skipComment(s, i) - 1; continue; }
        if (c === "{") depth++;
        else if (c === "}" && --depth === 0) return i;
      }
      return s.length - 1;
    }
    function matchParen(s, i) { // s[i] === "("
      let depth = 0;
      for (; i < s.length; i++) {
        const c = s[i];
        if (c === '"' || c === "'" || c === "`") { i = skipString(s, i) - 1; continue; }
        if (c === "/" && (s[i + 1] === "/" || s[i + 1] === "*")) { i = skipComment(s, i) - 1; continue; }
        if (c === "(") depth++;
        else if (c === ")" && --depth === 0) return i;
      }
      throw new SyntaxError("Unbalanced parentheses in kernel source");
    }
    function lineOf(s, i) { let n = 1; for (let k = 0; k < i; k++) if (s[k] === "\n") n++; return n; }
    function skipWs(s, i) {
      for (;;) {
        while (i < s.length && /\s/.test(s[i])) i++;
        if (s[i] === "/" && (s[i + 1] === "/" || s[i + 1] === "*")) { i = skipComment(s, i); continue; }
        return i;
      }
    }
    // Index of the last character of the statement starting at (or after whitespace from) i.
    function stmtEnd(s, i) {
      i = skipWs(s, i);
      if (s[i] === "{") return matchBrace(s, i);
      const m = /^(if|for|while)\b/.exec(s.slice(i, i + 6));
      if (m && s[i + m[1].length] !== "." ) {
        const j = skipWs(s, i + m[1].length);
        if (s[j] === "(") {
          let end = stmtEnd(s, matchParen(s, j) + 1);
          if (m[1] === "if") {
            const k = skipWs(s, end + 1);
            if (/^else\b/.test(s.slice(k, k + 5))) end = stmtEnd(s, k + 4);
          }
          return end;
        }
      }
      let depth = 0;
      for (; i < s.length; i++) {
        const c = s[i];
        if (c === '"' || c === "'" || c === "`") { i = skipString(s, i) - 1; continue; }
        if (c === "/" && (s[i + 1] === "/" || s[i + 1] === "*")) { i = skipComment(s, i) - 1; continue; }
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") { if (depth === 0) return i - 1; depth--; }
        else if (c === ";" && depth === 0) return i;
      }
      return s.length - 1;
    }
    let nextSeg = 0;
    function wrap(cond, kind, line) {
      const id = nextId++;
      sites.push({ id, kind, line });
      return `__br(${id}, (${transform(cond, line)}))`;
    }
    function splitTopLevel(s, ch) {
      const parts = [];
      let depth = 0, last = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '"' || c === "'" || c === "`") { i = skipString(s, i) - 1; continue; }
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
        else if (c === ch && depth === 0) { parts.push(s.slice(last, i)); last = i + 1; }
      }
      parts.push(s.slice(last));
      return parts;
    }
    function transform(s, baseLine = 0) {
      let out = "";
      let i = 0;
      while (i < s.length) {
        const c = s[i];
        if (c === '"' || c === "'" || c === "`") { const j = skipString(s, i); out += s.slice(i, j); i = j; continue; }
        if (c === "/" && (s[i + 1] === "/" || s[i + 1] === "*")) { const j = skipComment(s, i); out += s.slice(i, j); i = j; continue; }
        const m = /^(if|while|for)\b/.exec(s.slice(i, i + 6));
        const prev = i > 0 ? s[i - 1] : " ";
        if (m && !/[\w$.]/.test(prev)) {
          const kw = m[1];
          let j = i + kw.length;
          while (j < s.length && /\s/.test(s[j])) j++;
          if (s[j] === "(") {
            const end = matchParen(s, j);
            const inner = s.slice(j + 1, end);
            const line = baseLine + lineOf(s, i);
            if (kw === "for") {
              const parts = splitTopLevel(inner, ";");
              // Like a compiler, fully "unroll" short loops with literal bounds: no branch is recorded.
              const lit = /^\s*(?:let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d+)\s*$/.exec(parts[0] || "");
              const cond = lit && /^\s*([A-Za-z_$][\w$]*)\s*(<=?)\s*(-?\d+)\s*$/.exec(parts[1] || "");
              const step = cond && new RegExp(`^\\s*(?:${lit[1]}\\+\\+|\\+\\+${lit[1]}|${lit[1]}\\s*\\+=\\s*1)\\s*$`).test(parts[2] || "");
              const trips = cond ? (+cond[3] + (cond[2] === "<=" ? 1 : 0)) - +lit[2] : Infinity;
              if (step && cond[1] === lit[1] && trips <= 64) {
                out += `for (${inner})`;
              } else if (parts.length === 3 && parts[1].trim()) {
                out += `for (${transform(parts[0], baseLine)};${wrap(parts[1], "for", line)};${transform(parts[2], baseLine)})`;
              } else {
                out += `for (${transform(inner, baseLine)})`;
              }
            } else {
              out += `${kw} (${wrap(inner, kw, line)})`;
            }
            // The statement's body (and else-chain), then a reconvergence marker after it.
            let sEnd = stmtEnd(s, end + 1);
            if (kw === "if") {
              const k = skipWs(s, sEnd + 1);
              if (/^else\b/.test(s.slice(k, k + 5))) sEnd = stmtEnd(s, k + 4);
            }
            out += transform(s.slice(end + 1, sEnd + 1), baseLine) + `;__seg(${nextSeg++});`;
            i = sEnd + 1;
            continue;
          }
        }
        out += c;
        i++;
      }
      return out;
    }
    const code = transform(src);
    return { code, sites };
  }

  function topLevelFunctionNames(src) {
    const names = [];
    const re = /(?:^|[\n;])\s*(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(src))) names.push(m[1]);
    const re2 = /(?:^|[\n;])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
    while ((m = re2.exec(src))) names.push(m[1]);
    return [...new Set(names)];
  }

  // ---------------------------------------------------------------------------
  // Buffers
  // ---------------------------------------------------------------------------
  const TYPES = {
    f32: Float32Array, f64: Float64Array, i32: Int32Array, u32: Uint32Array,
    u8: Uint8Array, i8: Int8Array, u16: Uint16Array, i16: Int16Array,
  };
  let bufferIds = 0;

  class Buffer {
    constructor(data, type) {
      this.id = ++bufferIds;
      this.type = type;
      this.data = data;
      this.bytesPerElement = data.BYTES_PER_ELEMENT;
    }
    get length() { return this.data.length; }
    toArray() { return Array.from(this.data); }
  }

  function dim3(v, name) {
    if (typeof v === "number") v = { x: v };
    if (!v || typeof v !== "object") throw new TypeError(`${name} must be a number or {x, y, z}`);
    const d = { x: v.x ?? 1, y: v.y ?? 1, z: v.z ?? 1 };
    for (const k of ["x", "y", "z"]) {
      if (!Number.isInteger(d[k]) || d[k] < 1) throw new RangeError(`${name}.${k} must be a positive integer (got ${d[k]})`);
    }
    return Object.freeze(d);
  }

  // ---------------------------------------------------------------------------
  // The device
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // __syncthreads(): kernels that call it become generator functions, and each call
  // becomes a `yield` that the launcher uses as a block-wide barrier.
  // ---------------------------------------------------------------------------
  function matchBraceSimple(s, i) {
    let depth = 0;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'" || c === "`") {
        i++;
        while (i < s.length && s[i] !== c) { if (s[i] === "\\") i++; i++; }
        continue;
      }
      if (c === "/" && s[i + 1] === "/") { const j = s.indexOf("\n", i); i = j < 0 ? s.length : j; continue; }
      if (c === "/" && s[i + 1] === "*") { const j = s.indexOf("*/", i + 2); i = j < 0 ? s.length : j + 1; continue; }
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return i;
    }
    return s.length - 1;
  }

  const WARP_OPS = ["__shfl_sync", "__shfl_down_sync", "__shfl_up_sync", "__shfl_xor_sync", "__ballot_sync", "__any_sync", "__all_sync", "__syncwarp", "__mma_sync"];
  const SYNC_RE = new RegExp(`\\b(__syncthreads|${WARP_OPS.join("|")})\\s*\\(`, "g");

  // The same text with the contents of strings, template literals and comments blanked out, so
  // code that merely mentions __syncthreads (e.g. a code generator) isn't treated as calling it.
  function maskStrings(s) {
    const out = s.split("");
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'" || c === "`") {
        let j = i + 1;
        while (j < s.length && s[j] !== c) { if (s[j] === "\\") j++; j++; }
        for (let k = i + 1; k < Math.min(j, s.length); k++) if (out[k] !== "\n") out[k] = " ";
        i = j; continue;
      }
      if (c === "/" && s[i + 1] === "/") { let j = s.indexOf("\n", i); if (j < 0) j = s.length; for (let k = i; k < j; k++) out[k] = " "; i = j; continue; }
      if (c === "/" && s[i + 1] === "*") { let j = s.indexOf("*/", i + 2); j = j < 0 ? s.length : j + 2; for (let k = i; k < j; k++) if (out[k] !== "\n") out[k] = " "; i = j - 1; continue; }
    }
    return out.join("");
  }

  // Rewrite each synchronising call `name(args)` into `(yield ["name", args])`.
  function rewriteSyncCalls(body) {
    let out = "", i = 0;
    SYNC_RE.lastIndex = 0;
    let m;
    const masked = maskStrings(body);
    while ((m = SYNC_RE.exec(masked))) {
      if (m.index > 0 && /[\w$.]/.test(body[m.index - 1])) continue;
      const open = m.index + m[0].length - 1;
      let depth = 0, j = open;
      for (; j < body.length; j++) {
        const c = body[j];
        if (c === '"' || c === "'" || c === "`") { j++; while (j < body.length && body[j] !== c) { if (body[j] === "\\") j++; j++; } continue; }
        if (c === "(") depth++;
        else if (c === ")" && --depth === 0) break;
      }
      const args = body.slice(open + 1, j).trim();
      const inner = rewriteSyncCalls(args);
      out += body.slice(i, m.index) + (m[1] === "__syncthreads" ? "(yield 0)" : `(yield [${JSON.stringify(m[1])}${inner ? ", " + inner : ""}])`);
      i = j + 1;
      SYNC_RE.lastIndex = j + 1;
    }
    return out + body.slice(i);
  }

  function barriersToYields(src) {
    const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
    let out = "", last = 0, m;
    while ((m = re.exec(src))) {
      const open = src.indexOf("{", re.lastIndex);
      if (open < 0) break;
      const close = matchBraceSimple(src, open);
      const body = src.slice(open, close + 1);
      SYNC_RE.lastIndex = 0;
      if (SYNC_RE.test(maskStrings(body))) {
        out += src.slice(last, m.index) + `function* ${m[1]}(` + src.slice(re.lastIndex, open) + rewriteSyncCalls(body);
        last = close + 1;
        re.lastIndex = close + 1;
      }
    }
    return out + src.slice(last);
  }

  const GeneratorFunction = Object.getPrototypeOf(function* () {}).constructor;

  // ---------------------------------------------------------------------------
  // L2 cache: a fully associative LRU cache of 32-byte sectors.
  // ---------------------------------------------------------------------------
  class SectorCache {
    constructor(bytes, sectorBytes) { this.cap = Math.max(1, Math.floor(bytes / sectorBytes)); this.map = new Map(); }
    access(key) {
      if (this.map.has(key)) { this.map.delete(key); this.map.set(key, 1); return true; }
      this.map.set(key, 1);
      if (this.map.size > this.cap) this.map.delete(this.map.keys().next().value);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Occupancy: how many blocks of a kernel fit on one SM, and what limits it.
  // ---------------------------------------------------------------------------
  function occupancy(spec, threadsPerBlock, registersPerThread = 32, sharedPerBlock = 0) {
    const s = { ...DEFAULT_SPEC, ...spec };
    const warpsPerBlock = Math.ceil(threadsPerBlock / s.warpSize);
    if (registersPerThread > s.maxRegistersPerThread) throw new RangeError(`at most ${s.maxRegistersPerThread} registers per thread`);
    const regsPerWarp = Math.ceil((registersPerThread * s.warpSize) / s.registerAllocUnit) * s.registerAllocUnit;
    const smem = sharedPerBlock ? Math.ceil(sharedPerBlock / s.sharedAllocUnit) * s.sharedAllocUnit : 0;
    const limits = {
      warps: Math.floor(s.maxWarpsPerSM / warpsPerBlock),
      blocks: s.maxBlocksPerSM,
      registers: regsPerWarp ? Math.floor(Math.floor(s.registersPerSM / regsPerWarp) / warpsPerBlock) : Infinity,
      sharedMemory: smem ? Math.floor(s.sharedPerSM / smem) : Infinity,
    };
    let limiter = "warps", blocksPerSM = Infinity;
    for (const [k, v] of Object.entries(limits)) if (v < blocksPerSM) { blocksPerSM = v; limiter = k; }
    const warpsPerSM = blocksPerSM * warpsPerBlock;
    return { blocksPerSM, warpsPerSM, warpsPerBlock, occupancy: warpsPerSM / s.maxWarpsPerSM, limiter, limits };
  }

  // ---------------------------------------------------------------------------
  // The device
  // ---------------------------------------------------------------------------
  class Device {
    constructor(spec = {}) {
      this.spec = Object.freeze({ ...DEFAULT_SPEC, ...spec });
      this.trace = false;
      // Wall-clock model: the host enqueues launches; the device runs them in order.
      this.hostUs = 0; this.deviceFreeUs = 0; this.launchCount = 0;
      this.loaded = new WeakSet();
      this.rngState = (this.spec.seed >>> 0) || 1;
    }

    /**
     * Streams: an in-order queue of copies and kernels. Different streams may overlap, limited by
     * the engines: one compute engine (kernels run one at a time) and one copy engine per
     * direction (host-to-device, device-to-host). Times are in µs on a device timeline that
     * starts at 0; gpu.streamTime() is when everything queued so far has finished.
     */
    stream(name) {
      if (!this._streams) this.resetStreams();
      const dev = this, st = { name: name || `stream ${this._streams.length}`, end: 0 };
      this._streams.push(st);
      const run = (engine, durUs, label) => {
        const start = Math.max(st.end, dev._engines[engine]);
        st.end = dev._engines[engine] = start + durUs;
        dev._streamTrace.push({ stream: st.name, engine, label, start: +start.toFixed(3), end: +st.end.toFixed(3) });
        return st.end;
      };
      return {
        name: st.name,
        /** Copy `bytes` between host and device: direction "h2d" or "d2h". */
        memcpy(bytes, direction) {
          if (direction !== "h2d" && direction !== "d2h") throw new TypeError('memcpy direction must be "h2d" or "d2h"');
          return run(direction, bytes / (dev.spec.pcieGBs * 1e3) + 1, `${direction} ${bytes} B`); // +1 µs per copy
        },
        /** Launch a kernel on this stream (runs it now; schedules its time on the timeline). */
        launch(kernel, config, ...args) {
          const s = dev.launch(kernel, config, ...args);
          run("compute", s.timeUs, kernel.name || "kernel");
          return s;
        },
        /** Make this stream wait until another stream's queued work is done (like an event). */
        waitFor(other) { const o = dev._streams.find((x) => x.name === other.name); st.end = Math.max(st.end, o ? o.end : 0); },
        get time() { return st.end; },
      };
    }
    resetStreams() { this._streams = []; this._engines = { compute: 0, h2d: 0, d2h: 0 }; this._streamTrace = []; }
    /** When all work queued on all streams has finished (µs). */
    streamTime() { return this._streams ? Math.max(0, ...this._streams.map((s) => s.end)) : 0; }
    /** Every queued operation: { stream, engine, label, start, end }. */
    streamTrace() { return (this._streamTrace || []).slice(); }

    rand() { // xorshift32, deterministic per device
      let x = this.rngState; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      this.rngState = x; return x / 4294967296;
    }

    /** Host wall-clock time in microseconds. Launches return before the kernel finishes. */
    now() { return +this.hostUs.toFixed(3); }

    /** Wait until every launched kernel has finished. */
    synchronize() { this.hostUs = Math.max(this.hostUs, this.deviceFreeUs); return this.now(); }

    /** Spend host time (e.g. CPU work between launches). */
    hostWork(us) { this.hostUs += Math.max(0, us); }

    _clockLaunch(kernel, kernelUs) {
      const sp = this.spec;
      const issued = this.hostUs + sp.launchOverheadUs;
      this.hostUs = issued;
      let t = kernelUs;
      if (this.launchCount < sp.clockRampLaunches) t *= 1.25 - (0.25 * this.launchCount) / sp.clockRampLaunches;
      this.launchCount++;
      const g = Math.sqrt(-2 * Math.log(1 - this.rand())) * Math.cos(2 * Math.PI * this.rand());
      t *= Math.max(0.5, 1 + sp.jitter * g);
      if (this.rand() < sp.outlierRate) t *= 1.5 + 1.5 * this.rand();
      if (!this.loaded.has(kernel)) { this.loaded.add(kernel); t += sp.moduleLoadUs; }
      this.deviceFreeUs = Math.max(this.deviceFreeUs, issued) + t;
    }

    alloc(n, type = "f32") {
      const T = TYPES[type];
      if (!T) throw new TypeError(`unknown type '${type}' (use ${Object.keys(TYPES).join(", ")})`);
      if (!Number.isInteger(n) || n < 0) throw new RangeError("alloc size must be a non-negative integer");
      return new Buffer(new T(n), type);
    }

    /** A deterministic RGB test image (u8, row-major, 3 bytes per pixel). */
    image(width, height) {
      return this.from(testImage(width, height), "u8");
    }

    from(arr, type = "f32") {
      const b = this.alloc(arr.length, type);
      b.data.set(arr);
      return b;
    }

    occupancy(threadsPerBlock, registersPerThread = 32, sharedPerBlock = 0) {
      return occupancy(this.spec, threadsPerBlock, registersPerThread, sharedPerBlock);
    }

    /** Compile kernel source; returns an object of the functions it defines. */
    compile(src, globals = {}) {
      const { code, sites } = instrument(barriersToYields(src));
      const names = topLevelFunctionNames(src);
      const rt = { br: (id, v) => v, seg: () => {}, shared: () => { throw new Error("shared() can only be used inside a kernel launch"); },
        atomic: () => { throw new Error("atomics can only be used inside a kernel launch"); },
        fma: (a, b, c) => a * b + c, f16: f16round,
        vec: () => { throw new Error("ldg4/stg4 can only be used inside a kernel launch"); } };
      const gNames = Object.keys(globals).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
      const factory = new Function(
        "__rt", ...gNames,
        `"use strict";
let threadIdx, blockIdx, blockDim, gridDim, warpSize;
const __br = (id, v) => __rt.br(id, v);
const __seg = (id) => __rt.seg(id);
const shared = (name, n, type) => __rt.shared(name, n, type);
const __syncthreads = () => { throw new Error("__syncthreads() must be called directly in the kernel function's own body, not inside a helper or callback"); };
${WARP_OPS.map((n) => `const ${n} = () => { throw new Error("${n}() must be called directly in the kernel function's own body, not inside a helper or callback"); };`).join("\n")}
const __threadfence = () => {};
const __threadfence_block = () => {};
const atomicAdd = (a, i, v) => __rt.atomic("add", a, i, v);
const atomicSub = (a, i, v) => __rt.atomic("sub", a, i, v);
const atomicMax = (a, i, v) => __rt.atomic("max", a, i, v);
const atomicMin = (a, i, v) => __rt.atomic("min", a, i, v);
const atomicExch = (a, i, v) => __rt.atomic("exch", a, i, v);
const atomicOr = (a, i, v) => __rt.atomic("or", a, i, v);
const atomicAnd = (a, i, v) => __rt.atomic("and", a, i, v);
const atomicCAS = (a, i, cmp, v) => __rt.atomic("cas", a, i, v, cmp);
const fma = (a, b, c) => __rt.fma(a, b, c);
const ldg4 = (a, i) => __rt.vec(a, i, null);
const stg4 = (a, i, v) => __rt.vec(a, i, v);
const f16 = (x) => __rt.f16(x);
const __set = (e) => { threadIdx = e.threadIdx; blockIdx = e.blockIdx; blockDim = e.blockDim; gridDim = e.gridDim; warpSize = e.warpSize; };
${code}
;return { __set, fns: { ${names.map((n) => `${n}: typeof ${n} === "undefined" ? undefined : ${n}`).join(", ")} } };`
      );
      const mod = factory(rt, ...gNames.map((k) => globals[k]));
      const fns = {};
      for (const [name, fn] of Object.entries(mod.fns)) {
        if (typeof fn === "function") {
          fns[name] = fn;
          Object.defineProperty(fn, "__gw", { value: { set: mod.__set, rt, sites }, enumerable: false });
        } else if (fn !== undefined) {
          fns[name] = fn;
        }
      }
      return fns;
    }

    /**
     * Launch a compiled kernel over a grid of blocks.
     * config: { grid, block, registers? (per thread, default 32), ilp? (independent memory
     *           requests in flight per warp, default 1) }
     * @returns stats object
     */
    launch(kernel, config, ...args) {
      if (typeof kernel !== "function" || !kernel.__gw) {
        throw new TypeError("launch() needs a kernel function compiled by the simulator");
      }
      const spec = this.spec;
      const grid = dim3(config && config.grid, "grid");
      const block = dim3(config && config.block, "block");
      const registers = (config && config.registers) || 32;
      const ilp = Math.max(1, (config && config.ilp) || 1);
      const threadsPerBlock = block.x * block.y * block.z;
      if (threadsPerBlock > spec.maxThreadsPerBlock) {
        throw new RangeError(`block has ${threadsPerBlock} threads; the maximum is ${spec.maxThreadsPerBlock}`);
      }
      const W = spec.warpSize;
      const { set, rt, sites } = kernel.__gw;
      const isGen = kernel instanceof GeneratorFunction;

      const stats = {
        threads: 0, blocks: grid.x * grid.y * grid.z, warps: 0, idleLanes: 0,
        memInstructions: 0, loads: 0, stores: 0, transactions: 0,
        bytesRequested: 0, bytesMoved: 0, dramBytes: 0, l2Hits: 0, l2Misses: 0,
        sharedLoads: 0, sharedStores: 0, sharedWavefronts: 0, bankConflicts: 0, barriers: 0,
        atomics: 0, globalAtomics: 0, atomicSerialization: 0, warpOps: 0,
        fmaInstructions: 0, flops: 0, tensorOps: 0,
        branches: 0, divergentBranches: 0,
        divergentSites: {}, sites, registers, ilp, sharedPerBlock: 0,
      };
      if (this.trace) stats.warpTrace = [];
      const l2 = new SectorCache(spec.l2Bytes, spec.sectorBytes);

      // Per-lane traces for the thread being executed.
      let lane = null;
      let branchEvals = 0;
      const prevBr = rt.br, prevShared = rt.shared;
      // Each lane's memory operations are keyed by the code segment they run in (which branch
      // outcome, or which reconvergence point, they follow) and their position in it, so lanes
      // line up by program location even after divergence.
      rt.br = (id, v) => {
        if (++branchEvals > MAX_BRANCH_EVALS) throw new Error("Execution limit reached: is there an infinite loop?");
        const n = lane.branchCount[id] = (lane.branchCount[id] || 0) + 1;
        lane.branches.push(id, n, v ? 1 : 0);
        lane.seg = ((id + 1) * 1e6 + n) * 2 + (v ? 1 : 0);
        lane.pos = 0;
        return v;
      };
      const prevSeg = rt.seg;
      rt.seg = (id) => {
        const n = lane.segCount[id] = (lane.segCount[id] || 0) + 1;
        lane.seg = -((id + 1) * 1e6 + n);
        lane.pos = 0;
      };

      const touch = (buf, idx, store) => {
        if (!Number.isInteger(idx)) throw new TypeError(`index ${idx} into a buffer is not an integer`);
        if (idx < 0 || idx >= buf.data.length) {
          throw new RangeError(`out-of-bounds ${store ? "write" : "read"}: index ${idx} into a buffer of length ${buf.data.length}`);
        }
        lane.mem.push(buf.id, idx * buf.bytesPerElement, buf.bytesPerElement, store ? 1 : 0, lane.seg * 1e4 + lane.pos++);
      };
      const isIndex = (p) => typeof p === "string" && p.length > 0 && p.length < 16 && /^-?\d+$/.test(p);
      const proxies = new Map();
      const wrapArg = (a) => {
        if (!(a instanceof Buffer)) return a;
        if (proxies.has(a.id)) return proxies.get(a.id);
        const px = new Proxy({}, {
          get(t, p) {
            if (isIndex(p)) { const i = +p; touch(a, i, false); return a.data[i]; }
            if (p === "length") return a.data.length;
            if (p === TARGET) return { kind: "global", buf: a };
            return undefined;
          },
          set(t, p, v) {
            if (isIndex(p)) { const i = +p; touch(a, i, true); a.data[i] = v; return true; }
            throw new TypeError(`can't set property '${String(p)}' on a device buffer`);
          },
        });
        proxies.set(a.id, px);
        return px;
      };
      const kargs = args.map(wrapArg);
      const bufById = new Map(args.filter((a) => a instanceof Buffer).map((a) => [a.id, a]));
      const sector = spec.sectorBytes;

      // Shared memory: per block, named arrays laid out one after another.
      let blockShared = null;
      rt.shared = (name, n, type = "f32") => {
        let s = blockShared.arrays.get(name);
        if (s) {
          if (s.data.length !== n) throw new RangeError(`shared("${name}") was declared with ${s.data.length} elements, now ${n}`);
          return s.proxy;
        }
        const T = TYPES[type];
        if (!T) throw new TypeError(`unknown type '${type}'`);
        if (!Number.isInteger(n) || n <= 0) throw new RangeError(`shared("${name}") needs a positive integer size`);
        const data = new T(n), base = blockShared.bytes, bpe = data.BYTES_PER_ELEMENT;
        blockShared.bytes += Math.ceil((n * bpe) / 16) * 16;
        if (blockShared.bytes > spec.maxSharedPerBlock) {
          throw new RangeError(`shared memory per block exceeds ${spec.maxSharedPerBlock} bytes`);
        }
        const check = (i, store) => {
          if (i < 0 || i >= n) throw new RangeError(`out-of-bounds shared ${store ? "write" : "read"}: index ${i} into shared("${name}") of length ${n}`);
          lane.smem.push(base + i * bpe, store ? 1 : 0, lane.seg * 1e4 + lane.pos++);
        };
        const proxy = new Proxy({}, {
          get(t, p) { if (isIndex(p)) { const i = +p; check(i, false); return data[i]; } if (p === "length") return n; if (p === TARGET) return { kind: "shared", data, base, bpe, n, name }; return undefined; },
          set(t, p, v) { if (isIndex(p)) { const i = +p; check(i, true); data[i] = v; return true; } throw new TypeError("can't set properties on shared memory"); },
        });
        s = { data, proxy };
        blockShared.arrays.set(name, s);
        return proxy;
      };

      const prevAtomic = rt.atomic;
      rt.atomic = (op, arr, i, v, cmp) => {
        const tg = arr && arr[TARGET];
        if (!tg) throw new TypeError("atomic operations need a device buffer or a shared() array as their first argument");
        if (!Number.isInteger(i)) throw new TypeError(`atomic index ${i} is not an integer`);
        let data;
        if (tg.kind === "global") {
          data = tg.buf.data;
          if (i < 0 || i >= data.length) throw new RangeError(`out-of-bounds atomic: index ${i} into a buffer of length ${data.length}`);
          lane.mem.push(tg.buf.id, i * tg.buf.bytesPerElement, tg.buf.bytesPerElement, 1, lane.seg * 1e4 + lane.pos);
          lane.atom.push(0, tg.buf.id * 1e9 + i, lane.seg * 1e4 + lane.pos++);
        } else {
          data = tg.data;
          if (i < 0 || i >= tg.n) throw new RangeError(`out-of-bounds shared atomic: index ${i} into shared("${tg.name}")`);
          lane.smem.push(tg.base + i * tg.bpe, 1, lane.seg * 1e4 + lane.pos);
          lane.atom.push(1, tg.base + i * tg.bpe, lane.seg * 1e4 + lane.pos++);
        }
        const old = data[i];
        switch (op) {
          case "add": data[i] = old + v; break;
          case "sub": data[i] = old - v; break;
          case "max": data[i] = Math.max(old, v); break;
          case "min": data[i] = Math.min(old, v); break;
          case "exch": data[i] = v; break;
          case "or": data[i] = old | v; break;
          case "and": data[i] = old & v; break;
          case "cas": if (old === cmp) data[i] = v; break;
        }
        return old;
      };

      const prevFma = rt.fma, prevVec = rt.vec;
      rt.fma = (a, b, c) => { lane.fma++; return a * b + c; };
      // 16-byte vector access: one instruction moves 4 consecutive elements (index must be a multiple of 4).
      rt.vec = (arr, i, v) => {
        const tg = arr && arr[TARGET];
        if (!tg) throw new TypeError("ldg4/stg4 need a device buffer or a shared() array");
        if (!Number.isInteger(i) || i % 4 !== 0) throw new RangeError(`vector access index ${i} must be a multiple of 4 (16-byte aligned)`);
        const store = v !== null && v !== undefined;
        if (tg.kind === "global") {
          const d = tg.buf.data;
          if (i < 0 || i + 3 >= d.length) throw new RangeError(`out-of-bounds vector ${store ? "write" : "read"} at ${i} (length ${d.length})`);
          lane.mem.push(tg.buf.id, i * tg.buf.bytesPerElement, 4 * tg.buf.bytesPerElement, store ? 1 : 0, lane.seg * 1e4 + lane.pos++);
          if (store) { for (let q = 0; q < 4; q++) d[i + q] = v[q]; return undefined; }
          return [d[i], d[i + 1], d[i + 2], d[i + 3]];
        }
        if (i < 0 || i + 3 >= tg.n) throw new RangeError(`out-of-bounds shared vector access at ${i} in shared("${tg.name}")`);
        // Shared memory serves 16-byte accesses in phases; account them as four word accesses.
        for (let q = 0; q < 4; q++) lane.smem.push(tg.base + (i + q) * tg.bpe, store ? 1 : 0, lane.seg * 1e4 + lane.pos++);
        if (store) { for (let q = 0; q < 4; q++) tg.data[i + q] = v[q]; return undefined; }
        return [tg.data[i], tg.data[i + 1], tg.data[i + 2], tg.data[i + 3]];
      };

      // Tensor-core MMA for one warp: C(16x16) += A(16x16) x B(16x16), FP16 inputs, FP32 accumulate.
      // Lane l holds accumulator row l>>1, columns (l&1)*8 .. +7 (8 values).
      const mma = (lanes) => {
        const [, sA, aOff, lda, sB, bOff, ldb] = lanes[0].wait;
        const A = sA && sA[TARGET], B = sB && sB[TARGET];
        if (!A || !B) throw new TypeError("__mma_sync needs shared() arrays or device buffers for A and B");
        const da = A.kind === "global" ? A.buf.data : A.data, db = B.kind === "global" ? B.buf.data : B.data;
        const a = new Float64Array(256), b = new Float64Array(256);
        for (let r = 0; r < 16; r++) for (let k = 0; k < 16; k++) {
          const ia = aOff + r * lda + k, ib = bOff + r * ldb + k;
          if (ia < 0 || ia >= da.length || ib < 0 || ib >= db.length) throw new RangeError("__mma_sync tile reads out of bounds");
          a[r * 16 + k] = f16round(da[ia]); b[r * 16 + k] = f16round(db[ib]);
        }
        stats.tensorOps++;
        if (A.kind === "shared" || B.kind === "shared") { stats.sharedLoads += 2; stats.sharedWavefronts += 16; }
        return lanes.map((t) => {
          const acc = t.wait[7];
          if (!Array.isArray(acc) || acc.length !== 8) throw new TypeError("__mma_sync's accumulator must be an array of 8 numbers per lane");
          const row = t.laneId >> 1, c0 = (t.laneId & 1) * 8, out = new Array(8);
          for (let j = 0; j < 8; j++) {
            let sum = acc[j];
            for (let k = 0; k < 16; k++) sum += a[row * 16 + k] * b[k * 16 + c0 + j];
            out[j] = Math.fround(sum);
          }
          return out;
        });
      };

      // Warp-level operations: all active lanes of a warp meet, then each gets its result.
      const resolveWarpOp = (lanes) => {
        const op = lanes[0].wait[0];
        for (const t of lanes) if (t.wait[0] !== op) throw new Error(`warp lanes reached different warp operations (${op} vs ${t.wait[0]}): is one inside a divergent branch?`);
        if (op === "__mma_sync") {
          if (lanes.length !== W) throw new Error("__mma_sync needs all 32 lanes of the warp");
          const res = mma(lanes);
          lanes.forEach((t, k) => { t.resume = res[k]; t.wait = null; });
          return;
        }
        stats.warpOps++;
        const byLane = new Map(lanes.map((t) => [t.laneId, t]));
        const val = (l, fallback) => (byLane.has(l) ? byLane.get(l).wait[2] : fallback);
        const results = lanes.map((t) => {
          const [, , v, x] = t.wait;
          let r;
          switch (op) {
            case "__shfl_sync": r = val(((x % W) + W) % W, v); break;
            case "__shfl_down_sync": r = t.laneId + x < W ? val(t.laneId + x, v) : v; break;
            case "__shfl_up_sync": r = t.laneId - x >= 0 ? val(t.laneId - x, v) : v; break;
            case "__shfl_xor_sync": r = val(t.laneId ^ x, v); break;
            case "__ballot_sync": r = lanes.reduce((m, u) => (u.wait[2] ? m | (1 << u.laneId) : m), 0) >>> 0; break;
            case "__any_sync": r = lanes.some((u) => u.wait[2]); break;
            case "__all_sync": r = lanes.every((u) => u.wait[2]); break;
            default: r = undefined;
          }
          return r;
        });
        lanes.forEach((t, k) => { t.resume = results[k]; t.wait = null; });
      };

      const nWarps = Math.ceil(threadsPerBlock / W);
      // Block execution order: in order by default; "shuffle" runs them in a random order, as real
      // hardware may, to expose code that wrongly assumes blocks run in index order.
      const order = [];
      for (let bz = 0; bz < grid.z; bz++) for (let by = 0; by < grid.y; by++) for (let bx = 0; bx < grid.x; bx++) order.push([bx, by, bz]);
      if (config && config.blockOrder === "shuffle") {
        let seed = (config.seed ?? 12345) >>> 0;
        for (let i = order.length - 1; i > 0; i--) {
          seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
          const j = seed % (i + 1);
          [order[i], order[j]] = [order[j], order[i]];
        }
      }
      // Per-block work, for scheduling blocks onto SMs in the time model.
      const issued = () => stats.memInstructions + stats.branches + stats.sharedWavefronts + stats.barriers + stats.warpOps + (stats.atomicSerialization - stats.atomics) + stats.fmaInstructions;
      const marks = [];
      try {
        for (const [bx, by, bz] of order) {
          marks.push([issued(), stats.tensorOps]);
          const blockIdx = Object.freeze({ x: bx, y: by, z: bz });
          blockShared = { arrays: new Map(), bytes: 0 };
          const threads = [];
          for (let tid = 0; tid < threadsPerBlock; tid++) {
            const threadIdx = Object.freeze({
              x: tid % block.x,
              y: Math.floor(tid / block.x) % block.y,
              z: Math.floor(tid / (block.x * block.y)),
            });
            threads.push({ threadIdx, laneId: tid % W, warp: Math.floor(tid / W), lane: { mem: [], smem: [], atom: [], branches: [], branchCount: {}, segCount: {}, seg: 0, pos: 0, fma: 0 }, it: null, done: false, wait: null, resume: undefined });
          }
          const ctx = (t) => { lane = t.lane; set({ threadIdx: t.threadIdx, blockIdx, blockDim: block, gridDim: grid, warpSize: W }); };
          const where = (t) => `block (${bx},${by},${bz}) thread (${t.threadIdx.x},${t.threadIdx.y},${t.threadIdx.z})`;
          const run = (t, fn) => { try { return fn(); } catch (e) { if (!e.__gwWhere) { e.message = `${e.message} [in ${where(t)}]`; e.__gwWhere = true; } throw e; } };

          if (!isGen) {
            for (const t of threads) { ctx(t); run(t, () => kernel(...kargs)); }
          } else {
            for (const t of threads) { ctx(t); t.it = run(t, () => kernel(...kargs)); }
            const warps = [];
            for (const t of threads) (warps[t.warp] ||= []).push(t);
            for (;;) {
              let progress = false;
              for (const t of threads) {
                if (t.done || t.wait !== null) continue;
                ctx(t);
                const r = run(t, () => t.it.next(t.resume));
                t.resume = undefined;
                progress = true;
                if (r.done) t.done = true; else t.wait = r.value;
              }
              // Warp operations resolve when every lane still running in the warp has reached one.
              for (const lanes of warps) {
                const live = lanes.filter((t) => !t.done);
                if (live.length && live.every((t) => Array.isArray(t.wait))) { resolveWarpOp(live); progress = true; }
              }
              const live = threads.filter((t) => !t.done);
              if (!live.length) break;
              if (live.every((t) => t.wait === 0)) {
                if (live.length < threads.length) {
                  const t = threads.find((x) => x.done);
                  throw new Error(`__syncthreads() deadlock: some threads of block (${bx},${by},${bz}) are waiting at a barrier but thread (${t.threadIdx.x},${t.threadIdx.y},${t.threadIdx.z}) has already finished. Is a __syncthreads() inside a branch or loop that not all threads take?`);
                }
                for (const t of live) t.wait = null;
                stats.barriers += nWarps;
                progress = true;
              }
              if (!progress) {
                const t = live.find((x) => x.wait !== null);
                throw new Error(`deadlock in block (${bx},${by},${bz}): threads are waiting at different synchronisation points (e.g. thread (${t.threadIdx.x},${t.threadIdx.y}) at ${t.wait === 0 ? "__syncthreads()" : t.wait[0]}). Are some lanes of a warp inside a branch the others skipped?`);
              }
            }
          }
          stats.sharedPerBlock = Math.max(stats.sharedPerBlock, blockShared.bytes);
          for (let w = 0; w < nWarps; w++) {
            stats.warps++;
            const lanes = threads.slice(w * W, w * W + W).map((t) => t.lane);
            stats.idleLanes += W - lanes.length;
            stats.threads += lanes.length;
            const divBefore = stats.divergentBranches;
            accountWarp(lanes, stats, sector, l2, spec.sharedBanks);
            if (this.trace) {
              const stores = {};
              for (const L of lanes) {
                for (let o = 0; o < L.mem.length; o += 5) {
                  if (!L.mem[o + 3]) continue;
                  const b = bufById.get(L.mem[o]);
                  (stores[L.mem[o]] ||= []).push(L.mem[o + 1] / b.bytesPerElement);
                }
              }
              stats.warpTrace.push({ block: blockIdx, warp: w, lanes: lanes.length, divergent: stats.divergentBranches - divBefore, stores });
            }
          }
        }
      } finally {
        rt.br = prevBr;
        rt.seg = prevSeg;
        rt.shared = prevShared;
        rt.atomic = prevAtomic;
        rt.fma = prevFma;
        rt.vec = prevVec;
      }

      // Occupancy and the time model.
      const occ = occupancy(spec, threadsPerBlock, registers, stats.sharedPerBlock);
      if (occ.blocksPerSM < 1) throw new RangeError(`a block doesn't fit on an SM (limited by ${occ.limiter})`);
      stats.blocksPerSM = occ.blocksPerSM;
      stats.occupancy = +occ.occupancy.toFixed(4);
      stats.occupancyLimiter = occ.limiter;
      const residentWarps = Math.min(stats.warps, spec.sms * occ.warpsPerSM);
      stats.residentWarps = residentWarps;

      // DRAM time: bandwidth-limited, or latency-limited when too few requests are in flight
      // (Little's law: bytes in flight = resident warps x bytes per warp request x ilp).
      const dramPeak = spec.dramBandwidthGBs / spec.clockGHz;               // bytes per cycle
      const bytesPerReq = stats.memInstructions ? stats.bytesMoved / stats.memInstructions : 0;
      const inFlight = residentWarps * bytesPerReq * ilp;
      const dramRate = Math.max(1e-9, Math.min(dramPeak, inFlight / spec.dramLatencyCycles));
      const dramCycles = stats.dramBytes / dramRate;
      const l2Cycles = stats.bytesMoved / (spec.l2BandwidthGBs / spec.clockGHz);
      const warpInstr = issued();
      // Blocks are dispatched in order, each to the SM with the least work so far. The busiest
      // SM sets the time: too few blocks leaves SMs idle, a partial last wave is the tail
      // effect, and uneven blocks are load imbalance.
      marks.push([warpInstr, stats.tensorOps]);
      const smIssue = new Float64Array(spec.sms), smTensor = new Float64Array(spec.sms);
      for (let b = 0; b + 1 < marks.length; b++) {
        const iw = (marks[b + 1][0] - marks[b][0]) / spec.issuePerSmPerCycle;
        const tw = ((marks[b + 1][1] - marks[b][1]) * 4096) / spec.tensorFmaPerSmPerCycle;
        let m = 0;
        for (let k = 1; k < spec.sms; k++) if (Math.max(smIssue[k], smTensor[k]) < Math.max(smIssue[m], smTensor[m])) m = k;
        smIssue[m] += iw; smTensor[m] += tw;
      }
      const issueCycles = Math.max(...smIssue), tensorCycles = Math.max(...smTensor);
      const smBusy = Array.from(smIssue, (v, k) => Math.max(v, smTensor[k]));
      const busiest = Math.max(...smBusy);
      stats.smBalance = busiest ? +(smBusy.reduce((a, b) => a + b, 0) / (spec.sms * busiest)).toFixed(4) : 1;
      const cycles = Math.max(dramCycles, l2Cycles, issueCycles, tensorCycles) + (stats.memInstructions ? spec.dramLatencyCycles : 0);
      const top = Math.max(dramCycles, l2Cycles, issueCycles, tensorCycles);
      stats.limitedBy = cycles === 0 ? "nothing"
        : top === dramCycles ? (dramRate < dramPeak ? "DRAM latency (too few requests in flight)" : "DRAM bandwidth")
        : top === l2Cycles ? "L2 bandwidth"
        : top === tensorCycles ? "tensor cores"
        : stats.fmaInstructions >= 0.5 * warpInstr ? "FP32 compute" : "instruction issue";
      stats.flops += stats.tensorOps * 2 * 4096;
      stats.cycles = Math.round(cycles);
      stats.timeUs = +(cycles / (spec.clockGHz * 1000)).toFixed(3);
      stats.coalescing = stats.bytesMoved ? +(stats.bytesRequested / stats.bytesMoved).toFixed(4) : 1;
      stats.l2HitRate = stats.l2Hits + stats.l2Misses ? +(stats.l2Hits / (stats.l2Hits + stats.l2Misses)).toFixed(4) : 0;
      stats.achievedBandwidthGBs = cycles ? +((stats.dramBytes / (cycles / spec.clockGHz))).toFixed(1) : 0;
      stats.percentOfPeakBandwidth = +((100 * stats.achievedBandwidthGBs) / spec.dramBandwidthGBs).toFixed(1);
      stats.divergence = stats.branches ? +(stats.divergentBranches / stats.branches).toFixed(4) : 0;
      stats.achievedGflops = cycles ? +((stats.flops / (cycles / spec.clockGHz))).toFixed(1) : 0;
      stats.percentOfPeakFp32 = +((100 * stats.achievedGflops) / (spec.sms * spec.lanesPerSM * 2 * spec.clockGHz)).toFixed(1);
      // "Speed of light": how busy each unit was, as % of the kernel's duration.
      const pct = (x) => (cycles ? +Math.min(100, (100 * x) / cycles).toFixed(1) : 0);
      stats.sol = { dram: pct(stats.dramBytes / dramPeak), l2: pct(l2Cycles), issue: pct(issueCycles), tensor: pct(tensorCycles) };
      this._clockLaunch(kernel, stats.timeUs);
      return stats;
    }
  }

  /** Procedural test image: gradient, shapes, a checkerboard and thin lines (plenty of edges). */
  function testImage(w, h) {
    const px = new Uint8Array(w * h * 3);
    const cx = w * 0.32, cy = h * 0.45, r = Math.min(w, h) * 0.22;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let R = 30 + (170 * x) / Math.max(1, w - 1), G = 40 + (140 * y) / Math.max(1, h - 1), B = 120;
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy < r * r) { R = 240; G = 200; B = 60; }
        if (x > w * 0.58 && x < w * 0.9 && y > h * 0.18 && y < h * 0.5) { R = 60; G = 190; B = 175; }
        if (x > w * 0.6 && y > h * 0.62 && y < h * 0.92 && x < w * 0.92) {
          const c = ((Math.floor(x / 6) + Math.floor(y / 6)) & 1) ? 230 : 25;
          R = G = B = c;
        }
        if (y % 23 === 7 && x < w * 0.5) { R = G = B = 250; }
        const o = (y * w + x) * 3;
        px[o] = R; px[o + 1] = G; px[o + 2] = B;
      }
    }
    return px;
  }

  /** Convert a buffer (1 or 3 channels) to RGBA bytes for display, scaling [min, max] to [0, 255]. */
  function toRGBA(data, w, h, channels = 1, min = null, max = null) {
    const n = w * h;
    if (data.length < n * channels) throw new RangeError(`show(): buffer has ${data.length} values, need ${n * channels}`);
    if (min === null || max === null) {
      if (data instanceof Uint8Array) { min = 0; max = 255; }
      else {
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < n * channels; i++) { const v = data[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        min = lo; max = hi > lo ? hi : lo + 1;
      }
    }
    const out = new Uint8ClampedArray(n * 4);
    const k = 255 / (max - min);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) out[i * 4 + c] = (data[i * channels + (channels === 3 ? c : 0)] - min) * k;
      out[i * 4 + 3] = 255;
    }
    return out;
  }

  /** Line up lanes' memory ops, shared-memory ops and branches by order and account them per warp. */
  function accountWarp(lanes, stats, sector, l2, banks = 32) {
    if (!lanes.length) return;
    // FMAs: lanes issue together, so the warp issues as many FMA instructions as its busiest lane.
    let fmaMax = 0;
    for (const L of lanes) { fmaMax = Math.max(fmaMax, L.fma); stats.flops += 2 * L.fma; }
    stats.fmaInstructions += fmaMax;
    // Global memory: operations with the same program-location key execute together.
    const memGroups = new Map(); // key -> Map(buf*2+store -> group)
    for (const L of lanes) {
      const m = L.mem;
      for (let o = 0; o < m.length; o += 5) {
        const buf = m[o], addr = m[o + 1], bytes = m[o + 2], st = m[o + 3], key = m[o + 4];
        let byBuf = memGroups.get(key);
        if (!byBuf) { byBuf = new Map(); memGroups.set(key, byBuf); }
        const bk = buf * 2 + st;
        let g = byBuf.get(bk);
        if (!g) { g = { sectors: new Set(), store: st, buf }; byBuf.set(bk, g); }
        g.sectors.add(Math.floor(addr / sector));
        const last = Math.floor((addr + bytes - 1) / sector);
        if (last !== Math.floor(addr / sector)) g.sectors.add(last);
        stats.bytesRequested += bytes;
      }
    }
    for (const byBuf of memGroups.values()) {
      for (const g of byBuf.values()) {
        stats.memInstructions++;
        if (g.store) stats.stores++; else stats.loads++;
        stats.transactions += g.sectors.size;
        stats.bytesMoved += g.sectors.size * sector;
        for (const s of g.sectors) {
          if (l2 && l2.access(g.buf * 1e10 + s)) stats.l2Hits++;
          else { stats.l2Misses++; stats.dramBytes += sector; }
        }
      }
    }
    // Shared memory: banks (32 by default) of 4-byte words. Lanes reading the same word share it
    // (broadcast); distinct words in the same bank are serialised (a bank conflict).
    const sGroups = new Map(); // key*2+store -> Map(bank -> Set(word))
    for (const L of lanes) {
      const m = L.smem;
      for (let o = 0; o < m.length; o += 3) {
        const word = Math.floor(m[o] / 4), bank = word % banks, k = m[o + 2] * 2 + m[o + 1];
        let g = sGroups.get(k);
        if (!g) { g = new Map(); sGroups.set(k, g); }
        if (!g.has(bank)) g.set(bank, new Set());
        g.get(bank).add(word);
      }
    }
    for (const [k, g] of sGroups) {
      let degree = 1;
      for (const words of g.values()) degree = Math.max(degree, words.size);
      if (((k % 2) + 2) % 2) stats.sharedStores++; else stats.sharedLoads++;
      stats.sharedWavefronts += degree;
      stats.bankConflicts += degree - 1;
    }
    // Atomics: lanes of one warp instruction that hit the same address are serialised.
    const aGroups = new Map();
    for (const L of lanes) {
      const m = L.atom;
      for (let o = 0; o < m.length; o += 3) {
        const k = m[o + 2] * 2 + m[o];
        let g = aGroups.get(k);
        if (!g) { g = new Map(); aGroups.set(k, g); }
        g.set(m[o + 1], (g.get(m[o + 1]) || 0) + 1);
      }
    }
    for (const [k, g] of aGroups) {
      stats.atomics++;
      if (((k % 2) + 2) % 2 === 0) stats.globalAtomics++;
      let worst = 1;
      for (const c of g.values()) worst = Math.max(worst, c);
      stats.atomicSerialization += worst;
    }
    // Branches: the n-th evaluation of branch site `id` in each lane executes together.
    const seen = new Map(); // "id#n" -> bitmask of outcomes (1 = some false, 2 = some true)
    for (const L of lanes) {
      const b = L.branches;
      for (let i = 0; i < b.length; i += 3) {
        const key = b[i] * 1e7 + b[i + 1];
        seen.set(key, (seen.get(key) || 0) | (b[i + 2] ? 2 : 1));
      }
    }
    for (const [key, mask] of seen) {
      stats.branches++;
      if (mask === 3) {
        stats.divergentBranches++;
        const id = Math.floor(key / 1e7);
        stats.divergentSites[id] = (stats.divergentSites[id] || 0) + 1;
      }
    }
  }

  return { Device, Buffer, DEFAULT_SPEC, instrument, topLevelFunctionNames, testImage, toRGBA, occupancy, barriersToYields, WARP_OPS, f16round };
});
