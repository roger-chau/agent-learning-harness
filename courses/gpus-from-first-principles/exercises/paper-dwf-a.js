GW.exercise({
  id: "paper-dwf-a",
  title: "Model dynamic warp formation",
  file: "dwf.js",
  prompt: `
<p><code>warps</code> is an array of warps; each warp is an array of 32 strings, <code>"A"</code> or <code>"B"</code>: the path each lane takes. Path A costs <code>cA</code> instructions, path B costs <code>cB</code>. Each function returns <strong>SIMD efficiency</strong>: useful lane-slots ÷ (32 × instructions issued).</p>
<ol>
<li><code>pdomEfficiency(warps, cA, cB)</code>: each warp runs A if any lane needs A, then B if any lane needs B.</li>
<li><code>idealEfficiency(warps, cA, cB)</code>: all A-threads regrouped into ⌈n<sub>A</sub>/32⌉ warps, all B-threads into ⌈n<sub>B</sub>/32⌉, ignoring lanes.</li>
<li><code>laneAwareEfficiency(warps, cA, cB)</code>: threads keep their lane; path A needs as many warps as the busiest lane has A-threads (same for B).</li>
</ol>
<p>Then use <code>main()</code> to compare a case where regrouping helps a lot with one where the lane constraint kills it.</p>`,
  starter: `
function pdomEfficiency(warps, cA, cB) {
  // TODO
}

function idealEfficiency(warps, cA, cB) {
  // TODO
}

function laneAwareEfficiency(warps, cA, cB) {
  // TODO
}

function main() {
  // Warp 0: lanes 0-15 take A. Warp 1: lanes 16-31 take A.
  const half = (lo) => Array.from({ length: 32 }, (_, l) => (l >= lo && l < lo + 16 ? "A" : "B"));
  const spread = [half(0), half(16)];
  // Both warps: lanes 0-15 take A (same lanes!)
  const sameLanes = [half(0), half(0)];
  for (const [name, w] of [["spread", spread], ["same lanes", sameLanes]]) {
    print(name, "PDOM", pdomEfficiency(w, 10, 10), "ideal", idealEfficiency(w, 10, 10), "lane-aware", laneAwareEfficiency(w, 10, 10));
  }
}
`,
  tests(t) {
    const pd = t.fn("pdomEfficiency"), id = t.fn("idealEfficiency"), la = t.fn("laneAwareEfficiency");
    const useful = (ws, a, b) => ws.flat().reduce((s, x) => s + (x === "A" ? a : b), 0);
    const refP = (ws, a, b) => useful(ws, a, b) / (32 * ws.reduce((s, w) => s + (w.includes("A") ? a : 0) + (w.includes("B") ? b : 0), 0));
    const refI = (ws, a, b) => {
      const nA = ws.flat().filter((x) => x === "A").length, nB = ws.flat().length - nA;
      return useful(ws, a, b) / (32 * (Math.ceil(nA / 32) * a + Math.ceil(nB / 32) * b));
    };
    const refL = (ws, a, b) => {
      let mA = 0, mB = 0;
      for (let l = 0; l < 32; l++) {
        let ca = 0, cb = 0;
        for (const w of ws) { if (w[l] === "A") ca++; else cb++; }
        mA = Math.max(mA, ca); mB = Math.max(mB, cb);
      }
      return useful(ws, a, b) / (32 * (mA * a + mB * b));
    };
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const half = (lo) => Array.from({ length: 32 }, (_, l) => (l >= lo && l < lo + 16 ? "A" : "B"));
    const cases = [
      ["two complementary halves", [half(0), half(16)], 10, 10],
      ["same lanes in both warps", [half(0), half(0)], 10, 10],
      ["all A", [Array(32).fill("A"), Array(32).fill("A")], 5, 50],
      ["random 8 warps", Array.from({ length: 8 }, () => Array.from({ length: 32 }, () => (rnd() < 0.3 ? "A" : "B"))), 12, 4],
      ["random 20 warps", Array.from({ length: 20 }, () => Array.from({ length: 32 }, () => (rnd() < 0.5 ? "A" : "B"))), 7, 7],
    ];
    for (const [name, ws, a, b] of cases) {
      t.check(`PDOM: ${name}`, t.approx(pd(ws, a, b), refP(ws, a, b), 1e-9), `got ${pd(ws, a, b)}, expected ${refP(ws, a, b).toFixed(4)}`);
      t.check(`ideal: ${name}`, t.approx(id(ws, a, b), refI(ws, a, b), 1e-9), `got ${id(ws, a, b)}, expected ${refI(ws, a, b).toFixed(4)}`);
      t.check(`lane-aware: ${name}`, t.approx(la(ws, a, b), refL(ws, a, b), 1e-9), `got ${la(ws, a, b)}, expected ${refL(ws, a, b).toFixed(4)}`);
    }
  },
});
