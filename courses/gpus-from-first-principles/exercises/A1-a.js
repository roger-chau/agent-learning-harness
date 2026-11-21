GW.exercise({
  id: "A1-a",
  title: "Imaging pipeline: grayscale, separable blur, Sobel",
  file: "imaging.js",
  prompt: `<p>Implement the four kernels and <code>runPipeline</code> as specified above.</p>`,
  starter: `
function grayscale(rgb, gray, w, h) {
  // TODO
}

function blurH(src, dst, w, h) {
  // TODO: weights [1, 4, 6, 4, 1] / 16 over x-2..x+2, clamp-to-edge
}

function blurV(src, dst, w, h) {
  // TODO: same along y
}

function sobel(src, dst, w, h) {
  // TODO: sqrt(gx^2 + gy^2), clamp-to-edge
}

function runPipeline(rgb, w, h) {
  // TODO: allocate f32 buffers, launch the four kernels with 2D grids, return
  // { gray, blurred, edges, stats: [s1, s2, s3, s4] }
}

function main() {
  const w = 160, h = 110;
  const rgb = gpu.image(w, h);
  const r = runPipeline(rgb, w, h);
  show(rgb, w, h, { label: "input" });
  show(r.gray, w, h, { label: "gray", min: 0, max: 255 });
  show(r.blurred, w, h, { label: "blurred", min: 0, max: 255 });
  show(r.edges, w, h, { label: "edges" });
  r.stats.forEach((s, i) => { print("kernel", i + 1); table(s); });
}
`,
  tests(t) {
    const run = t.fn("runPipeline");
    const f = Math.fround;
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    function reference(rgb, w, h) {
      const gray = new Float32Array(w * h), tmp = new Float32Array(w * h), blur = new Float32Array(w * h), edges = new Float32Array(w * h);
      for (let p = 0; p < w * h; p++) gray[p] = 0.299 * rgb[p * 3] + 0.587 * rgb[p * 3 + 1] + 0.114 * rgb[p * 3 + 2];
      const K = [1, 4, 6, 4, 1];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0; for (let k = -2; k <= 2; k++) s += K[k + 2] * gray[y * w + clamp(x + k, 0, w - 1)];
        tmp[y * w + x] = s / 16;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0; for (let k = -2; k <= 2; k++) s += K[k + 2] * tmp[clamp(y + k, 0, h - 1) * w + x];
        blur[y * w + x] = s / 16;
      }
      const at = (x, y) => blur[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const gx = -at(x - 1, y - 1) + at(x + 1, y - 1) - 2 * at(x - 1, y) + 2 * at(x + 1, y) - at(x - 1, y + 1) + at(x + 1, y + 1);
        const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
        edges[y * w + x] = Math.sqrt(gx * gx + gy * gy);
      }
      return { gray, blur, edges };
    }
    const close = (a, b) => Math.abs(a - b) <= 2e-3 + 1e-4 * Math.abs(b);
    t.gpu.trace = true;
    for (const [w, h] of [[203, 157], [64, 48], [5, 3], [1, 1]]) {
      const rgb = t.gpu.image(w, h);
      const r = run(rgb, w, h);
      const ok = r && r.gray && r.blurred && r.edges && Array.isArray(r.stats) && r.stats.length === 4;
      t.check(`${w}×${h}: runPipeline returns the buffers and 4 stats`, ok, "return { gray, blurred, edges, stats: [4 launch results] }");
      if (!ok) continue;
      const ref = reference(rgb.data, w, h);
      for (const [name, got, want] of [["grayscale", r.gray, ref.gray], ["blur", r.blurred, ref.blur], ["Sobel", r.edges, ref.edges]]) {
        let bad = -1;
        for (let p = 0; p < w * h; p++) if (!close(got.data[p], want[p])) { bad = p; break; }
        t.check(`${w}×${h}: ${name} correct`, bad < 0 && got.data.length >= w * h,
          bad >= 0 ? `pixel (${bad % w}, ${Math.floor(bad / w)}): got ${got.data[bad]}, expected ${want[bad].toFixed(3)}` : "");
      }
      let offenders = 0, where = "";
      r.stats.forEach((s, k) => {
        for (const wt of s.warpTrace || []) {
          const idx = Object.values(wt.stores).flat();
          if (wt.divergent === 0) continue;
          // A warp in which every lane wrote a pixel lies entirely inside the image: it must not diverge.
          if (idx.length >= wt.lanes) { offenders++; if (!where) where = `kernel ${k + 1}, block (${wt.block.x}, ${wt.block.y}) warp ${wt.warp}`; }
        }
      });
      t.check(`${w}×${h}: no divergence in warps inside the image`, offenders === 0, `${offenders} warps inside the image diverged, e.g. ${where}`);
    }
    t.gpu.trace = false;
  },
});
