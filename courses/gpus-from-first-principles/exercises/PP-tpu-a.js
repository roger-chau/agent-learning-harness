GW.exercise({
  id: "PP-tpu-a",
  title: "A weight-stationary systolic array",
  file: "systolic.js",
  prompt: `<p>Implement <code>systolic(X, W, M, K, N)</code> → <code>{ Y, cycles, busy }</code>, simulating every cell's registers each cycle.</p>`,
  starter: `
function systolic(X, W, M, K, N) {
  // X: flat M x K, W: flat K x N. Cell (i, j) holds W[i * N + j].
  // Per cycle: activations move right, partial sums move down.
  // TODO
}

function main() {
  const M = 3, K = 2, N = 2;
  const r = systolic([1, 2, 3, 4, 5, 6], [1, 0, 0, 1], M, K, N);
  print(JSON.stringify(r));
}
`,
  tests(t) {
    const sys = t.fn("systolic");
    for (const [M, K, N] of [[1, 1, 1], [3, 2, 2], [5, 4, 3], [8, 8, 8], [2, 6, 4]]) {
      const X = Array.from({ length: M * K }, (_, i) => ((i * 7) % 5) - 2), W = Array.from({ length: K * N }, (_, i) => ((i * 3) % 7) - 3);
      const Y = new Array(M * N).fill(0);
      for (let m = 0; m < M; m++) for (let k = 0; k < K; k++) for (let j = 0; j < N; j++) Y[m * N + j] += X[m * K + k] * W[k * N + j];
      const r = sys(X, W, M, K, N) || {};
      const label = `${M}×${K} · ${K}×${N}`;
      t.check(`${label}: Y correct`, Array.isArray(r.Y) && r.Y.length === M * N && r.Y.every((v, i) => v === Y[i]), `got ${JSON.stringify(r.Y)}`);
      t.check(`${label}: cycles = ${M + K + N - 2}`, r.cycles === M + K + N - 2, `got ${r.cycles}`);
      const want = new Array(M + K + N - 2).fill(0);
      for (let m = 0; m < M; m++) for (let i = 0; i < K; i++) for (let j = 0; j < N; j++) want[m + i + j]++;
      t.check(`${label}: busy trace`, Array.isArray(r.busy) && r.busy.length === want.length && r.busy.every((v, i) => v === want[i]), `got ${JSON.stringify(r.busy)}, expected ${JSON.stringify(want)}`);
    }
  },
});
