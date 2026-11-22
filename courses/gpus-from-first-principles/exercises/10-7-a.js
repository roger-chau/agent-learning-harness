GW.exercise({
  id: "10-7-a",
  title: "A convolution layer as a GEMM",
  file: "conv_layer.js",
  prompt: `
<p>A convolution layer: input <code>inp</code> with C channels of H × W (<code>f32</code>, channel-major), M filters of C × K × K in <code>weights</code> (filter m, channel c, row ky, column kx at <code>((m·C + c)·K + ky)·K + kx</code>), stride 1, no padding. Output: M maps of Ho × Wo, with Ho = H − K + 1, Wo = W − K + 1.</p>
<p>Lower it to a GEMM. Write <code>im2col(inp, X, C, H, W, K)</code>: build the matrix X with <code>C·K·K</code> rows and <code>Ho·Wo</code> columns, where row <code>(c·K + ky)·K + kx</code>, column <code>oy·Wo + ox</code> holds <code>inp[c][oy + ky][ox + kx]</code>. Then <code>out = weights · X</code> (M × CK² times CK² × HoWo) is exactly the layer's output. A simple <code>gemm</code> is given.</p>
<p>Map consecutive threads to <strong>consecutive columns</strong> of X (grid.y = the row) so writes to X coalesce. <code>runConvLayer(...)</code> allocates X, launches <code>im2col</code> (128-thread blocks) then <code>gemm</code>, and returns the <code>im2col</code> stats. The checks need a correct output and im2col coalescing of at least 0.75 (a thread-per-row mapping gets about 0.18).</p>`,
  starter: `
function im2col(inp, X, C, H, W, K) {
  // TODO: col from blockIdx.x * blockDim.x + threadIdx.x, row from blockIdx.y
}

// Given: C[M x N] = A[M x Kd] * B[Kd x N], one thread per output.
function gemm(A, B, Cm, M, N, Kd) {
  const j = blockIdx.x * blockDim.x + threadIdx.x, i = blockIdx.y;
  if (j >= N) return;
  let s = 0;
  for (let k = 0; k < Kd; k++) s = fma(A[i * Kd + k], B[k * N + j], s);
  Cm[i * N + j] = s;
}
function runConvLayer(inp, weights, out, C, H, W, M, K) {
  // TODO: X = alloc(C*K*K * Ho*Wo); im2col; gemm(weights, X, out, M, Ho*Wo, C*K*K); return im2col's stats
}

function main() {
  const C = 1, H = 4, W = 4, M = 1, K = 3;
  const inp = gpu.from(Array.from({ length: 16 }, (_, i) => i), "f32"), w = gpu.from([0, 0, 0, 0, 1, 0, 0, 0, 0], "f32");
  const out = gpu.alloc(4, "f32");
  table(runConvLayer(inp, w, out, C, H, W, M, K));
  print(out.toArray(), "should be", [5, 6, 9, 10]);
}
`,
  tests(t) {
    const run = t.fn("runConvLayer");
    for (const [C, H, W, M, K] of [[3, 20, 22, 4, 3], [2, 9, 7, 3, 5]]) {
      const Ho = H - K + 1, Wo = W - K + 1;
      const xs = Array.from({ length: C * H * W }, (_, i) => (i * 7) % 9 - 4), ws = Array.from({ length: M * C * K * K }, (_, i) => (i * 5) % 7 - 3);
      const out = t.gpu.alloc(M * Ho * Wo, "f32");
      const s = run(t.gpu.from(xs, "f32"), t.gpu.from(ws, "f32"), out, C, H, W, M, K);
      let bad = -1;
      for (let m = 0; m < M && bad < 0; m++) for (let oy = 0; oy < Ho && bad < 0; oy++) for (let ox = 0; ox < Wo; ox++) {
        let a = 0;
        for (let c = 0; c < C; c++) for (let ky = 0; ky < K; ky++) for (let kx = 0; kx < K; kx++) a += ws[((m * C + c) * K + ky) * K + kx] * xs[(c * H + oy + ky) * W + ox + kx];
        if (out.data[(m * Ho + oy) * Wo + ox] !== a) { bad = (m * Ho + oy) * Wo + ox; break; }
      }
      t.check(`C=${C}, ${H}×${W}, M=${M}, K=${K}: output correct`, bad < 0 && !!s, !s ? "return im2col's stats" : `output ${bad}: ${out.data[bad]}`);
      if (s && C === 3) t.check("im2col writes coalesce (coalescing ≥ 0.75)", s.coalescing >= 0.75, `coalescing ${s.coalescing}`);
    }
  },
});
