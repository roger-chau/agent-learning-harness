GW.exercise({
  id: "scenario-5-a",
  title: "Settle the regression",
  file: "regression.js",
  prompt: `<p>Implement <code>compare(dev, runA, runB, reps)</code> and <code>runFixed(x, y, n)</code>.</p>`,
  starter: `
const K = gpu.compile(\`
function smoothBefore(x, y, n) {
  const i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= 2 && i < n - 2) y[i] = 0.1 * x[i - 2] + 0.2 * x[i - 1] + 0.4 * x[i] + 0.2 * x[i + 1] + 0.1 * x[i + 2];
}
function smoothAfter(x, y, n) {
  // PR #4711: "process 4 outputs per thread to cut launch overhead"
  const base = (blockIdx.x * blockDim.x + threadIdx.x) * 4;
  for (let q = 0; q < 4; q++) {
    const i = base + q;
    if (i >= 2 && i < n - 2) y[i] = 0.1 * x[i - 2] + 0.2 * x[i - 1] + 0.4 * x[i] + 0.2 * x[i + 1] + 0.1 * x[i + 2];
  }
}
// your fixed kernel(s) here
\`);

function runBefore(x, y, n) { return [gpu.launch(K.smoothBefore, { grid: n / 256, block: 256 }, x, y, n)]; }
function runAfter(x, y, n) { return [gpu.launch(K.smoothAfter, { grid: n / 1024, block: 256 }, x, y, n)]; }

function compare(dev, runA, runB, reps) {
  // TODO: warm up, interleave, synchronise, robust statistics
  return { ratio: 1, verdict: "same" };
}

function runFixed(x, y, n) {
  // TODO
  return runAfter(x, y, n);
}

function main() {
  const n = 1 << 14, x = gpu.from(Array.from({ length: n }, (_, i) => Math.sin(i))), y = gpu.alloc(n);
  print(JSON.stringify(compare(gpu, () => runBefore(x, y, n), () => runAfter(x, y, n), 15)));
  for (const f of [runBefore, runAfter, runFixed]) {
    const s = f(x, y, n)[0];
    print(f.name, s.cycles, "cycles", s.limitedBy, JSON.stringify(s.sol), "coalescing", s.coalescing);
  }
}
`,
  tests(t) {
    const compare = t.fn("compare");
    // Synthetic kernels with known device times, run through the simulator's noisy wall clock.
    const pairs = [[10, 13, "slower"], [20, 20, "same"], [30, 24, "faster"], [1, 1.5, "slower"], [50, 50.5, "same"]];
    pairs.forEach(([a, b, want], k) => {
      const dev = new t.GPUSim.Device({ seed: 101 + k, outlierRate: 0.1 });
      const KA = {}, KB = {};
      const run = (obj, us) => () => { dev._clockLaunch(obj, us); return [{ timeUs: us }]; };
      const r = compare(dev, run(KA, a), run(KB, b), 25) || {};
      const truth = (dev.spec.launchOverheadUs + b) / (dev.spec.launchOverheadUs + a);
      t.check(`pair ${k + 1}: ratio ≈ ${truth.toFixed(3)}`, typeof r.ratio === "number" && Math.abs(r.ratio - truth) <= 0.03 * truth, `got ${r.ratio}`);
      t.check(`pair ${k + 1}: verdict "${want}"`, r.verdict === want, `got ${JSON.stringify(r.verdict)}`);
    });
    const n = 1 << 18;
    const x = t.gpu.from(Array.from({ length: n }, (_, i) => Math.cos(i * 0.37))), y = t.gpu.from(new Array(n).fill(0));
    const before = t.fn("runBefore")(x, t.gpu.alloc(n), n)[0].cycles;
    const st = t.fn("runFixed")(x, y, n);
    let e = 0; for (let i = 2; i < n - 2; i++) e = Math.max(e, Math.abs(y.data[i] - (0.1 * x.data[i - 2] + 0.2 * x.data[i - 1] + 0.4 * x.data[i] + 0.2 * x.data[i + 1] + 0.1 * x.data[i + 2])));
    t.check("runFixed: correct", e < 1e-5, `max error ${e}`);
    const c = Array.isArray(st) ? st.reduce((s, x) => s + (x.cycles || 0), 0) : 0;
    t.check(`runFixed: no slower than the pre-PR ${before} cycles (within 5%)`, c > 0 && c <= 1.05 * before, `${c} cycles${c && c <= 7500 ? " (stretch goal met)" : ""}`);
  },
});
