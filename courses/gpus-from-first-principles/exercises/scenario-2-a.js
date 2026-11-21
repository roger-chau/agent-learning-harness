GW.exercise({
  id: "scenario-2-a",
  title: "Edge ISP: fit the frame budget",
  file: "isp.js",
  prompt: `<p><code>runISP(dev, raw, lut, w, h, gain)</code> must produce the reference output on the GW-E device and take at most <strong>90 µs</strong> in total across all launches. Below 65 µs earns the stretch line in the checks (not required).</p>`,
  starter: `
// The baseline: three kernels with float intermediates in DRAM.
function blackGain(raw, a, w, h, gain) {
  const x = blockIdx.x * blockDim.x + threadIdx.x, y = blockIdx.y * blockDim.y + threadIdx.y;
  if (x < w && y < h) a[y * w + x] = Math.max(raw[y * w + x] - 64, 0) * gain;
}
function denoise(a, b, w, h) {
  const x = blockIdx.x * blockDim.x + threadIdx.x, y = blockIdx.y * blockDim.y + threadIdx.y;
  if (x < w && y < h) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      s += a[Math.min(Math.max(y + dy, 0), h - 1) * w + Math.min(Math.max(x + dx, 0), w - 1)];
    b[y * w + x] = s / 9;
  }
}
function tone(b, lut, out, w, h) {
  const x = blockIdx.x * blockDim.x + threadIdx.x, y = blockIdx.y * blockDim.y + threadIdx.y;
  if (x < w && y < h) out[y * w + x] = lut[Math.min(Math.max(Math.round(b[y * w + x]), 0), 1023)];
}

function runISP(dev, raw, lut, w, h, gain) {
  // TODO: replace with your design. Use dev, not gpu.
  const a = dev.alloc(w * h), b = dev.alloc(w * h), out = dev.alloc(w * h, "u8");
  const cfg = { grid: { x: Math.ceil(w / 32), y: Math.ceil(h / 8) }, block: { x: 32, y: 8 } };
  const stats = [dev.launch(blackGain, cfg, raw, a, w, h, gain), dev.launch(denoise, cfg, a, b, w, h), dev.launch(tone, cfg, b, lut, out, w, h)];
  return { out, stats };
}

function main() {
  const dev = new GPUSim.Device({ name: "GW-E", sms: 4, clockGHz: 1.0, dramBandwidthGBs: 51.2, dramLatencyCycles: 300, l2Bytes: 128 * 1024, l2BandwidthGBs: 102.4 });
  const w = 640, h = 360;
  const raw = dev.from(Array.from({ length: w * h }, (_, i) => 64 + ((i * 37) % 900)), "u16");
  const lut = dev.from(Array.from({ length: 1024 }, (_, i) => Math.round(255 * Math.pow(i / 1023, 1 / 2.2))), "u8");
  const r = runISP(dev, raw, lut, w, h, 1.1);
  print("total µs:", r.stats.reduce((a, s) => a + s.timeUs, 0).toFixed(1));
  r.stats.forEach((s) => table(s));
  show(r.out, w, h, { label: "output", min: 0, max: 255 });
}
`,
  tests(t) {
    const run = t.fn("runISP");
    const dev = new t.GPUSim.Device({ name: "GW-E", sms: 4, clockGHz: 1.0, dramBandwidthGBs: 51.2, dramLatencyCycles: 300, l2Bytes: 128 * 1024, l2BandwidthGBs: 102.4 });
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    for (const [w, h, gain] of [[640, 360, 1.1], [97, 61, 0.8]]) {
      let seed = w;
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const rawv = Array.from({ length: w * h }, () => Math.floor(rnd() * 1100));
      const lutv = Array.from({ length: 1024 }, (_, i) => Math.round(255 * Math.pow(i / 1023, 1 / 2.2)));
      const a = new Float32Array(w * h);
      for (let p = 0; p < w * h; p++) a[p] = Math.max(rawv[p] - 64, 0) * gain;
      const want = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += a[clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)];
        want[y * w + x] = lutv[clamp(Math.round(Math.fround(s / 9)), 0, 1023)];
      }
      const r = run(dev, dev.from(rawv, "u16"), dev.from(lutv, "u8"), w, h, gain);
      const ok = r && r.out && Array.isArray(r.stats) && r.stats.length > 0;
      t.check(`${w}×${h}: returns { out, stats }`, ok, "return { out, stats: [every launch] }");
      if (!ok) continue;
      let bad = 0, first = -1;
      for (let p = 0; p < w * h; p++) if (Math.abs(r.out.data[p] - want[p]) > 1) { bad++; if (first < 0) first = p; }
      t.check(`${w}×${h}: output matches the reference (±1 for rounding)`, bad === 0, `${bad} pixels differ, first at (${first % w}, ${Math.floor(first / w)})`);
      if (w === 640) {
        const total = r.stats.reduce((acc, s) => acc + s.timeUs, 0);
        t.check("640×360: ≤ 90 µs per frame on the GW-E", total <= 90, `${total.toFixed(1)} µs`);
        if (total <= 65) t.check(`stretch: ≤ 65 µs (${total.toFixed(1)} µs)`, true);
      }
    }
  },
});
