GW.exercise({
  id: "10-2-a",
  title: "A coarsened 3-D stencil",
  file: "stencil.js",
  prompt: `
<p>Write <code>stencil3d(inp, out, N, CZ)</code> for an N × N × N <code>f32</code> grid (x fastest, then y, then z): every interior point gets <code>2·c + (sum of its 6 face neighbours)</code>; every boundary point (any coordinate 0 or N − 1) is copied unchanged.</p>
<p>Use <strong>thread coarsening in z with register tiling</strong>: launch a 2-D tile of threads over (x, y) with <code>blockIdx.z</code> selecting a chunk of <code>CZ</code> consecutive z-planes. Each thread walks its column through the chunk, keeping the z − 1, z and z + 1 values in registers, so each step loads only one new z-value plus the four x/y neighbours.</p>
<p><code>runStencil(inp, out, N)</code> launches it with 32 × 4 blocks and CZ = 8 and returns the stats. The checks need correct results (also for N not a multiple of 8 or 32), at most 5.5 loads per point (the naive kernel does about 7.6), and a faster run than the naive one at N = 64 (8.8 µs).</p>`,
  starter: `
function stencil3d(inp, out, N, CZ) {
  // TODO: x, y from the 2-D block; z from blockIdx.z * CZ to min(N, +CZ); prev, cur, next in registers
}

function runStencil(inp, out, N) {
  // TODO: 32 x 4 blocks, grid.z = ceil(N / 8)
}

function main() {
  const N = 16;
  const inp = gpu.from(Array.from({ length: N ** 3 }, (_, i) => i % 5), "f32"), out = gpu.alloc(N ** 3, "f32");
  table(runStencil(inp, out, N));
}
`,
  tests(t) {
    const run = t.fn("runStencil");
    for (const N of [21, 64]) {
      const xs = Array.from({ length: N ** 3 }, (_, i) => (i * 7) % 11);
      const inp = t.gpu.from(xs, "f32"), out = t.gpu.alloc(N ** 3, "f32");
      const s = run(inp, out, N);
      let bad = -1;
      for (let z = 0; z < N && bad < 0; z++) for (let y = 0; y < N && bad < 0; y++) for (let x = 0; x < N; x++) {
        const o = (z * N + y) * N + x;
        const want = (x && y && z && x < N - 1 && y < N - 1 && z < N - 1)
          ? 2 * xs[o] + xs[o - 1] + xs[o + 1] + xs[o - N] + xs[o + N] + xs[o - N * N] + xs[o + N * N] : xs[o];
        if (out.data[o] !== want) { bad = o; break; }
      }
      t.check(`N = ${N}: correct (interior and boundary)`, bad < 0 && !!s, !s ? "return the stats" : `point ${bad}: ${out.data[bad]}`);
      if (s && N === 64) {
        const perPoint = (s.loads * 32) / N ** 3;
        t.check("coarsened: at most 5.5 loads per point", perPoint <= 5.5, `${perPoint.toFixed(2)} loads per point`);
        t.check("faster than the naive kernel (8.8 µs)", s.timeUs < 8.0, `${s.timeUs} µs`);
      }
    }
  },
});
