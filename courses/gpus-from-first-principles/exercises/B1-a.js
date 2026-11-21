GW.exercise({
  id: "B1-a",
  title: "reduceSum at bandwidth",
  file: "reduce.js",
  prompt: `<p>Implement <code>reduceSum(x, n)</code> → <code>{ sum, stats: [every launch] }</code>.</p>`,
  starter: `
function reduceSum(x, n) {
  // TODO: launch your kernel(s); return { sum, stats: [...] }
}

function main() {
  const n = 1 << 20;
  const x = gpu.from(Array.from({ length: n }, (_, i) => (i % 100) / 100));
  const r = reduceSum(x, n);
  const t = r.stats.reduce((a, s) => a + s.timeUs, 0);
  print("sum:", r.sum, " effective GB/s:", (4 * n / (t * 1e3)).toFixed(1));
  r.stats.forEach((s) => table(s));
}
`,
  tests(t) {
    const red = t.fn("reduceSum");
    for (const n of [1, 1000, 77777, 1 << 20]) {
      const xs = Array.from({ length: n }, (_, i) => ((i * 31) % 97) / 10 - 4);
      const x = t.gpu.from(xs);
      let want = 0; for (const v of x.data) want += v;
      const r = red(x, n);
      const ok = r && typeof r.sum === "number" && Array.isArray(r.stats) && r.stats.length > 0;
      t.check(`n = ${n}: returns { sum, stats }`, ok, "return { sum, stats: [every launch] }");
      if (!ok) continue;
      t.check(`n = ${n}: sum correct`, Math.abs(r.sum - want) <= 1e-4 * Math.max(1, Math.abs(want)) + 1e-3, `got ${r.sum}, expected ${want}`);
      if (n === 1 << 20) {
        const us = r.stats.reduce((a, s) => a + s.timeUs, 0);
        const gbs = (4 * n) / (us * 1e3);
        t.check("2²⁰ elements: ≥ 75% of peak (384 GB/s effective)", gbs >= 0.75 * 512, `${gbs.toFixed(1)} GB/s over ${r.stats.length} launch(es), ${us.toFixed(2)} µs`);
      }
    }
  },
});
