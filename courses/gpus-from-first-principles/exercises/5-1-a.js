GW.exercise({
  id: "5-1-a",
  title: "A benchmark you can trust",
  file: "bench.js",
  prompt: `
<p>Write <code>benchmark(dev, launch, reps)</code>. <code>dev</code> is a device (use <code>dev.now()</code> and <code>dev.synchronize()</code>, not the global <code>gpu</code>), and <code>launch()</code> launches the kernel once. Return:</p>
<ul>
<li><code>median</code>: the median of <code>reps</code> synchronised single-launch timings (µs), after a warm-up of at least 3 launches;</li>
<li><code>min</code>: the fastest of those timings;</li>
<li><code>backToBack</code>: µs per launch when <code>reps</code> launches are issued back to back with one synchronise at the end.</li>
</ul>`,
  starter: `
function benchmark(dev, launch, reps) {
  // TODO: warm up, then time each launch (synchronise!), then time a back-to-back batch
}

function median(xs) {
  // TODO
}

const K = gpu.compile(\`function scale(x, y, n) { const i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) y[i] = 2 * x[i]; }\`);

function main() {
  for (const n of [1024, 1 << 18]) {
    const x = gpu.from(new Array(n).fill(1)), y = gpu.alloc(n);
    const r = benchmark(gpu, () => gpu.launch(K.scale, { grid: Math.ceil(n / 256), block: 256 }, x, y, n), 25);
    print("n =", n, JSON.stringify(r));
  }
}
`,
  tests(t) {
    const bench = t.fn("benchmark");
    // Kernels with known device times, run through the simulator's noisy wall clock (no simulation needed).
    for (const [kernelUs, seed] of [[0.8, 7], [4.5, 11], [20, 99]]) {
      const dev = new t.GPUSim.Device({ seed, outlierRate: 0.12 });
      const K = {};
      const launch = () => { dev._clockLaunch(K, kernelUs); };
      const r = bench(dev, launch, 31) || {};
      const lat = dev.spec.launchOverheadUs + kernelUs, thr = Math.max(dev.spec.launchOverheadUs, kernelUs);
      t.check(`kernel ${kernelUs} µs: median ≈ launch + kernel (${lat.toFixed(2)} µs)`, Math.abs(r.median - lat) / lat < 0.05, `got ${r.median}`);
      t.check(`kernel ${kernelUs} µs: min is the fastest run`, r.min <= r.median && r.min > 0.9 * lat, `got ${r.min}`);
      t.check(`kernel ${kernelUs} µs: backToBack ≈ ${thr.toFixed(2)} µs (occasional slow runs allowed)`, r.backToBack >= 0.95 * thr && r.backToBack <= 1.25 * thr, `got ${r.backToBack}`);
    }
  },
});
