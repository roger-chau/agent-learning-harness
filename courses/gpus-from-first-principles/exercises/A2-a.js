GW.exercise({
  id: "A2-a",
  title: "Coalesce the imaging pipeline",
  file: "imaging.js",
  prompt: `<p>Paste in your A1 solution, then fix grayscale's interleaved read (shared-memory staging) and your stencils' block shapes. Same API as A1.</p>`,
  starter: `
// Start from your A1 solution.
function grayscale(rgb, gray, w, h) {
  // TODO: stage 3*T bytes through shared memory, then compute
}

function blurH(src, dst, w, h) {
  // TODO
}

function blurV(src, dst, w, h) {
  // TODO
}

function sobel(src, dst, w, h) {
  // TODO
}

function runPipeline(rgb, w, h) {
  // TODO: return { gray, blurred, edges, stats: [s1, s2, s3, s4] }
}

function main() {
  const w = 160, h = 110;
  const r = runPipeline(gpu.image(w, h), w, h);
  ["grayscale", "blurH", "blurV", "sobel"].forEach((n, i) => print(n, "coalescing", (r.stats[i].coalescing * 100).toFixed(1) + "%"));
  show(r.edges, w, h, { label: "edges" });
}
`,
  tests(t) {
    const run = t.fn("runPipeline");
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    function reference(rgb, w, h) {
      const gray = new Float32Array(w * h), tmp = new Float32Array(w * h), blur = new Float32Array(w * h), edges = new Float32Array(w * h);
      for (let p = 0; p < w * h; p++) gray[p] = 0.299 * rgb[p * 3] + 0.587 * rgb[p * 3 + 1] + 0.114 * rgb[p * 3 + 2];
      const K = [1, 4, 6, 4, 1];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -2; k <= 2; k++) s += K[k + 2] * gray[y * w + clamp(x + k, 0, w - 1)]; tmp[y * w + x] = s / 16; }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -2; k <= 2; k++) s += K[k + 2] * tmp[clamp(y + k, 0, h - 1) * w + x]; blur[y * w + x] = s / 16; }
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
    for (const [w, h] of [[256, 128], [203, 157], [5, 3]]) {
      const rgb = t.gpu.image(w, h);
      const r = run(rgb, w, h);
      const ok = r && r.gray && r.blurred && r.edges && Array.isArray(r.stats) && r.stats.length === 4;
      t.check(`${w}×${h}: runPipeline returns the buffers and 4 stats`, ok, "return { gray, blurred, edges, stats: [4 launch results] }");
      if (!ok) continue;
      const ref = reference(rgb.data, w, h);
      for (const [name, got, want] of [["grayscale", r.gray, ref.gray], ["blur", r.blurred, ref.blur], ["Sobel", r.edges, ref.edges]]) {
        let bad = -1;
        for (let p = 0; p < w * h; p++) if (!close(got.data[p], want[p])) { bad = p; break; }
        t.check(`${w}×${h}: ${name} correct`, bad < 0, bad >= 0 ? `pixel (${bad % w}, ${Math.floor(bad / w)}): got ${got.data[bad]}, expected ${want[bad].toFixed(3)}` : "");
      }
      if (w >= 32) {
        const need = [0.95, 0.8, 0.8, 0.8], names = ["grayscale", "blurH", "blurV", "sobel"];
        r.stats.forEach((s, k) => t.check(`${w}×${h}: ${names[k]} coalescing ≥ ${need[k] * 100}%`, s.coalescing >= need[k], `${(s.coalescing * 100).toFixed(1)}%`));
      }
      let offenders = 0, where = "";
      r.stats.forEach((s, k) => {
        for (const wt of s.warpTrace || []) {
          if (wt.divergent === 0) continue;
          const outBuf = [r.gray, null, r.blurred, r.edges][k];
          const idx = k === 1 ? Object.values(wt.stores).flat() : (wt.stores[outBuf.id] || []);
          if (idx.length >= wt.lanes) { offenders++; if (!where) where = `kernel ${k + 1}, block (${wt.block.x}, ${wt.block.y}) warp ${wt.warp}`; }
        }
      });
      t.check(`${w}×${h}: no divergence in warps inside the image`, offenders === 0, `${offenders} warps diverged, e.g. ${where}`);
    }
    t.gpu.trace = false;
  },
});
