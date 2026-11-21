GW.exercise({
  id: "B3-a",
  title: "A histogram that survives skew",
  file: "histogram_robust.js",
  prompt: `<p><code>runHistogramRobust(x, bins, n)</code> returns <code>[stats of every launch]</code>; all three distributions must be correct and take ≤ 2,600 cycles in total.</p>`,
  starter: `
function histogramRobust(x, bins, n) {
  // TODO
}

function runHistogramRobust(x, bins, n) {
  // TODO: return [stats, ...]
}

function main() {
  const n = 65536;
  let seed = 9;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const inputs = {
    uniform: Array.from({ length: n }, () => Math.floor(rnd() * 256)),
    constant: Array(n).fill(42),
    skewed: Array.from({ length: n }, () => (rnd() < 0.9 ? 7 : Math.floor(rnd() * 256))),
  };
  for (const [name, arr] of Object.entries(inputs)) {
    const runs = runHistogramRobust(gpu.from(arr, "u8"), gpu.alloc(256, "u32"), n);
    print(name, runs.reduce((a, s) => a + s.cycles, 0), "cycles");
  }
}
`,
  tests(t) {
    const run = t.fn("runHistogramRobust");
    let seed = 21;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const n = 65536;
    const inputs = [
      ["uniform", Array.from({ length: n }, () => Math.floor(rnd() * 256))],
      ["constant", Array(n).fill(200)],
      ["skewed", Array.from({ length: n }, () => (rnd() < 0.9 ? 3 : Math.floor(rnd() * 256)))],
      ["tiny", [5, 5, 9]],
    ];
    for (const [name, arr] of inputs) {
      const bins = t.gpu.alloc(256, "u32");
      const runs = run(t.gpu.from(arr, "u8"), bins, arr.length);
      const ok = Array.isArray(runs) && runs.length > 0 && runs.every((s) => s && typeof s.cycles === "number");
      t.check(`${name}: returns [stats, …]`, ok, "return an array of launch stats");
      if (!ok) continue;
      const want = new Array(256).fill(0); for (const v of arr) want[v]++;
      const bad = want.findIndex((c, b) => bins.data[b] !== c);
      t.check(`${name}: correct`, bad < 0, `bin ${bad}: ${bins.data[bad]} vs ${want[bad]}`);
      if (arr.length === n) {
        const total = runs.reduce((a, s) => a + s.cycles, 0);
        t.check(`${name}: ≤ 2,600 cycles`, total <= 2600, `${total} cycles`);
      }
    }
  },
});
