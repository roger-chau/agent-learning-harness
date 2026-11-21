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
