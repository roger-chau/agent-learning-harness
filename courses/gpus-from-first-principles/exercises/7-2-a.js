GW.exercise({
  id: "7-2-a",
  title: "Attention without the N × N matrix",
  file: "attention.js",
  prompt: `
<p>Matrices are flat, row-major arrays: <code>Q</code>, <code>K</code>, <code>V</code> are N × d.</p>
<ol>
<li><code>attention(Q, K, V, N, d)</code>: the reference, O = softmax(QKᵀ / √d) V, building the full score matrix.</li>
<li><code>naiveTraffic(N, d, b)</code>: bytes moved by the naive version with b-byte values: read Q, K, V; write and read S; write and read P; write O.</li>
<li><code>fusedTraffic(N, d, Br, b)</code>: the chapter's tiled estimate, b · (2Nd + 2Nd · ⌈N / Br⌉).</li>
<li><code>tiledAttention(Q, K, V, N, d, Bc)</code>: the same output as <code>attention</code>, processing keys in blocks of <code>Bc</code> with a running max, sum and output per query row. Never build more than one block of scores at a time.</li>
</ol>`,
  starter: `
function attention(Q, K, V, N, d) {
  // TODO
}
function naiveTraffic(N, d, b) {
  // TODO
}
function fusedTraffic(N, d, Br, b) {
  // TODO
}
function tiledAttention(Q, K, V, N, d, Bc) {
  // TODO
}

function main() {
  const N = 8, d = 4;
  const Q = Array.from({ length: N * d }, (_, i) => Math.sin(i)), K = Array.from({ length: N * d }, (_, i) => Math.cos(i)), V = Array.from({ length: N * d }, (_, i) => i % 3);
  print(attention(Q, K, V, N, d));
  print(tiledAttention(Q, K, V, N, d, 3));
  print(naiveTraffic(8192, 128, 2) / 1e6, "MB naive vs", fusedTraffic(8192, 128, 128, 2) / 1e6, "MB fused");
}
`,
  tests(t) {
    const at = t.fn("attention"), nt = t.fn("naiveTraffic"), ft = t.fn("fusedTraffic"), ta = t.fn("tiledAttention");
    const ref = (Q, K, V, N, d) => {
      const O = new Array(N * d).fill(0);
      for (let i = 0; i < N; i++) {
        const s = []; for (let j = 0; j < N; j++) { let v = 0; for (let k = 0; k < d; k++) v += Q[i * d + k] * K[j * d + k]; s.push(v / Math.sqrt(d)); }
        const m = Math.max(...s), e = s.map((x) => Math.exp(x - m)), l = e.reduce((a, b) => a + b, 0);
        for (let j = 0; j < N; j++) for (let k = 0; k < d; k++) O[i * d + k] += (e[j] / l) * V[j * d + k];
      }
      return O;
    };
    const N = 48, d = 16;
    const Q = Array.from({ length: N * d }, (_, i) => Math.sin(i * 0.7) * 3), K = Array.from({ length: N * d }, (_, i) => Math.cos(i * 0.3) * 3), V = Array.from({ length: N * d }, (_, i) => ((i * 7) % 11) - 5);
    const R = ref(Q, K, V, N, d), close = (o) => Array.isArray(o) && o.length === R.length && o.every((x, i) => Math.abs(x - R[i]) < 1e-9);
    t.check("attention matches the definition", close(at(Q, K, V, N, d)), "wrong output");
    t.check("naiveTraffic(1024, 64, 2) = 2·(4·1024·64 + 4·1024²)", nt(1024, 64, 2) === 2 * (4 * 1024 * 64 + 4 * 1024 * 1024), `got ${nt(1024, 64, 2)}`);
    t.check("fusedTraffic(1024, 64, 128, 2) = 2·(2·1024·64 + 2·1024·64·8)", ft(1024, 64, 128, 2) === 2 * (2 * 1024 * 64 + 2 * 1024 * 64 * 8), `got ${ft(1024, 64, 128, 2)}`);
    t.check("fusedTraffic rounds partial tiles up", ft(1000, 64, 128, 2) === 2 * (2 * 1000 * 64 + 2 * 1000 * 64 * 8), `got ${ft(1000, 64, 128, 2)}`);
    for (const Bc of [1, 7, 16, 48]) t.check(`tiledAttention with Bc = ${Bc} is exact`, close(ta(Q, K, V, N, d, Bc)), "differs from the reference");
    const big = Q.map((x) => x * 60);
    const R2 = ref(big, K, V, N, d), o2 = ta(big, K, V, N, d, 8);
    t.check("tiledAttention is stable for large scores", Array.isArray(o2) && o2.every((x, i) => Math.abs(x - R2[i]) < 1e-6), "NaN or wrong with large scores: rescale with the running max");
  },
});
