GW.exercise({
  id: "1-2-a",
  title: "Mirror an image (2D grid)",
  file: "flip.js",
  prompt: `
<p>Write a 2D kernel <code>flipH(src, dst, width, height)</code> that mirrors an RGB image left to right: pixel <code>(x, y)</code> of <code>dst</code> is pixel <code>(width − 1 − x, y)</code> of <code>src</code>. Images are <code>u8</code> buffers, row-major, 3 bytes per pixel.</p>
<p>Then write <code>runFlip(src, dst, width, height)</code>, which launches it with <strong>16×16 blocks</strong> on a 2D grid and returns the stats. The checks use sizes that aren't multiples of 16, and a 1×1 image.</p>
<p><code>gpu.image(w, h)</code> gives you a test image, and <code>show(buffer, w, h)</code> draws one in the console.</p>`,
  starter: `
function flipH(src, dst, width, height) {
  // TODO: x, y from the 2D indices; guard; copy 3 channels
}

function runFlip(src, dst, width, height) {
  // TODO: 16x16 blocks, 2D grid
}

function main() {
  const w = 120, h = 80;
  const src = gpu.image(w, h);
  const dst = gpu.alloc(w * h * 3, "u8");
  table(runFlip(src, dst, w, h));
  show(src, w, h, { label: "input" });
  show(dst, w, h, { label: "mirrored" });
}
`,
  tests(t) {
    const run = t.fn("runFlip");
    for (const [w, h] of [[37, 23], [64, 64], [1, 1], [100, 3]]) {
      const src = t.gpu.image(w, h), dst = t.gpu.alloc(w * h * 3, "u8");
      const s = run(src, dst, w, h);
      let bad = null;
      for (let y = 0; y < h && !bad; y++) for (let x = 0; x < w && !bad; x++) for (let c = 0; c < 3; c++) {
        if (dst.data[(y * w + x) * 3 + c] !== src.data[(y * w + (w - 1 - x)) * 3 + c]) { bad = `pixel (${x}, ${y}) channel ${c}`; break; }
      }
      t.check(`${w}×${h}: mirrored correctly`, !bad, bad ? `wrong at ${bad}` : "");
      const gx = Math.ceil(w / 16), gy = Math.ceil(h / 16);
      t.check(`${w}×${h}: 16×16 blocks on a ${gx}×${gy} grid`, s && s.blocks === gx * gy && s.threads === gx * gy * 256,
        s ? `launched ${s.blocks} blocks, ${s.threads} threads` : "return the stats");
    }
  },
});
