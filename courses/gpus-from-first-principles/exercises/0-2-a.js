GW.exercise({
  id: "0-2-a",
  title: "AMAT for any hierarchy",
  file: "amat.js",
  prompt: `
<p>A hierarchy is an array of levels, top first. Each level has a <code>time</code> (cycles to access it) and a <code>hitRate</code> (fraction of the accesses <em>reaching that level</em> that hit there). The last level always has <code>hitRate: 1</code>.</p>
<ol>
<li><code>amat(levels)</code> returns the average memory access time in cycles. It must work for any number of levels.</li>
<li><code>usefulFraction(workCycles, levels)</code>: each loop iteration does one load and then <code>workCycles</code> of computation, with no overlap. Return the fraction of time spent on the work.</li>
<li><code>hitRateForTarget(target, levels)</code>: what L1 hit rate (the first level's <code>hitRate</code>) brings AMAT down to exactly <code>target</code>, keeping everything else fixed? Return a number between 0 and 1. If no hit rate between 0 and 1 reaches it, return <code>null</code>.</li>
</ol>
<p>Check yourself against the chapter: the example hierarchy gives 17.4 cycles.</p>`,
  starter: `
// levels: [{ time, hitRate }, ...], top first; the last level has hitRate 1

function amat(levels) {
  // TODO
}

function usefulFraction(workCycles, levels) {
  // TODO
}

function hitRateForTarget(target, levels) {
  // TODO
}

function main() {
  const cpu = [
    { time: 4, hitRate: 0.90 },   // L1
    { time: 14, hitRate: 0.60 },  // L2
    { time: 300, hitRate: 1 },    // DRAM
  ];
  print("AMAT:", amat(cpu));            // 17.4
  print("useful:", usefulFraction(4, cpu));
  print("L1 hit rate for 10 cycles:", hitRateForTarget(10, cpu));
}
`,
  tests(t) {
    const amat = t.fn("amat");
    const uf = t.fn("usefulFraction");
    const hr = t.fn("hitRateForTarget");
    const ref = (lv) => { let a = 0; for (let i = lv.length - 1; i >= 0; i--) a = lv[i].time + (1 - lv[i].hitRate) * a; return a; };
    const H = [
      [{ time: 4, hitRate: 0.9 }, { time: 14, hitRate: 0.6 }, { time: 300, hitRate: 1 }],
      [{ time: 100, hitRate: 1 }],
      [{ time: 1, hitRate: 0.5 }, { time: 10, hitRate: 1 }],
      [{ time: 4, hitRate: 0.95 }, { time: 12, hitRate: 0.8 }, { time: 40, hitRate: 0.5 }, { time: 350, hitRate: 1 }],
    ];
    for (const lv of H) {
      const got = amat(lv), want = ref(lv);
      t.check(`amat(${lv.length} levels) = ${+want.toFixed(4)}`, t.approx(got, want, 1e-9), `got ${got}`);
    }
    t.check("usefulFraction(4, chapter example)", t.approx(uf(4, H[0]), 4 / (4 + 17.4), 1e-9), `got ${uf(4, H[0])}`);
    t.check("usefulFraction(0, …) is 0", uf(0, H[0]) === 0, `got ${uf(0, H[0])}`);
    const r = hr(10, H[0]);
    const check = (x) => ref([{ ...H[0][0], hitRate: x }, H[0][1], H[0][2]]);
    t.check("hitRateForTarget(10) gives AMAT 10", r !== null && t.approx(check(r), 10, 1e-7), `got ${r}`);
    t.check("hitRateForTarget is unreachable below the L1 time", hr(3, H[0]) === null, `got ${hr(3, H[0])}`);
    const r2 = hr(7, H[3]);
    t.check("hitRateForTarget works for 4 levels", r2 !== null && t.approx(ref([{ ...H[3][0], hitRate: r2 }, ...H[3].slice(1)]), 7, 1e-7), `got ${r2}`);
  },
});
