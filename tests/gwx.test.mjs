import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const GWX = require("../learnharness/static/sim/gwx.js");
const { Device } = require("../learnharness/static/sim/gpusim.js");

test("GWX: assembles, computes per lane, counts registers", () => {
  const p = GWX.assemble("ld.global %a, X[%tid]\nfma %b, %a, %a, 1\n// comment\nst.global Y[%tid], %b");
  assert.equal(p.instrs.length, 3);
  assert.deepEqual(p.registers.sort(), ["%a", "%b"]);
  const r = GWX.run(p, { buffers: { X: Array.from({ length: 32 }, (_, i) => i), Y: new Array(32).fill(0) } });
  assert.equal(r.buffers.Y[5], 26);
  assert.equal(r.byClass.fma, 1);
});

test("GWX: scoreboard latencies, warp interleaving, branches and barriers", () => {
  const one = GWX.run("ld.global %a, X[%tid]\nadd %b, %a, 1\nst.global Y[%tid], %b", { buffers: { X: new Array(64).fill(1), Y: new Array(64).fill(0) } });
  assert.equal(one.cycles, 406);  // load at 0, add waits until 400, store at 404, warp retires at 405
  const two = GWX.run("ld.global %a, X[%tid]\nadd %b, %a, 1\nst.global Y[%tid], %b", { warps: 2, buffers: { X: new Array(64).fill(1), Y: new Array(64).fill(0) } });
  assert.ok(two.cycles < 2 * one.cycles - 300); // the second warp's load overlaps the first's
  const loop = GWX.run("mov %i, 0\nl:\nadd %i, %i, 1\nsetp.lt %p, %i, 5\n@%p bra l\nst.global Y[%tid], %i", { buffers: { Y: new Array(32).fill(0) } });
  assert.equal(loop.buffers.Y[0], 5);
  const bar = GWX.run(".shared S 64\nst.shared S[%tid], %warp\nbar.sync\nadd %o, %tid, 32\nrem %o, %o, 64\nld.shared %v, S[%o]\nst.global Y[%tid], %v", { warps: 2, buffers: { Y: new Array(64).fill(-1) } });
  assert.equal(bar.buffers.Y[0], 1); assert.equal(bar.buffers.Y[40], 0);
  assert.throws(() => GWX.run("setp.lt %p, %lane, 3\n@%p bra x\nx:\nexit", {}), /divergent/);
  assert.throws(() => GWX.run("add %a, %b, %c", { warps: 2, registerFile: 128 }), /register file/);
});

test("GWX: shared-memory bank conflicts, vector loads, trace", () => {
  const prog = (s) => `.shared S 2048\nmul %a, %lane, ${s}\nld.shared %x, S[%a]\nst.global O[%tid], %x`;
  assert.equal(GWX.run(prog(1), { buffers: { O: new Array(32).fill(0) } }).bankConflicts, 0);
  assert.equal(GWX.run(prog(32), { buffers: { O: new Array(32).fill(0) } }).bankConflicts, 31);
  const v = GWX.run(".shared S 128\nshl %a, %lane, 2\nld.shared.v4 {%a0, %a1, %a2, %a3}, S[%a]\nadd %s, %a0, %a3\nst.global O[%tid], %s", { shared: { S: Array.from({ length: 128 }, (_, i) => i) }, buffers: { O: new Array(32).fill(0) }, trace: 10 });
  assert.equal(v.buffers.O[1], 4 + 7);
  assert.equal(v.trace.length, 4);
  assert.throws(() => GWX.run(".shared S 64\nld.shared.v4 {%a, %b, %c, %d}, S[%lane]", {}), /multiple of 4/);
});

test("simulator: code that only mentions __syncthreads in a string isn't a kernel generator", () => {
  const g = new Device();
  const F = g.compile("function gen() { return `function k(y) { __syncthreads(); y[threadIdx.x] = 1; }`; }");
  assert.equal(typeof F.gen(), "string");
  const k = g.compile(F.gen()).k, y = g.alloc(32);
  g.launch(k, { grid: 1, block: 32 }, y);
  assert.equal(y.data[7], 1);
});
