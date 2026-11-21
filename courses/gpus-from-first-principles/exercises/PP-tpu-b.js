GW.exercise({
  id: "PP-tpu-b",
  title: "Tiling a big matrix onto the array",
  file: "tpu_matmul.js",
  prompt: `<p>Implement <code>tpuMatmul(X, W, M, K, N, S, overlap)</code> → <code>{ Y, cycles, utilisation }</code>, using your <code>systolic</code> from part 1 for each tile (paste it in).</p>`,
  starter: `
function systolic(X, W, M, K, N) {
  // paste part 1 here
}
function tpuMatmul(X, W, M, K, N, S, overlap) {
  // TODO: for each S x S tile of W: slice X's columns, run systolic, accumulate into Y
}

function main() {
  const S = 16, K = 64, N = 64;
  for (const M of [1, 16, 256]) {
    const X = new Array(M * K).fill(1), W = new Array(K * N).fill(1);
    const r = tpuMatmul(X, W, M, K, N, S, true);
    print("M =", M, "cycles", r.cycles, "utilisation", r.utilisation.toFixed(3));
  }
}
`,
  tests(t) {
    const tm = t.fn("tpuMatmul");
    const cases = [[3, 8, 8, 4], [10, 8, 12, 4], [1, 16, 16, 8], [32, 16, 8, 8]];
    for (const [M, K, N, S] of cases) {
      const X = Array.from({ length: M * K }, (_, i) => ((i * 5) % 9) - 4), W = Array.from({ length: K * N }, (_, i) => ((i * 7) % 11) - 5);
      const Y = new Array(M * N).fill(0);
      for (let m = 0; m < M; m++) for (let k = 0; k < K; k++) for (let j = 0; j < N; j++) Y[m * N + j] += X[m * K + k] * W[k * N + j];
      const tiles = (K / S) * (N / S), per = M + 2 * S - 2;
      for (const ov of [false, true]) {
        const r = tm(X, W, M, K, N, S, ov) || {};
        const want = ov ? S + tiles * per : tiles * (S + per), label = `${M}×${K}·${K}×${N} on ${S}×${S}, overlap ${ov}`;
        t.check(`${label}: Y correct`, Array.isArray(r.Y) && r.Y.length === M * N && r.Y.every((v, i) => v === Y[i]), "wrong result");
        t.check(`${label}: cycles = ${want}`, r.cycles === want, `got ${r.cycles}`);
        t.check(`${label}: utilisation`, t.approx(r.utilisation, (M * K * N) / (want * S * S)), `got ${r.utilisation}, expected ${(M * K * N) / (want * S * S)}`);
      }
    }
  },
});
