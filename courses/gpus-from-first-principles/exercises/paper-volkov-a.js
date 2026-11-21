GW.exercise({
  id: "paper-volkov-a",
  title: "Full bandwidth at a quarter of the occupancy",
  file: "lower_occupancy.js",
  prompt: `
<ol>
<li><code>warpsNeeded(latencyCycles, peakBytesPerCycle, bytesPerRequest, ilp)</code>: the fewest resident warps that keep memory saturated.</li>
<li><code>bandwidthFraction(warps, bytesPerRequest, ilp, latencyCycles, peakBytesPerCycle)</code>: the fraction of peak those warps reach (at most 1).</li>
<li>Kernel <code>copy4(a, b, n)</code>: each thread copies 4 elements, <code>i</code>, <code>i + S</code>, <code>i + 2S</code>, <code>i + 3S</code>, where <code>S</code> is the total number of threads in the grid. Issue <strong>all four loads before any store</strong>. <code>n</code> is a multiple of 4 × the thread count.</li>
<li><code>runLowOccupancy(a, b, n)</code> launches <code>copy4</code> with blocks of 256, <code>registers: 128</code> and <code>ilp: 4</code>, and returns the stats. It must reach ≥ 80% of peak bandwidth at 25% occupancy.</li>
</ol>`,
  starter: `
function warpsNeeded(latencyCycles, peakBytesPerCycle, bytesPerRequest, ilp) {
  // TODO
}

function bandwidthFraction(warps, bytesPerRequest, ilp, latencyCycles, peakBytesPerCycle) {
  // TODO
}

function copy4(a, b, n) {
  // TODO: four independent loads, then four stores
}

function runLowOccupancy(a, b, n) {
  // TODO
}

function main() {
  const peak = 512 / 1.5; // GW-1 bytes per cycle
  print("warps needed, ilp 1:", warpsNeeded(400, peak, 128, 1), " ilp 4:", warpsNeeded(400, peak, 128, 4));
  const n = 1 << 19;
  const a = gpu.alloc(n), b = gpu.alloc(n);
  const cfg = { grid: n / 4 / 256, block: 256, registers: 128 };
  print("25% occupancy, ilp 1:"); table(gpu.launch(copy4, { ...cfg, ilp: 1 }, a, b, n));
  print("25% occupancy, ilp 4:"); table(runLowOccupancy(a, b, n));
}
`,
  tests(t) {
    const wn = t.fn("warpsNeeded"), bf = t.fn("bandwidthFraction"), run = t.fn("runLowOccupancy");
    const peak = 512 / 1.5;
    for (const [ilp, want] of [[1, 1067], [4, 267], [2, 534]]) t.check(`warpsNeeded(400, GW-1, 128, ${ilp}) = ${want}`, wn(400, peak, 128, ilp) === want, `got ${wn(400, peak, 128, ilp)}`);
    t.check("bandwidthFraction(256 warps, 128 B, ilp 1) = 0.24", t.approx(bf(256, 128, 1, 400, peak), 256 * 128 / 400 / peak, 1e-9), `got ${bf(256, 128, 1, 400, peak)}`);
    t.check("bandwidthFraction is capped at 1", bf(2048, 128, 4, 400, peak) === 1, `got ${bf(2048, 128, 4, 400, peak)}`);
    const n = 1 << 19;
    const a = t.gpu.from(Array.from({ length: n }, (_, i) => i % 4093)), b = t.gpu.alloc(n);
    const s = run(a, b, n);
    let bad = -1;
    for (let i = 0; i < n; i++) if (b.data[i] !== a.data[i]) { bad = i; break; }
    t.check("copy is correct", bad < 0 && !!s, !s ? "return the stats" : `b[${bad}] wrong`);
    if (s) {
      t.check("runs at 25% occupancy", Math.abs(s.occupancy - 0.25) < 1e-9, `occupancy ${(s.occupancy * 100).toFixed(1)}%`);
      t.check("each thread issues 4 loads", s.loads >= 4 * s.warps, `${s.loads} warp loads for ${s.warps} warps`);
      t.check("≥ 80% of peak bandwidth", s.percentOfPeakBandwidth >= 80, `${s.percentOfPeakBandwidth}%, limited by ${s.limitedBy}`);
    }
  },
});
