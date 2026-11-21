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
            i = end + 1;
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
  class Device {
    constructor(spec = {}) {
      this.spec = Object.freeze({ ...DEFAULT_SPEC, ...spec });
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

    /** Compile kernel source; returns an object of the functions it defines. */
    compile(src, globals = {}) {
      const { code, sites } = instrument(src);
      const names = topLevelFunctionNames(src);
      const rt = { br: (id, v) => v }; // pass-through outside a launch
      const gNames = Object.keys(globals).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
      const factory = new Function(
        "__rt", ...gNames,
        `"use strict";
let threadIdx, blockIdx, blockDim, gridDim, warpSize;
const __br = (id, v) => __rt.br(id, v);
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
     * @returns stats object
     */
    launch(kernel, config, ...args) {
      if (typeof kernel !== "function" || !kernel.__gw) {
        throw new TypeError("launch() needs a kernel function compiled by the simulator");
      }
      const spec = this.spec;
      const grid = dim3(config && config.grid, "grid");
      const block = dim3(config && config.block, "block");
      const threadsPerBlock = block.x * block.y * block.z;
      if (threadsPerBlock > spec.maxThreadsPerBlock) {
        throw new RangeError(`block has ${threadsPerBlock} threads; the maximum is ${spec.maxThreadsPerBlock}`);
      }
      const W = spec.warpSize;
      const { set, rt, sites } = kernel.__gw;

      const stats = {
        threads: 0, blocks: grid.x * grid.y * grid.z, warps: 0, idleLanes: 0,
        memInstructions: 0, loads: 0, stores: 0, transactions: 0,
        bytesRequested: 0, bytesMoved: 0,
        branches: 0, divergentBranches: 0,
        divergentSites: {}, sites,
      };

      // Per-lane traces for the warp being executed.
      let lane = null;
      let branchEvals = 0;
      rt.br = (id, v) => {
        if (++branchEvals > MAX_BRANCH_EVALS) throw new Error("Execution limit reached: is there an infinite loop?");
        const n = lane.branchCount[id] = (lane.branchCount[id] || 0) + 1;
        lane.branches.push(id, n, v ? 1 : 0);
        return v;
      };

      const touch = (buf, idx, store) => {
        if (!Number.isInteger(idx)) throw new TypeError(`index ${idx} into a buffer is not an integer`);
        if (idx < 0 || idx >= buf.data.length) {
          throw new RangeError(`out-of-bounds ${store ? "write" : "read"}: index ${idx} into a buffer of length ${buf.data.length}`);
        }
        lane.mem.push(buf.id, idx * buf.bytesPerElement, buf.bytesPerElement, store ? 1 : 0);
      };

      const proxies = new Map();
      const wrapArg = (a) => {
        if (!(a instanceof Buffer)) return a;
        if (proxies.has(a.id)) return proxies.get(a.id);
        const handler = {
          get(t, p) {
            if (typeof p === "string" && /^-?\d+$/.test(p)) { const i = +p; touch(a, i, false); return a.data[i]; }
            if (p === "length") return a.data.length;
            return undefined;
          },
          set(t, p, v) {
            if (typeof p === "string" && /^-?\d+$/.test(p)) { const i = +p; touch(a, i, true); a.data[i] = v; return true; }
            throw new TypeError(`can't set property '${String(p)}' on a device buffer`);
          },
        };
        const px = new Proxy({}, handler);
        proxies.set(a.id, px);
        return px;
      };
      const kargs = args.map(wrapArg);
      const bufById = new Map(args.filter((a) => a instanceof Buffer).map((a) => [a.id, a]));
      if (this.trace) stats.warpTrace = [];
      const prevBr = rt.br;
      const sector = spec.sectorBytes;

      for (let bz = 0; bz < grid.z; bz++) for (let by = 0; by < grid.y; by++) for (let bx = 0; bx < grid.x; bx++) {
        const blockIdx = Object.freeze({ x: bx, y: by, z: bz });
        const nWarps = Math.ceil(threadsPerBlock / W);
        for (let w = 0; w < nWarps; w++) {
          stats.warps++;
          const lanes = [];
          for (let l = 0; l < W; l++) {
            const tid = w * W + l;
            if (tid >= threadsPerBlock) { stats.idleLanes++; continue; }
            const threadIdx = Object.freeze({
              x: tid % block.x,
              y: Math.floor(tid / block.x) % block.y,
              z: Math.floor(tid / (block.x * block.y)),
            });
            lane = { mem: [], branches: [], branchCount: {} };
            set({ threadIdx, blockIdx, blockDim: block, gridDim: grid, warpSize: W });
            try {
              kernel(...kargs);
            } catch (e) {
              rt.br = prevBr;
              const where = `block (${bx},${by},${bz}) thread (${threadIdx.x},${threadIdx.y},${threadIdx.z})`;
              e.message = `${e.message} [in ${where}]`;
              throw e;
            }
            lanes.push(lane);
            stats.threads++;
          }
          const divBefore = stats.divergentBranches;
          accountWarp(lanes, stats, sector);
          if (this.trace) {
            // Per-warp record: which elements each buffer received writes to, and divergence.
            const stores = {};
            for (const L of lanes) {
              for (let o = 0; o < L.mem.length; o += 4) {
                if (!L.mem[o + 3]) continue;
                const b = bufById.get(L.mem[o]);
                (stores[L.mem[o]] ||= []).push(L.mem[o + 1] / b.bytesPerElement);
              }
            }
            stats.warpTrace.push({ block: blockIdx, warp: w, lanes: lanes.length, divergent: stats.divergentBranches - divBefore, stores });
          }
        }
      }
      rt.br = prevBr;

      // Simple time model: the kernel is limited by DRAM bandwidth or by warp-instruction
      // issue, plus one exposed memory latency.
      const bytesPerCycle = spec.dramBandwidthGBs / spec.clockGHz;
      const memCycles = stats.bytesMoved / bytesPerCycle;
      const warpInstr = stats.memInstructions + stats.branches;
      const issueCycles = warpInstr / (spec.sms * spec.issuePerSmPerCycle);
      const cycles = Math.max(memCycles, issueCycles) + (stats.memInstructions ? spec.dramLatencyCycles : 0);
      stats.cycles = Math.round(cycles);
      stats.timeUs = +(cycles / (spec.clockGHz * 1000)).toFixed(3);
      stats.coalescing = stats.bytesMoved ? +(stats.bytesRequested / stats.bytesMoved).toFixed(4) : 1;
      stats.achievedBandwidthGBs = cycles ? +((stats.bytesMoved / (cycles / spec.clockGHz))).toFixed(1) : 0;
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

  /** Line up lanes' memory ops and branches by order and account them per warp. */
  function accountWarp(lanes, stats, sector) {
    if (!lanes.length) return;
    // Memory: k-th memory op of each lane executes together.
    let maxOps = 0;
    for (const L of lanes) maxOps = Math.max(maxOps, L.mem.length / 4);
    for (let k = 0; k < maxOps; k++) {
      const groups = new Map(); // key buf:store -> Set(sector)
      for (const L of lanes) {
        const o = k * 4;
        if (o >= L.mem.length) continue;
        const buf = L.mem[o], addr = L.mem[o + 1], bytes = L.mem[o + 2], st = L.mem[o + 3];
        const key = buf * 2 + st;
        let g = groups.get(key);
        if (!g) { g = { sectors: new Set(), store: st }; groups.set(key, g); }
        g.sectors.add(Math.floor(addr / sector));
        const last = Math.floor((addr + bytes - 1) / sector);
        if (last !== Math.floor(addr / sector)) g.sectors.add(last);
        stats.bytesRequested += bytes;
      }
      for (const g of groups.values()) {
        stats.memInstructions++;
        if (g.store) stats.stores++; else stats.loads++;
        stats.transactions += g.sectors.size;
        stats.bytesMoved += g.sectors.size * sector;
      }
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

  return { Device, Buffer, DEFAULT_SPEC, instrument, topLevelFunctionNames, testImage, toRGBA };
});
