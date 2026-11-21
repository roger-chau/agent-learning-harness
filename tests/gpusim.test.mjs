import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Device, instrument } = require("../learnharness/static/sim/gpusim.js");

const gpu = new Device();

test("vector add is correct and fully coalesced", () => {
  const { add } = gpu.compile(`
    function add(a, b, c, n) {
      const i = blockIdx.x * blockDim.x + threadIdx.x;
      if (i < n) c[i] = a[i] + b[i];
    }`);
  const n = 1000;
  const a = gpu.from(Array.from({ length: n }, (_, i) => i));
  const b = gpu.from(Array.from({ length: n }, (_, i) => 2 * i));
  const c = gpu.alloc(n);
  const s = gpu.launch(add, { grid: Math.ceil(n / 256), block: 256 }, a, b, c, n);
  assert.deepEqual(c.toArray().slice(0, 4), [0, 3, 6, 9]);
  assert.equal(c.data[999], 2997);
  assert.equal(s.threads, 1024);
  assert.equal(s.warps, 32);
  // 1000 floats = 4000 B per array = 125 sectors; 3 arrays
  assert.equal(s.transactions, 375);
  assert.equal(s.coalescing, 1);
  // Only the warp straddling n=1000 (threads 992..1023) diverges.
  assert.equal(s.divergentBranches, 1);
});

test("strided access is uncoalesced", () => {
  const { copy } = gpu.compile(`
    function copy(src, dst, stride) {
      const i = blockIdx.x * blockDim.x + threadIdx.x;
      dst[i] = src[i * stride];
    }`);
  const src = gpu.alloc(32 * 8), dst = gpu.alloc(32);
  const s = gpu.launch(copy, { grid: 1, block: 32 }, src, dst, 8);
  // reads: 32 lanes, each in its own sector -> 32 transactions; writes: 4 sectors
  assert.equal(s.transactions, 36);
  assert.ok(s.coalescing < 0.3);
});

test("divergence detected on lane-dependent branch, not on uniform branch", () => {
  const { k } = gpu.compile(`
    function k(out) {
      const t = threadIdx.x;
      if (t % 2 === 0) out[t] = 1; else out[t] = 2;
      if (blockIdx.x === 0) out[t] += 1;
    }`);
  const out = gpu.alloc(64);
  const s = gpu.launch(k, { grid: 1, block: 64 }, out);
  assert.equal(s.branches, 4); // 2 sites x 2 warps
  assert.equal(s.divergentBranches, 2);
});

test("loop trip-count divergence", () => {
  const { k } = gpu.compile(`
    function k(out) {
      let acc = 0;
      for (let j = 0; j < threadIdx.x; j++) acc += j;
      out[threadIdx.x] = acc;
    }`);
  const out = gpu.alloc(32);
  const s = gpu.launch(k, { grid: 1, block: 32 }, out);
  assert.equal(out.data[4], 6);
  assert.ok(s.divergentBranches >= 30);
});

test("2D indexing and errors", () => {
  const { k } = gpu.compile(`
    function k(out, w) {
      const x = blockIdx.x * blockDim.x + threadIdx.x;
      const y = blockIdx.y * blockDim.y + threadIdx.y;
      out[y * w + x] = y * 100 + x;
    }`);
  const out = gpu.alloc(16 * 16);
  gpu.launch(k, { grid: { x: 2, y: 2 }, block: { x: 8, y: 8 } }, out, 16);
  assert.equal(out.data[5 * 16 + 9], 509);
  assert.throws(() => gpu.launch(k, { grid: { x: 3, y: 2 }, block: { x: 8, y: 8 } }, out, 16), /out-of-bounds/);
  assert.throws(() => gpu.launch(k, { grid: 1, block: 2048 }, out, 16), /maximum/);
});

test("instrumentation skips strings, comments and ternaries", () => {
  const { code, sites } = instrument(`// if (a) {}\nconst s = "while (x)"; const t = a ? 1 : 2; if (a && (b || c)) {} while(q) {}`);
  assert.equal(sites.length, 2);
  assert.ok(code.includes('"while (x)"'));
});

test("infinite loop is caught", () => {
  const { k } = gpu.compile(`function k() { while (true) {} }`);
  assert.throws(() => gpu.launch(k, { grid: 1, block: 1 }), /Execution limit/);
});

test("compiled helpers run outside a launch and globals are injected", () => {
  const out = [];
  const { f, main } = gpu.compile(`function f(x) { if (x > 1) return x * 2; return 0; }
function main() { print(f(3)); }`, { print: (v) => out.push(v) });
  assert.equal(f(5), 10);
  main();
  assert.deepEqual(out, [6]);
});

