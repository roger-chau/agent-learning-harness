GW.exercise({
  id: "2-3-b",
  title: "Fix the swapped indices",
  file: "swapped.js",
  prompt: `
<p><code>rowScaleSlow</code> multiplies each row <code>y</code> of a row-major <code>w × h</code> matrix by <code>s[y]</code>. It's correct, but it maps <code>threadIdx.x</code> to the <em>row</em>, so consecutive lanes are a whole row apart.</p>
<p>Write <code>rowScale(a, s, out, w, h)</code> computing the same thing with coalesced accesses, and <code>runRowScale(a, s, out, w, h)</code> that launches it with <strong>32×8</strong> blocks and returns the stats. The checks need ≥95% coalescing on a 512×256 matrix, and at least 2.5× faster than the slow version in simulated time.</p>`,
  starter: `
function rowScaleSlow(a, s, out, w, h) {
  const y = blockIdx.x * blockDim.x + threadIdx.x;   // rows across lanes: uncoalesced
  const x = blockIdx.y * blockDim.y + threadIdx.y;
  if (x < w && y < h) out[y * w + x] = a[y * w + x] * s[y];
}

function rowScale(a, s, out, w, h) {
  // TODO
}

function runRowScale(a, s, out, w, h) {
  // TODO: 32x8 blocks
}

function main() {
  const w = 512, h = 256;
  const a = gpu.from(Array.from({ length: w * h }, (_, i) => i % 10));
  const s = gpu.from(Array.from({ length: h }, (_, y) => y / 100));
  const o1 = gpu.alloc(w * h), o2 = gpu.alloc(w * h);
  print("slow:"); table(gpu.launch(rowScaleSlow, { grid: { x: h / 32, y: w / 8 }, block: { x: 32, y: 8 } }, a, s, o1, w, h));
  print("yours:"); table(runRowScale(a, s, o2, w, h));
}
`,
  tests(t) {
    const run = t.fn("runRowScale"), slow = t.fn("rowScaleSlow");
    for (const [w, h] of [[512, 256], [100, 37]]) {
      const a = t.gpu.from(Array.from({ length: w * h }, (_, i) => (i * 7) % 13)), s = t.gpu.from(Array.from({ length: h }, (_, y) => (y % 5) - 2));
      const out = t.gpu.alloc(w * h);
      const st = run(a, s, out, w, h);
      let bad = -1;
      for (let y = 0; y < h && bad < 0; y++) for (let x = 0; x < w; x++) if (Math.abs(out.data[y * w + x] - a.data[y * w + x] * s.data[y]) > 1e-4) { bad = y * w + x; break; }
      t.check(`${w}×${h}: correct`, bad < 0, bad >= 0 ? `element ${bad}` : "");
      t.check(`${w}×${h}: 32×8 blocks`, st && st.blocks === Math.ceil(w / 32) * Math.ceil(h / 8) && st.threads === st.blocks * 256, st ? `${st.blocks} blocks` : "return the stats");
      if (w === 512) {
        const o2 = t.gpu.alloc(w * h);
        const ss = t.gpu.launch(slow, { grid: { x: h / 32, y: w / 8 }, block: { x: 32, y: 8 } }, a, s, o2, w, h);
        t.check("512×256: coalescing ≥ 95%", st && st.coalescing >= 0.95, st ? `${(st.coalescing * 100).toFixed(1)}%` : "");
        t.check("512×256: at least 2.5× faster than rowScaleSlow", st && ss.cycles / st.cycles >= 2.5, st ? `${(ss.cycles / st.cycles).toFixed(2)}× faster` : "");
      }
    }
  },
});
