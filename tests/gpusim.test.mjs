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