test("warp trace records stores and per-warp divergence; test image", () => {
  const g = new Device();
  g.trace = true;
  const { k } = g.compile(`function k(out, n) {
    const i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) out[i] = i;
  }`);
  const out = g.alloc(40);
  const s = g.launch(k, { grid: 2, block: 32 }, out, 40);
  assert.equal(s.warpTrace.length, 2);
  assert.equal(s.warpTrace[0].divergent, 0);
  assert.equal(s.warpTrace[1].divergent, 1);
  assert.deepEqual(s.warpTrace[1].stores[out.id], [32, 33, 34, 35, 36, 37, 38, 39]);
  const img = g.image(20, 10);
  assert.equal(img.length, 600);
  assert.equal(img.type, "u8");
});

const { occupancy, DEFAULT_SPEC } = require("../learnharness/static/sim/gpusim.js");

test("__syncthreads + shared memory: tiled transpose is correct; bank conflicts counted", () => {
  const g = new Device();
  const src = (pad) => `
    function tr(a, b, n) {
      const T = 32;
      const tile = shared("tile", T * (T + ${pad}));
      const x = blockIdx.x * T + threadIdx.x, y = blockIdx.y * T + threadIdx.y;
      tile[threadIdx.y * (T + ${pad}) + threadIdx.x] = a[y * n + x];
      __syncthreads();
      const ox = blockIdx.y * T + threadIdx.x, oy = blockIdx.x * T + threadIdx.y;
      b[oy * n + ox] = tile[threadIdx.x * (T + ${pad}) + threadIdx.y];
    }`;
  const n = 64;
  const a = g.from(Array.from({ length: n * n }, (_, i) => i));
  for (const pad of [0, 1]) {
    const { tr } = g.compile(src(pad));
    const b = g.alloc(n * n);
    const s = g.launch(tr, { grid: { x: 2, y: 2 }, block: { x: 32, y: 32 } }, a, b, n);
    let ok = true;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (b.data[y * n + x] !== a.data[x * n + y]) ok = false;
    assert.ok(ok, "transpose correct");
    assert.equal(s.coalescing, 1);
    assert.equal(s.barriers, 4 * 32);
    if (pad === 0) assert.equal(s.bankConflicts, 4 * 32 * 31); // column read: 32-way per warp
    else assert.equal(s.bankConflicts, 0);
  }
});

test("broadcast is not a conflict; barrier deadlock is detected", () => {
  const g = new Device();
  const { k } = g.compile(`function k(out) { const s = shared("s", 32); s[threadIdx.x] = threadIdx.x; __syncthreads(); out[threadIdx.x] = s[0]; }`);
  const out = g.alloc(32);
  const st = g.launch(k, { grid: 1, block: 32 }, out);
  assert.equal(st.bankConflicts, 0);
  assert.equal(out.data[5], 0);
  const { bad } = g.compile(`function bad(out) { if (threadIdx.x < 16) { __syncthreads(); } out[threadIdx.x] = 1; }`);
  assert.throws(() => g.launch(bad, { grid: 1, block: 32 }, out), /deadlock/);
});

test("occupancy calculator", () => {
  let o = occupancy(DEFAULT_SPEC, 256, 32, 0);
  assert.equal(o.blocksPerSM, 8); assert.equal(o.occupancy, 1);
  o = occupancy(DEFAULT_SPEC, 256, 64, 0);
  assert.equal(o.blocksPerSM, 4); assert.equal(o.limiter, "registers"); assert.equal(o.occupancy, 0.5);
  o = occupancy(DEFAULT_SPEC, 256, 80, 0); // 80*32 = 2560 regs/warp -> 25 warps -> 3 blocks
  assert.equal(o.blocksPerSM, 3);
  o = occupancy(DEFAULT_SPEC, 128, 32, 20000);
  assert.equal(o.blocksPerSM, 3); assert.equal(o.limiter, "sharedMemory");
  o = occupancy(DEFAULT_SPEC, 32, 16, 0);
  assert.equal(o.blocksPerSM, 16); assert.equal(o.limiter, "blocks"); assert.equal(o.occupancy, 0.25);
});

test("L2 hits on reuse; small launches are latency-limited", () => {
  const g = new Device();
  const { k } = g.compile(`function k(a, out, n) { const i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) out[i] = a[i % 64]; }`);
  const a = g.alloc(64), out = g.alloc(4096);
  const s = g.launch(k, { grid: 16, block: 256 }, a, out, 4096);
  assert.ok(s.l2HitRate > 0.4);
  const { v } = g.compile(`function v(a, b, n) { const i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) b[i] = a[i]; }`);
  const big = 1 << 18, x = g.alloc(big), y = g.alloc(big);
  const sBig = g.launch(v, { grid: big / 256, block: 256 }, x, y, big);
  const sSmall = g.launch(v, { grid: 4, block: 256 }, x, y, 1024);
  assert.ok(sBig.percentOfPeakBandwidth > 80, `big ${sBig.percentOfPeakBandwidth}`);
  assert.match(sSmall.limitedBy, /latency/);
});

