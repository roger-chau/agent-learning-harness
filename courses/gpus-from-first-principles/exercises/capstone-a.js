GW.exercise({
  id: "capstone-a",
  title: "Fused attention",
  file: "attention.js",
  prompt: `<p>Implement <code>runAttention(Q, K, V, O, N, d, causal)</code> as one fused, IO-aware kernel (or a few, as long as no N × N matrix reaches DRAM).</p>`,
  starter: `
// The naive version: S = QK^T / sqrt(d) written to memory, softmax per row, then O = P V.
const NAIVE = gpu.compile(\`
function scores(Q, K, S, N, d, causal) {
  const i = blockIdx.y * 16 + threadIdx.y, j = blockIdx.x * 16 + threadIdx.x;
  let s = 0;
  for (let k = 0; k < d; k++) s = fma(Q[i * d + k], K[j * d + k], s);
  S[i * N + j] = causal && j > i ? -Infinity : s / Math.sqrt(d);
}
function softmaxRows(S, N) {
  const r = blockIdx.x, t = threadIdx.x, lane = t & 31, w = t >> 5, red = shared("red", 4);
  let m = -Infinity;
  for (let c = t; c < N; c += 128) m = Math.max(m, S[r * N + c]);
  for (let o = 16; o > 0; o >>= 1) m = Math.max(m, __shfl_xor_sync(0xffffffff, m, o));
  if (lane === 0) red[w] = m;
  __syncthreads();
  m = Math.max(Math.max(red[0], red[1]), Math.max(red[2], red[3]));
  __syncthreads();
  let s = 0;
  for (let c = t; c < N; c += 128) s += Math.exp(S[r * N + c] - m);
  for (let o = 16; o > 0; o >>= 1) s += __shfl_xor_sync(0xffffffff, s, o);
  if (lane === 0) red[w] = s;
  __syncthreads();
  s = red[0] + red[1] + red[2] + red[3];
  for (let c = t; c < N; c += 128) S[r * N + c] = Math.exp(S[r * N + c] - m) / s;
}
function pv(S, V, O, N, d) {
  const i = blockIdx.x * 4 + (threadIdx.x >> 5), c = threadIdx.x & 31;
  let o = 0;
  for (let j = 0; j < N; j++) o = fma(S[i * N + j], V[j * d + c], o);
  O[i * d + c] = o;
}
\`);
function runNaive(Q, K, V, O, N, d, causal) {
  const S = gpu.alloc(N * N);
  return [
    gpu.launch(NAIVE.scores, { grid: { x: N / 16, y: N / 16 }, block: { x: 16, y: 16 } }, Q, K, S, N, d, causal),
    gpu.launch(NAIVE.softmaxRows, { grid: N, block: 128 }, S, N),
    gpu.launch(NAIVE.pv, { grid: N / 4, block: 128 }, S, V, O, N, d),
  ];
}

const FUSED = gpu.compile(\`
function flash(Q, K, V, O, N, d, causal) {
  // TODO: your fused kernel
}
\`);
function runAttention(Q, K, V, O, N, d, causal) {
  return runNaive(Q, K, V, O, N, d, causal); // TODO
}

function main() {
  const N = 256, d = 32;
  const Q = gpu.from(Array.from({ length: N * d }, (_, i) => Math.sin(i * 0.37)));
  const K = gpu.from(Array.from({ length: N * d }, (_, i) => Math.cos(i * 0.23)));
  const V = gpu.from(Array.from({ length: N * d }, (_, i) => ((i * 7) % 11) / 5 - 1));
  for (const causal of [false, true]) {
    const st = runAttention(Q, K, V, gpu.alloc(N * d), N, d, causal);
    print(causal ? "causal:" : "full:  ", st.reduce((a, s) => a + s.cycles, 0), "cycles,", st.reduce((a, s) => a + s.dramBytes, 0), "DRAM bytes |", st.map((s) => s.limitedBy + " " + JSON.stringify(s.sol) + " balance " + s.smBalance).join(" | "));
  }
}
`,
  tests(t) {
    const run = t.fn("runAttention"), d = 32;
    const total = (st, k) => (Array.isArray(st) && st.length ? st.reduce((a, s) => a + (s[k] || 0), 0) : NaN);
    const ref = (Q, K, V, N, causal) => {
      const O = new Float64Array(N * d);
      for (let i = 0; i < N; i++) {
        const s = [];
        for (let j = 0; j < N; j++) { if (causal && j > i) { s.push(-Infinity); continue; } let v = 0; for (let k = 0; k < d; k++) v += Q[i * d + k] * K[j * d + k]; s.push(v / Math.sqrt(d)); }
        const m = Math.max(...s), e = s.map((x) => Math.exp(x - m)), l = e.reduce((a, b) => a + b, 0);
        for (let j = 0; j < N; j++) if (e[j]) for (let k = 0; k < d; k++) O[i * d + k] += (e[j] / l) * V[j * d + k];
      }
      return O;
    };
    const cyc = {};
    for (const N of [128, 256]) for (const causal of [false, true]) {
      const Q = t.gpu.from(Array.from({ length: N * d }, (_, i) => Math.sin(i * 0.41) * 1.5)), K = t.gpu.from(Array.from({ length: N * d }, (_, i) => Math.cos(i * 0.19) * 1.5)), V = t.gpu.from(Array.from({ length: N * d }, (_, i) => ((i * 5) % 13) / 6 - 1));
      const O = t.gpu.from(new Array(N * d).fill(7));
      const st = run(Q, K, V, O, N, d, causal), R = ref(Q.data, K.data, V.data, N, causal);
      let e = 0; for (let i = 0; i < N * d; i++) e = Math.max(e, Math.abs(O.data[i] - R[i]));
      const label = `N = ${N}, ${causal ? "causal" : "full"}`;
      t.check(`${label}: exact (max error ≤ 1e-5)`, e <= 1e-5, `max error ${e}`);
      if (N === 256) {
        cyc[causal] = total(st, "cycles");
        if (!causal) {
          const qkvo = 4 * N * d * 4;
          t.check("N = 256: no N×N traffic (DRAM ≤ 1.5 × Q, K, V, O)", total(st, "dramBytes") <= 1.5 * qkvo, `${total(st, "dramBytes")} bytes vs ${qkvo}`);
          t.check("N = 256: ≥ 3× faster than naive (≤ 25,584 cycles)", cyc[false] <= 76752 / 3, `${cyc[false]} cycles (${(76752 / cyc[false]).toFixed(2)}×)`);
        } else {
          const r = cyc[true] / cyc[false];
          t.check("N = 256: causal ≤ 0.8 × your full time", r <= 0.8, `causal ${cyc[true]} / full ${cyc[false]} = ${r.toFixed(3)}${r <= 0.65 ? " (stretch met)" : ""}`);
        }
      }
    }
  },
});
