GW.exercise({
  id: "0-4-b",
  title: "2-D kernels and grid-stride loops",
  file: "launch_shapes.js",
  prompt: `
<ol>
<li><code>runInvert(img, out, W, H)</code>: launch a 2-D kernel with 32 × 8 blocks that writes <code>out[y·W + x] = 255 − img[y·W + x]</code> for every pixel. Sizes won't be multiples of the block. Return the launch stats. Map <code>threadIdx.x</code> to <code>x</code> (columns) so warps read consecutive addresses: the test checks coalescing.</li>
<li><code>runScale(x, y, n, a)</code>: <code>y[i] = a · x[i]</code> with a <strong>grid-stride loop</strong> on a fixed grid of exactly 32 blocks × 256 threads, whatever <code>n</code> is. Return the stats.</li>
<li><code>launchShape(W, H, bx, by)</code>: <code>{ gridX, gridY, idle }</code>, where <code>idle</code> counts the launched threads outside the image.</li>
</ol>`,
  starter: `
const K = gpu.compile(\`
function invert(img, out, W, H) {
  // TODO: 2-D indices, guard both
}
function scale(x, y, n, a) {
  // TODO: grid-stride loop
}
\`);

function runInvert(img, out, W, H) {
  // TODO
}
function runScale(x, y, n, a) {
  // TODO: grid of exactly 32 blocks of 256
}
function launchShape(W, H, bx, by) {
  // TODO
}

function main() {
  const W = 100, H = 37, img = gpu.from(Array.from({ length: W * H }, (_, i) => i % 256)), out = gpu.alloc(W * H);
  table(runInvert(img, out, W, H));
  print(JSON.stringify(launchShape(1920, 1080, 16, 16)));
}
`,
  tests(t) {
    const ri = t.fn("runInvert"), rs = t.fn("runScale"), ls = t.fn("launchShape");
    for (const [W, H] of [[100, 37], [257, 9], [32, 8], [1, 50]]) {
      const img = t.gpu.from(Array.from({ length: W * H }, (_, i) => (i * 7) % 256)), out = t.gpu.from(new Array(W * H).fill(-1));
      const s = ri(img, out, W, H);
      let ok = true; for (let i = 0; i < W * H; i++) if (out.data[i] !== 255 - img.data[i]) { ok = false; break; }
      t.check(`invert ${W}×${H}: every pixel, nothing out of bounds`, ok && !!s, ok ? "return the stats" : "wrong or missing pixels");
      if (W === 257 && s) t.check("invert: warps read consecutive pixels (coalescing ≥ 0.6; a column-wise mapping gets 0.125)", s.coalescing >= 0.6, `coalescing ${s.coalescing}: is threadIdx.x mapped to x?`);
    }
    for (const n of [1000, 8192, 100003]) {
      const x = t.gpu.from(Array.from({ length: n }, (_, i) => i % 97)), y = t.gpu.from(new Array(n).fill(-1));
      const s = rs(x, y, n, 3);
      let ok = true; for (let i = 0; i < n; i++) if (y.data[i] !== 3 * x.data[i]) { ok = false; break; }
      t.check(`grid-stride scale, n = ${n}: correct`, ok, "some elements missing or wrong");
      t.check(`grid-stride scale, n = ${n}: exactly 32 blocks`, s && s.blocks === 32 && s.threads === 32 * 256, s ? `${s.blocks} blocks, ${s.threads} threads` : "return the stats");
    }
    const eq = (a, b) => a && a.gridX === b.gridX && a.gridY === b.gridY && a.idle === b.idle;
    t.check("launchShape(1920, 1080, 16, 16)", eq(ls(1920, 1080, 16, 16), { gridX: 120, gridY: 68, idle: 15360 }), `got ${JSON.stringify(ls(1920, 1080, 16, 16))}`);
    t.check("launchShape(1000, 600, 32, 8)", eq(ls(1000, 600, 32, 8), { gridX: 32, gridY: 75, idle: 14400 }), `got ${JSON.stringify(ls(1000, 600, 32, 8))}`);
  },
});
