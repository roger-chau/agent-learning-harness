GW.exercise({
  id: "5-2-a",
  title: "Metrics from raw counters",
  file: "metrics.js",
  prompt: `
<p>Write <code>derive(s, spec)</code>, computing from the raw counters in a launch's stats (don't read <code>s.sol</code> or the <code>achieved*</code>/<code>percent*</code> fields):</p>
<ul>
<li><code>sectorsPerRequest</code>: transactions per memory instruction;</li>
<li><code>dramPct</code>, <code>l2Pct</code>: DRAM and L2 speed-of-light percentages (uncapped);</li>
<li><code>intensity</code>: FLOPs per DRAM byte;</li>
<li><code>achievedGBs</code>: DRAM bytes per second of kernel time, in GB/s (use <code>cycles</code> and the clock);</li>
<li><code>fmaShare</code>: FMA instructions as a fraction of all issued warp instructions.</li>
</ul>`,
  starter: `
function derive(s, spec) {
  // TODO
  return { sectorsPerRequest: 0, dramPct: 0, l2Pct: 0, intensity: 0, achievedGBs: 0, fmaShare: 0 };
}

const K = gpu.compile(\`
function copy(x, y, n) { const i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) y[i] = x[i]; }
function strided(x, y, n) { const i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) y[i] = x[(i * 8) % n]; }
\`);

function main() {
  const n = 1 << 14, x = gpu.from(new Array(n).fill(1)), y = gpu.alloc(n);
  for (const k of [K.copy, K.strided]) {
    const s = gpu.launch(k, { grid: n / 256, block: 256 }, x, y, n);
    print(JSON.stringify(derive(s, gpu.spec)), " simulator:", JSON.stringify(s.sol));
  }
}
`,
  tests(t) {
    const derive = t.fn("derive");
    const K = t.gpu.compile(`
function copy(x, y, n) { const i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) y[i] = x[i]; }
function strided(x, y, n) { const i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) y[i] = x[(i * 8) % n]; }
function poly(x, y, n) { const i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) { const v = x[i]; let a = 0; for (let k = 0; k < 32; k++) a = fma(a, v, 1); y[i] = a; } }
function reuse(x, y, n) { const i = blockIdx.x * blockDim.x + threadIdx.x; let s = 0; for (let r = 0; r < 8; r++) s += x[(i + r * 1024) % 2048]; y[i] = s; }`);
    const n = 1 << 14, x = t.gpu.from(Array.from({ length: n }, (_, i) => (i % 7) / 7)), y = t.gpu.alloc(n);
    const close = (a, b, tol = 0.01) => typeof a === "number" && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
    for (const name of ["copy", "strided", "poly", "reuse"]) {
      const s = t.gpu.launch(K[name], { grid: n / 256, block: 256 }, x, y, n);
      const raw = { ...s }; for (const k of ["sol", "achievedBandwidthGBs", "percentOfPeakBandwidth", "achievedGflops", "percentOfPeakFp32", "limitedBy"]) delete raw[k];
      const d = derive(raw, t.gpu.spec) || {};
      const sp = t.gpu.spec, wi = s.memInstructions + s.branches + s.sharedWavefronts + s.barriers + s.warpOps + (s.atomicSerialization - s.atomics) + s.fmaInstructions;
      const want = {
        sectorsPerRequest: s.transactions / s.memInstructions,
        dramPct: (100 * s.dramBytes) / (sp.dramBandwidthGBs / sp.clockGHz) / s.cycles,
        l2Pct: (100 * s.bytesMoved) / (sp.l2BandwidthGBs / sp.clockGHz) / s.cycles,
        intensity: s.flops / s.dramBytes,
        achievedGBs: s.achievedBandwidthGBs,
        fmaShare: s.fmaInstructions / wi,
      };
      for (const [k, v] of Object.entries(want)) t.check(`${name}: ${k} ≈ ${+v.toFixed(3)}`, close(d[k], v), `got ${d[k]}`);
    }
  },
});
