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
  });

  const MAX_BRANCH_EVALS = 20_000_000;

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
              if (parts.length === 3 && parts[1].trim()) {
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

  function barriersToYields(src) {
    const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
    const BAR = /\b__syncthreads\s*\(\s*\)/g;
    let out = "", last = 0, m;
    while ((m = re.exec(src))) {
      const open = src.indexOf("{", re.lastIndex);
      if (open < 0) break;
      const close = matchBraceSimple(src, open);
      const body = src.slice(open, close + 1);
      if (BAR.test(body)) {
        BAR.lastIndex = 0;
        out += src.slice(last, m.index) + `function* ${m[1]}(` + src.slice(re.lastIndex, open) + body.replace(BAR, "(yield 0)");
        last = close + 1;
        re.lastIndex = close + 1;
      }
      BAR.lastIndex = 0;
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
      const rt = { br: (id, v) => v, seg: () => {}, shared: () => { throw new Error("shared() can only be used inside a kernel launch"); } };
      const gNames = Object.keys(globals).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
      const factory = new Function(
        "__rt", ...gNames,
        `"use strict";
let threadIdx, blockIdx, blockDim, gridDim, warpSize;
const __br = (id, v) => __rt.br(id, v);
const __seg = (id) => __rt.seg(id);
const shared = (name, n, type) => __rt.shared(name, n, type);
const __syncthreads = () => { throw new Error("__syncthreads() must be called directly in the kernel function's own body, not inside a helper or callback"); };
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
        branches: 0, divergentBranches: 0,
        divergentSites: {}, sites, registers, sharedPerBlock: 0,
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
          get(t, p) { if (isIndex(p)) { const i = +p; check(i, false); return data[i]; } if (p === "length") return n; return undefined; },
          set(t, p, v) { if (isIndex(p)) { const i = +p; check(i, true); data[i] = v; return true; } throw new TypeError("can't set properties on shared memory"); },
        });
        s = { data, proxy };
        blockShared.arrays.set(name, s);
        return proxy;
      };

      const nWarps = Math.ceil(threadsPerBlock / W);
      try {
        for (let bz = 0; bz < grid.z; bz++) for (let by = 0; by < grid.y; by++) for (let bx = 0; bx < grid.x; bx++) {
          const blockIdx = Object.freeze({ x: bx, y: by, z: bz });
          blockShared = { arrays: new Map(), bytes: 0 };
          const threads = [];
          for (let tid = 0; tid < threadsPerBlock; tid++) {
            const threadIdx = Object.freeze({
              x: tid % block.x,
              y: Math.floor(tid / block.x) % block.y,
              z: Math.floor(tid / (block.x * block.y)),
            });
            threads.push({ threadIdx, lane: { mem: [], smem: [], branches: [], branchCount: {}, segCount: {}, seg: 0, pos: 0 }, it: null, done: false });
          }
          const ctx = (t) => { lane = t.lane; set({ threadIdx: t.threadIdx, blockIdx, blockDim: block, gridDim: grid, warpSize: W }); };
          const where = (t) => `block (${bx},${by},${bz}) thread (${t.threadIdx.x},${t.threadIdx.y},${t.threadIdx.z})`;
          const run = (t, fn) => { try { return fn(); } catch (e) { if (!e.__gwWhere) { e.message = `${e.message} [in ${where(t)}]`; e.__gwWhere = true; } throw e; } };

          if (!isGen) {
            for (const t of threads) { ctx(t); run(t, () => kernel(...kargs)); }
          } else {
            for (const t of threads) { ctx(t); t.it = run(t, () => kernel(...kargs)); }
            let phase = 0;
            for (;;) {
              let yielded = 0, finished = 0;
              for (const t of threads) {
                if (t.done) continue;
                ctx(t);
                const r = run(t, () => t.it.next());
                if (r.done) { t.done = true; finished++; } else yielded++;
              }
              if (yielded === 0) break;
              if (finished > 0 || threads.some((t) => t.done)) {
                const t = threads.find((x) => x.done);
                throw new Error(`__syncthreads() deadlock: some threads of block (${bx},${by},${bz}) reached barrier ${phase + 1} but thread (${t.threadIdx.x},${t.threadIdx.y},${t.threadIdx.z}) had already finished. Is a __syncthreads() inside a branch or loop that not all threads take?`);
              }
              phase++;
              stats.barriers += nWarps; // one barrier instruction per warp
            }
          }
          stats.sharedPerBlock = Math.max(stats.sharedPerBlock, blockShared.bytes);
          for (let w = 0; w < nWarps; w++) {
            stats.warps++;
            const lanes = threads.slice(w * W, w * W + W).map((t) => t.lane);
            stats.idleLanes += W - lanes.length;
            stats.threads += lanes.length;
            const divBefore = stats.divergentBranches;
            accountWarp(lanes, stats, sector, l2);
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
      const warpInstr = stats.memInstructions + stats.branches + stats.sharedWavefronts + stats.barriers;
      const issueCycles = warpInstr / (spec.sms * spec.issuePerSmPerCycle);
      const cycles = Math.max(dramCycles, l2Cycles, issueCycles) + (stats.memInstructions ? spec.dramLatencyCycles : 0);
      stats.limitedBy = cycles === 0 ? "nothing" : dramCycles >= l2Cycles && dramCycles >= issueCycles
        ? (dramRate < dramPeak ? "DRAM latency (too few requests in flight)" : "DRAM bandwidth")
        : l2Cycles >= issueCycles ? "L2 bandwidth" : "instruction issue";
      stats.cycles = Math.round(cycles);
      stats.timeUs = +(cycles / (spec.clockGHz * 1000)).toFixed(3);
      stats.coalescing = stats.bytesMoved ? +(stats.bytesRequested / stats.bytesMoved).toFixed(4) : 1;
      stats.l2HitRate = stats.l2Hits + stats.l2Misses ? +(stats.l2Hits / (stats.l2Hits + stats.l2Misses)).toFixed(4) : 0;
      stats.achievedBandwidthGBs = cycles ? +((stats.dramBytes / (cycles / spec.clockGHz))).toFixed(1) : 0;
      stats.percentOfPeakBandwidth = +((100 * stats.achievedBandwidthGBs) / spec.dramBandwidthGBs).toFixed(1);
      stats.divergence = stats.branches ? +(stats.divergentBranches / stats.branches).toFixed(4) : 0;
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
  function accountWarp(lanes, stats, sector, l2) {
    if (!lanes.length) return;
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
    // Shared memory: 32 banks of 4-byte words. Lanes reading the same word share it
    // (broadcast); distinct words in the same bank are serialised (a bank conflict).
    const sGroups = new Map(); // key*2+store -> Map(bank -> Set(word))
    for (const L of lanes) {
      const m = L.smem;
      for (let o = 0; o < m.length; o += 3) {
        const word = Math.floor(m[o] / 4), bank = word % 32, k = m[o + 2] * 2 + m[o + 1];
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

  return { Device, Buffer, DEFAULT_SPEC, instrument, topLevelFunctionNames, testImage, toRGBA, occupancy, barriersToYields };
});
