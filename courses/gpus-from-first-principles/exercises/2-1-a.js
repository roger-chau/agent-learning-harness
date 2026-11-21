GW.exercise({
  id: "2-1-a",
  title: "Roofline arithmetic",
  file: "roofline.js",
  prompt: `
<p>Write the roofline as functions, then measure a real kernel's intensity with the simulator.</p>
<ol>
<li><code>peakGflops(sms, lanesPerSM, clockGHz)</code>, counting a fused multiply-add as 2 FLOPs.</li>
<li><code>ridge(peakGflops, bandwidthGBs)</code> and <code>attainable(intensity, peakGflops, bandwidthGBs)</code>.</li>
<li><code>bound(intensity, peakGflops, bandwidthGBs)</code> returns <code>"memory"</code> or <code>"compute"</code> (at exactly the ridge, say <code>"compute"</code>).</li>
<li><code>measuredIntensity(n)</code>: launch the provided <code>triad</code> kernel on arrays of <code>n</code> floats with blocks of 256, and return its intensity from the launch's <code>dramBytes</code>. Triad does 2 FLOPs per element.</li>
</ol>`,
  starter: `
// STREAM triad: a[i] = b[i] + s * c[i]   (2 FLOPs per element)
function triad(a, b, c, s, n) {
  const i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i < n) a[i] = b[i] + s * c[i];
}

function peakGflops(sms, lanesPerSM, clockGHz) {
  // TODO
}

function ridge(peakGflops, bandwidthGBs) {
  // TODO
}

function attainable(intensity, peakGflops, bandwidthGBs) {
  // TODO
}

function bound(intensity, peakGflops, bandwidthGBs) {
  // TODO
}

function measuredIntensity(n) {
  // TODO: allocate a, b, c; launch triad; return 2 * n / stats.dramBytes
}

function main() {
  const peak = peakGflops(16, 32, 1.5);
  print("GW-1 peak:", peak, "GFLOP/s; ridge:", ridge(peak, 512), "FLOP/B");
  print("triad intensity:", measuredIntensity(100000));
}
`,
  tests(t) {
    const pg = t.fn("peakGflops"), rd = t.fn("ridge"), at = t.fn("attainable"), bd = t.fn("bound"), mi = t.fn("measuredIntensity");
    t.check("peakGflops(16, 32, 1.5) = 1536", t.approx(pg(16, 32, 1.5), 1536), `got ${pg(16, 32, 1.5)}`);
    t.check("peakGflops(108, 64, 1.41) ≈ 19491.84", t.approx(pg(108, 64, 1.41), 19491.84, 1e-6), `got ${pg(108, 64, 1.41)}`);
    t.check("ridge(1536, 512) = 3", t.approx(rd(1536, 512), 3), `got ${rd(1536, 512)}`);
    for (const [i, want] of [[1 / 12, 512 / 12], [3, 1536], [10, 1536], [0.5, 256]]) {
      t.check(`attainable(${+i.toFixed(3)}, 1536, 512) = ${+want.toFixed(2)}`, t.approx(at(i, 1536, 512), want, 1e-9), `got ${at(i, 1536, 512)}`);
    }
    t.check("bound(0.5) = memory", bd(0.5, 1536, 512) === "memory", `got ${bd(0.5, 1536, 512)}`);
    t.check("bound(3) = compute", bd(3, 1536, 512) === "compute", `got ${bd(3, 1536, 512)}`);
    t.check("bound(8, 19500, 1555) = memory", bd(8, 19500, 1555) === "memory", `got ${bd(8, 19500, 1555)}`);
    const v = mi(65536);
    t.check("measured triad intensity is 2/12 ≈ 0.167", typeof v === "number" && Math.abs(v - 2 / 12) < 0.002, `got ${v}`);
  },
});
