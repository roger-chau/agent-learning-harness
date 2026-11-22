GW.exercise({
  id: "10-1-a",
  title: "Tiled 2-D convolution with halos",
  file: "conv2d.js",
  prompt: `
<p>Write <code>conv2d(img, filt, out, W, H, R)</code>: a 2-D convolution of the <code>f32</code> image <code>img</code> (W × H, row-major) with the 5 × 5 filter <code>filt</code> (R = 2), zero ghost cells outside the image, writing <code>out</code>.</p>
<p>Use <strong>16 × 16 output tiles</strong>: each block loads its 20 × 20 input tile (with the halo) into shared memory once, synchronises, and computes its outputs from shared memory. Load the filter into shared memory too. Use <code>fma</code> for the multiply-adds.</p>
<p><code>runConv(img, filt, out, W, H)</code> launches it with 16 × 16 blocks covering the image and returns the stats. The checks require correct results (including edges and partial tiles) and at most 1 sector of global traffic per output on average.</p>`,
  starter: `
function conv2d(img, filt, out, W, H, R) {
  // TODO: shared tile of (16 + 2R) x (16 + 2R) inputs, loaded in a strided loop, then compute
}

function runConv(img, filt, out, W, H) {
  // TODO: 16 x 16 blocks over the image
}

function main() {
  const W = 40, H = 24;
  const img = gpu.from(Array.from({ length: W * H }, (_, i) => (i % 7) - 3), "f32");
  const filt = gpu.from(Array.from({ length: 25 }, (_, i) => (i === 12 ? 1 : 0)), "f32");  // identity
  const out = gpu.alloc(W * H, "f32");
  table(runConv(img, filt, out, W, H));
  print(out.toArray().slice(0, 8), "should equal", img.toArray().slice(0, 8));
}
`,
  tests(t) {
    const run = t.fn("runConv");
    for (const [W, H] of [[96, 64], [37, 21]]) {
      const xs = Array.from({ length: W * H }, (_, i) => ((i * 7) % 13) - 6);
      const fs = Array.from({ length: 25 }, (_, i) => (i % 5) - 2 + (i > 12 ? 1 : 0));
      const img = t.gpu.from(xs, "f32"), filt = t.gpu.from(fs, "f32"), out = t.gpu.alloc(W * H, "f32");
      const s = run(img, filt, out, W, H);
      let bad = -1;
      for (let y = 0; y < H && bad < 0; y++) for (let x = 0; x < W; x++) {
        let a = 0;
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
          const gx = x + i, gy = y + j;
          if (gx >= 0 && gx < W && gy >= 0 && gy < H) a += fs[(j + 2) * 5 + i + 2] * xs[gy * W + gx];
        }
        if (out.data[y * W + x] !== a) { bad = y * W + x; break; }
      }
      t.check(`${W} × ${H}: correct, including edges and partial tiles`, bad < 0 && !!s, !s ? "return the stats" : `pixel ${bad}: ${out.data[bad]}`);
      if (s && W === 96) {
        t.check("uses shared memory", s.sharedLoads > 0, "load the tile into shared() memory");
        t.check("at most 1 sector of global traffic per output (naive: about 5.5)", s.transactions <= W * H, `${(s.transactions / (W * H)).toFixed(2)} sectors per output`);
      }
    }
  },
});
