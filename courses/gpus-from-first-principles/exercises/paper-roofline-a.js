GW.exercise({
  id: "paper-roofline-a",
  title: "Place kernels on the GW-1 roofline",
  file: "place.js",
  prompt: `
<ol>
<li><code>place(stats, flops, peakGflops, bandwidthGBs)</code> returns <code>{ intensity, achievedGflops, attainableGflops, efficiency, bound }</code> for one launch, using <code>stats.dramBytes</code> and <code>stats.timeUs</code>. <code>bound</code> is <code>"memory"</code> or <code>"compute"</code>, from the intensity and the ridge.</li>
<li><code>underCeiling(intensity, peakGflops, bandwidthGBs, ceilings)</code>: <code>ceilings</code> is a list of compute ceilings in GFLOP/s, such as "without FMA". Return the attainable GFLOP/s under the <em>lowest</em> ceiling.</li>
<li><code>measureBoth()</code> launches the two provided kernels (sizes and launch configurations are in the starter), calls <code>place</code> on each with the GW-1's numbers, and returns <code>{ triad, reuse }</code>.</li>
</ol>`,
  starter: `
// 2 FLOPs per element, no reuse.
function triad(a, b, c, n) {
  const i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i < n) a[i] = b[i] + 3 * c[i];
}

// Each element of x is used R times from registers: 2*R FLOPs per element loaded.
function reuse(x, out, n, R) {
  const i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i < n) {
    const v = x[i];
    let acc = 0;
    for (let k = 0; k < R; k++) acc = acc * v + 1;
    out[i] = acc;
  }
}

function place(stats, flops, peakGflops, bandwidthGBs) {
  // TODO
}

function underCeiling(intensity, peakGflops, bandwidthGBs, ceilings) {
  // TODO
}

function measureBoth() {
  const n = 1 << 16;
  // triad: three arrays of n, blocks of 256, FLOPs = 2n
  // reuse: x and out of n, R = 64, blocks of 256, FLOPs = 2 * 64 * n
  // TODO: return { triad: place(...), reuse: place(...) }
}

function main() {
  const r = measureBoth();
  print(r.triad);
  print(r.reuse);
}
`,
  tests(t) {
    const place = t.fn("place"), uc = t.fn("underCeiling"), mb = t.fn("measureBoth");
    const fake = { dramBytes: 1e6, timeUs: 5 };
    const p = place(fake, 2e6, 1536, 512);
    t.check("place: intensity = flops / dramBytes", p && t.approx(p.intensity, 2), p ? `got ${p.intensity}` : "return an object");
    t.check("place: achieved GFLOP/s = flops / time", p && t.approx(p.achievedGflops, 400), p ? `got ${p.achievedGflops}` : "");
    t.check("place: attainable = min(peak, I·BW)", p && t.approx(p.attainableGflops, 1024), p ? `got ${p.attainableGflops}` : "");
    t.check("place: efficiency and bound", p && t.approx(p.efficiency, 400 / 1024) && p.bound === "memory", p ? `got ${p.efficiency}, ${p.bound}` : "");
    t.check("underCeiling: lowest ceiling wins", t.approx(uc(10, 1536, 512, [768, 1200]), 768), `got ${uc(10, 1536, 512, [768, 1200])}`);
    t.check("underCeiling: memory roof still applies", t.approx(uc(0.5, 1536, 512, [768]), 256), `got ${uc(0.5, 1536, 512, [768])}`);
    t.check("underCeiling: no ceilings = plain roofline", t.approx(uc(4, 1536, 512, []), 1536), `got ${uc(4, 1536, 512, [])}`);
    const r = mb();
    const ok = r && r.triad && r.reuse;
    t.check("measureBoth returns { triad, reuse }", ok, "");
    if (ok) {
      t.check("triad: intensity ≈ 2/12, memory-bound", Math.abs(r.triad.intensity - 2 / 12) < 0.005 && r.triad.bound === "memory", `I = ${r.triad.intensity}, ${r.triad.bound}`);
      t.check("reuse (R = 64): intensity ≈ 16, compute-bound", Math.abs(r.reuse.intensity - 16) < 0.2 && r.reuse.bound === "compute", `I = ${r.reuse.intensity}, ${r.reuse.bound}`);
    }
  },
});