test("warp shuffles, ballot and votes", () => {
  const g = new Device();
  const { k } = g.compile(`function k(x, out, flags) {
    const i = blockIdx.x * blockDim.x + threadIdx.x;
    let v = x[i];
    for (let d = 16; d > 0; d >>= 1) v += __shfl_down_sync(0xffffffff, v, d);
    const b = __ballot_sync(0xffffffff, x[i] > 2);
    const all = __all_sync(0xffffffff, x[i] >= 0);
    if (threadIdx.x % 32 === 0) { out[i / 32] = v; flags[i / 32] = b; }
    if (!all) out[0] = -1;
  }`);
  const x = g.from(Array.from({ length: 64 }, (_, i) => i % 5)), out = g.alloc(2), flags = g.alloc(2, "u32");
  const s = g.launch(k, { grid: 2, block: 32 }, x, out, flags);
  const want0 = Array.from({ length: 32 }, (_, i) => i % 5).reduce((a, b) => a + b, 0);
  assert.equal(out.data[0], want0);
  let m = 0; for (let l = 0; l < 32; l++) if (l % 5 > 2) m |= 1 << l;
  assert.equal(flags.data[0], m >>> 0);
  assert.equal(s.warpOps, 2 * (5 + 2));
});

test("atomics: correct totals and contention counted", () => {
  const g = new Device();
  const { h } = g.compile(`function h(x, bins, n) { const i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) atomicAdd(bins, x[i], 1); }`);
  const n = 4096;
  const x1 = g.from(Array.from({ length: n }, (_, i) => i % 256), "i32"), x2 = g.from(Array(n).fill(7), "i32");
  const b1 = g.alloc(256, "u32"), b2 = g.alloc(256, "u32");
  const s1 = g.launch(h, { grid: n / 256, block: 256 }, x1, b1, n);
  const s2 = g.launch(h, { grid: n / 256, block: 256 }, x2, b2, n);
  assert.equal(b1.data[3], 16); assert.equal(b2.data[7], n);
  assert.equal(s1.atomicSerialization, s1.atomics); // distinct addresses per warp
  assert.equal(s2.atomicSerialization, s2.atomics * 32); // all lanes collide
  assert.ok(s2.cycles > s1.cycles);
  const { sh } = g.compile(`function sh(x, bins, n) {
    const local = shared("b", 256, "u32");
    for (let k = threadIdx.x; k < 256; k += blockDim.x) local[k] = 0;
    __syncthreads();
    const i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) atomicAdd(local, x[i], 1);
    __syncthreads();
    for (let k = threadIdx.x; k < 256; k += blockDim.x) if (local[k]) atomicAdd(bins, k, local[k]);
  }`);
  const b3 = g.alloc(256, "u32");
  g.launch(sh, { grid: n / 256, block: 256 }, x2, b3, n);
  assert.equal(b3.data[7], n);
});

test("shuffled block order and warp-op deadlock detection", () => {
  const g = new Device();
  const { k } = g.compile(`function k(order, ctr) { if (threadIdx.x === 0) order[blockIdx.x] = atomicAdd(ctr, 0, 1); }`);
  const order = g.alloc(16, "i32"), ctr = g.alloc(1, "i32");
  g.launch(k, { grid: 16, block: 32, blockOrder: "shuffle", seed: 3 }, order, ctr);
  const seq = order.toArray();
  assert.deepEqual([...seq].sort((a, b) => a - b), [...Array(16).keys()]);
  assert.notDeepEqual(seq, [...Array(16).keys()]);
  const { bad } = g.compile(`function bad(out) { if (threadIdx.x < 16) { out[threadIdx.x] = __shfl_sync(0xffff, threadIdx.x, 0); } else { __syncthreads(); } }`);
  assert.throws(() => g.launch(bad, { grid: 1, block: 32 }, g.alloc(32)), /deadlock|different/);
});

const { f16round } = require("../learnharness/static/sim/gpusim.js");

