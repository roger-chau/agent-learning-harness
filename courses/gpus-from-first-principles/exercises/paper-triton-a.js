GW.exercise({
  id: "paper-triton-a",
  title: "Grouped program ordering",
  file: "grouped.js",
  prompt: `
<p>A matmul has <code>numM × numN</code> output tiles, one program each, launched in order <code>pid = 0, 1, 2, …</code>.</p>
<ol>
<li><code>rowMajor(pid, numM, numN)</code>: <code>{ m, n }</code> = (⌊pid / numN⌋, pid mod numN).</li>
<li><code>grouped(pid, numM, numN, G)</code>: Triton's grouped order: programs go down groups of <code>G</code> tile-rows column by column. With <code>inGroup = G · numN</code>: <code>group = ⌊pid / inGroup⌋</code>, <code>firstM = group · G</code>, <code>size = min(numM − firstM, G)</code>, <code>m = firstM + (pid mod inGroup) mod size</code>, <code>n = ⌊(pid mod inGroup) / size⌋</code>.</li>
<li><code>panelsTouched(order, k, numM, numN)</code>: for the first <code>k</code> programs of an ordering (a function of <code>pid</code>), the number of distinct A row-panels plus distinct B column-panels they read. That's the working set they need in L2 at once.</li>
</ol>`,
  starter: `
function rowMajor(pid, numM, numN) {
  // TODO
}
function grouped(pid, numM, numN, G) {
  // TODO
}
function panelsTouched(order, k, numM, numN) {
  // TODO
}

function main() {
  for (let pid = 0; pid < 12; pid++) print(pid, JSON.stringify(rowMajor(pid, 6, 6)), JSON.stringify(grouped(pid, 6, 6, 3)));
  print(panelsTouched((p) => rowMajor(p, 8, 8), 16, 8, 8), panelsTouched((p) => grouped(p, 8, 8, 4), 16, 8, 8));
}
`,
  tests(t) {
    const rm = t.fn("rowMajor"), gr = t.fn("grouped"), pt = t.fn("panelsTouched");
    const eq = (a, b) => a && a.m === b.m && a.n === b.n;
    t.check("rowMajor(7, 6, 6) = {m: 1, n: 1}", eq(rm(7, 6, 6), { m: 1, n: 1 }), `got ${JSON.stringify(rm(7, 6, 6))}`);
    const want = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2]];
    t.check("grouped(0..6, 6, 6, 3) goes down 3-row groups", want.every(([m, n], p) => eq(gr(p, 6, 6, 3), { m, n })), `got ${JSON.stringify(want.map((_, p) => gr(p, 6, 6, 3)))}`);
    t.check("grouped(18, 6, 6, 3) starts the second group", eq(gr(18, 6, 6, 3), { m: 3, n: 0 }), `got ${JSON.stringify(gr(18, 6, 6, 3))}`);
    t.check("grouped(34, 5, 7, 3): the last, short group", eq(gr(34, 5, 7, 3), { m: 4, n: 6 }), `got ${JSON.stringify(gr(34, 5, 7, 3))}`);
    const seen = new Set(); for (let p = 0; p < 35; p++) { const r = gr(p, 5, 7, 3); seen.add(r.m * 7 + r.n); }
    t.check("grouped covers every tile exactly once", seen.size === 35, `${seen.size} distinct tiles`);
    t.check("panelsTouched, row-major, first 16 of 8×8 = 10", pt((p) => rm(p, 8, 8), 16, 8, 8) === 10, `got ${pt((p) => rm(p, 8, 8), 16, 8, 8)}`);
    t.check("panelsTouched, grouped G=4, first 16 of 8×8 = 8", pt((p) => gr(p, 8, 8, 4), 16, 8, 8) === 8, `got ${pt((p) => gr(p, 8, 8, 4), 16, 8, 8)}`);
    t.check("panelsTouched, row-major, first 64 of 32×32 = 34", pt((p) => rm(p, 32, 32), 64, 32, 32) === 34, `got ${pt((p) => rm(p, 32, 32), 64, 32, 32)}`);
    t.check("panelsTouched, grouped G=8, first 64 of 32×32 = 16", pt((p) => gr(p, 32, 32, 8), 64, 32, 32) === 16, `got ${pt((p) => gr(p, 32, 32, 8), 64, 32, 32)}`);
  },
});
