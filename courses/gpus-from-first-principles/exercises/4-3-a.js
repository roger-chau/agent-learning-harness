GW.exercise({
  id: "4-3-a",
  title: "Choosing a thread tile",
  file: "thread_tile.js",
  prompt: `
<ol>
<li><code>loadsPerFma(r, c)</code>: shared-memory loads per FMA for an r×c thread tile (one load per value; vector loads are ignored here).</li>
<li><code>registersFor(r, c)</code>: an estimate of registers per thread: r·c accumulators + r + c loaded operands + 16 for addresses and loop state.</li>
<li><code>bestThreadTile(maxRegs, candidates)</code>: among <code>[r, c]</code> candidates, the one with the fewest loads per FMA whose register estimate fits in <code>maxRegs</code>. Ties go to the earlier candidate; return <code>null</code> if none fit.</li>
<li><code>fmaShareCeiling(r, c, overheadPerK)</code>: the FMA share of issued instructions in the inner loop, when each k step issues the r·c FMAs, (r + c) / 4 vector loads, and <code>overheadPerK</code> other instructions.</li>
</ol>`,
  starter: `
function loadsPerFma(r, c) {
  // TODO
}
function registersFor(r, c) {
  // TODO
}
function bestThreadTile(maxRegs, candidates) {
  // TODO
}
function fmaShareCeiling(r, c, overheadPerK) {
  // TODO
}

function main() {
  for (const [r, c] of [[1, 1], [2, 2], [4, 4], [8, 8], [8, 4]]) print(r, c, loadsPerFma(r, c), registersFor(r, c), fmaShareCeiling(r, c, 0));
  print(bestThreadTile(64, [[2, 2], [4, 4], [8, 4], [8, 8]]));
}
`,
  tests(t) {
    const lp = t.fn("loadsPerFma"), rf = t.fn("registersFor"), bt = t.fn("bestThreadTile"), fs = t.fn("fmaShareCeiling");
    for (const [r, c, w] of [[1, 1, 2], [4, 4, 0.5], [8, 8, 0.25], [8, 4, 0.375]]) t.check(`loadsPerFma(${r}, ${c}) = ${w}`, t.approx(lp(r, c), w), `got ${lp(r, c)}`);
    t.check("registersFor(8, 8) = 96", rf(8, 8) === 96, `got ${rf(8, 8)}`);
    t.check("registersFor(4, 4) = 40", rf(4, 4) === 40, `got ${rf(4, 4)}`);
    const C = [[2, 2], [4, 4], [8, 4], [8, 8]];
    t.check("bestThreadTile(64) = [8, 4]", JSON.stringify(bt(64, C)) === "[8,4]", `got ${JSON.stringify(bt(64, C))}`);
    t.check("bestThreadTile(128) = [8, 8]", JSON.stringify(bt(128, C)) === "[8,8]", `got ${JSON.stringify(bt(128, C))}`);
    t.check("bestThreadTile(10) = null", bt(10, C) === null, `got ${JSON.stringify(bt(10, C))}`);
    t.check("fmaShareCeiling(4, 4, 0) = 16/18", t.approx(fs(4, 4, 0), 16 / 18), `got ${fs(4, 4, 0)}`);
    t.check("fmaShareCeiling(8, 8, 2) = 64/70", t.approx(fs(8, 8, 2), 64 / 70), `got ${fs(8, 8, 2)}`);
  },
});