test("fma counting, vector loads, f16 rounding and tensor-core mma", () => {
  const g = new Device();
  const { dot } = g.compile(`function dot(a, b, out, n) {
    const i = blockIdx.x * blockDim.x + threadIdx.x;
    let s = 0;
    for (let k = 0; k < 8; k++) s = fma(a[i * 8 + k], b[k], s);
    out[i] = s;
  }`);
  const a = g.from(Array.from({ length: 64 * 8 }, (_, i) => i % 3)), b = g.from([1, 2, 3, 4, 5, 6, 7, 8]), out = g.alloc(64);
  const s = g.launch(dot, { grid: 1, block: 64 }, a, b, out, 64);
  assert.equal(s.fmaInstructions, 2 * 8);
  assert.equal(s.flops, 64 * 8 * 2);
  const { v4 } = g.compile(`function v4(a, b) { const i = (blockIdx.x * blockDim.x + threadIdx.x) * 4; const q = ldg4(a, i); stg4(b, i, [q[3], q[2], q[1], q[0]]); }`);
  const x = g.from(Array.from({ length: 128 }, (_, i) => i)), y = g.alloc(128);
  const sv = g.launch(v4, { grid: 1, block: 32 }, x, y);
  assert.deepEqual(y.toArray().slice(0, 4), [3, 2, 1, 0]);
  assert.equal(sv.memInstructions, 2); assert.equal(sv.transactions, 32); assert.equal(sv.coalescing, 1);
  assert.throws(() => g.launch(v4, { grid: 1, block: 33 }, x, y), /out-of-bounds|multiple/);
  assert.equal(f16round(1 + 2 ** -11), 1); assert.equal(f16round(1 + 3 * 2 ** -11), 1 + 2 ** -9); assert.equal(f16round(70000), Infinity);
  const { mm } = g.compile(`function mm(A, B, C) {
    const lane = threadIdx.x;
    let acc = [0, 0, 0, 0, 0, 0, 0, 0];
    acc = __mma_sync(A, 0, 16, B, 0, 16, acc);
    for (let j = 0; j < 8; j++) C[(lane >> 1) * 16 + (lane & 1) * 8 + j] = acc[j];
  }`);
  const A = g.from(Array.from({ length: 256 }, (_, i) => (i % 7) / 4)), B = g.from(Array.from({ length: 256 }, (_, i) => (i % 5) - 2)), C = g.alloc(256);
  const sm = g.launch(mm, { grid: 1, block: 32 }, A, B, C);
  let ok = true;
  for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) { let w = 0; for (let k = 0; k < 16; k++) w += A.data[r * 16 + k] * B.data[k * 16 + c]; if (Math.abs(C.data[r * 16 + c] - w) > 1e-3) ok = false; }
  assert.ok(ok);
  assert.equal(sm.tensorOps, 1);
});

test("wall clock: async launches, warm-up, synchronise; sol, balance and bank count", () => {
  const g = new Device({ jitter: 0, outlierRate: 0 });
  const { k } = g.compile(`function k(x, y, n) { const i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) y[i] = x[i]; }`);
  const n = 1 << 14, x = g.from(new Array(n).fill(1)), y = g.alloc(n);
  const t0 = g.now(); const s = g.launch(k, { grid: n / 256, block: 256 }, x, y, n);
  assert.equal(g.now() - t0, g.spec.launchOverheadUs);           // launch returns before the kernel runs
  const first = g.synchronize() - t0;
  assert.ok(first > g.spec.moduleLoadUs);                         // first launch loads the module
  for (let i = 0; i < 10; i++) g.launch(k, { grid: n / 256, block: 256 }, x, y, n);
  g.synchronize();
  const t1 = g.now(); g.launch(k, { grid: n / 256, block: 256 }, x, y, n); g.synchronize();
  assert.ok(Math.abs(g.now() - t1 - (g.spec.launchOverheadUs + s.timeUs)) < 1e-6); // warm, no noise
  assert.ok(s.sol.dram > 0 && s.sol.dram <= 100 && s.sol.issue > 0);
  // uneven blocks: one heavy block dominates the busiest SM
  const { uneven } = g.compile(`function uneven(y) { let a = 0; const m = blockIdx.x === 0 ? 4000 : 10; for (let i = 0; i < m; i++) a = fma(a, 1, 1); y[threadIdx.x] = a; }`);
  const su = g.launch(uneven, { grid: 16, block: 32 }, g.alloc(32));
  assert.ok(su.smBalance < 0.1);
  const se = g.launch(uneven, { grid: 1, block: 32 }, g.alloc(32));
  assert.equal(se.smBalance, 0.0625);
  // configurable bank count
  const { b } = g.compile(`function b(y) { const s = shared("s", 1024); y[threadIdx.x] = s[threadIdx.x * 16]; }`);
  assert.equal(new Device({ sharedBanks: 32 }).launch(b, { grid: 1, block: 32 }, g.alloc(32)).bankConflicts, 15);
  assert.equal(new Device({ sharedBanks: 16 }).launch(b, { grid: 1, block: 32 }, g.alloc(32)).bankConflicts, 31);
});
