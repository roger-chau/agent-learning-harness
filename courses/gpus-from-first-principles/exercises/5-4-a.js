GW.exercise({
  id: "5-4-a",
  title: "Waves, tails and imbalance",
  file: "waves.js",
  prompt: `
<ol>
<li><code>waves(blocks, sms, perSm)</code> and <code>tailEfficiency(blocks, sms, perSm)</code>, as in the chapter.</li>
<li><code>makespan(work, sms)</code>: blocks with the given work are dispatched in order, each to the SM with the least work so far (ties: lowest SM index). Return the busiest SM's total.</li>
<li><code>split(work, k)</code>: each block's work divided into <code>k</code> equal blocks, in order.</li>
<li><code>bestTile(n, sms, eff)</code>: for an n×n GEMM with square tiles of size t (one tile per block, one block per SM at a time), time ∝ waves × t² / eff[t], where <code>eff</code> maps each candidate t to its per-tile efficiency. Return the t with the lowest time (ties: the larger t).</li>
</ol>`,
  starter: `
function waves(blocks, sms, perSm) {
  // TODO
}
function tailEfficiency(blocks, sms, perSm) {
  // TODO
}
function makespan(work, sms) {
  // TODO
}
function split(work, k) {
  // TODO
}
function bestTile(n, sms, eff) {
  // TODO
}

function main() {
  print(waves(25, 16, 1), tailEfficiency(25, 16, 1));
  const tri = Array.from({ length: 24 }, (_, i) => i + 1);
  print(makespan(tri, 16), makespan(split(tri, 4), 16));
  print(bestTile(320, 16, { 32: 0.6, 64: 0.85, 128: 1 }));
}
`,
  tests(t) {
    const w = t.fn("waves"), te = t.fn("tailEfficiency"), ms = t.fn("makespan"), sp = t.fn("split"), bt = t.fn("bestTile");
    t.check("waves(25, 16, 1) = 2", w(25, 16, 1) === 2, `got ${w(25, 16, 1)}`);
    t.check("waves(64, 16, 4) = 1", w(64, 16, 4) === 1, `got ${w(64, 16, 4)}`);
    t.check("tailEfficiency(25, 16, 1) = 25/32", t.approx(te(25, 16, 1), 25 / 32), `got ${te(25, 16, 1)}`);
    t.check("tailEfficiency(33, 16, 2) = 33/64", t.approx(te(33, 16, 2), 33 / 64), `got ${te(33, 16, 2)}`);
    t.check("makespan([5,1,1,1], 2) = 5", ms([5, 1, 1, 1], 2) === 5, `got ${ms([5, 1, 1, 1], 2)}`);
    t.check("makespan([1,1,1,5], 2) = 6", ms([1, 1, 1, 5], 2) === 6, `got ${ms([1, 1, 1, 5], 2)}`);
    const tri = Array.from({ length: 24 }, (_, i) => i + 1);
    t.check("makespan(1..24, 16) = 32", ms(tri, 16) === 32, `got ${ms(tri, 16)}`);
    const s4 = sp(tri, 4) || [];
    t.check("split(1..24, 4) has 96 blocks summing to 300", s4.length === 96 && t.approx(s4.reduce((a, b) => a + b, 0), 300) && t.approx(s4[0], 0.25) && t.approx(s4[95], 6), `got length ${s4.length}`);
    t.check("splitting helps: makespan(split(1..24, 4), 16) = 21", t.approx(ms(s4, 16), 21), `got ${ms(s4, 16)}`);
    const eff = { 32: 0.6, 64: 0.85, 128: 1 };
    for (const [n, want] of [[320, 64], [256, 64], [512, 128], [96, 32]]) t.check(`bestTile(${n}) = ${want}`, +bt(n, 16, eff) === want, `got ${bt(n, 16, eff)}`);
  },
});
