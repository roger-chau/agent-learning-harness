GW.exercise({
  id: "C4-a",
  title: "Tensor-core GEMM at 2× the FP32 roof",
  file: "gemm_tc.js",
  prompt: `<p>Implement <code>gemmTC</code> and <code>runTC(A, B, C, n)</code> with <code>__mma_sync</code>.</p>`,
  starter: `
function gemmTC(A, B, C, n) {
  // TODO: stage tiles in shared memory; each warp accumulates a 16x16 tile with __mma_sync
}
function runTC(A, B, C, n) {
  // TODO
}

function main() {
  const n = 256;
  const A = gpu.from(Array.from({ length: n * n }, (_, i) => Math.sin(i)));
  const B = gpu.from(Array.from({ length: n * n }, (_, i) => Math.cos(i * 0.7)));
  const s = runTC(A, B, gpu.alloc(n * n), n);
  print(s.percentOfPeakFp32 + "% of FP32 peak, limited by " + s.limitedBy);
  table(s);
}
`,
  tests(t) {
    const run = t.fn("runTC");
    for (const n of [64, 256]) {
      const A = t.gpu.from(Array.from({ length: n * n }, (_, i) => Math.sin(i * 1.3))), B = t.gpu.from(Array.from({ length: n * n }, (_, i) => Math.cos(i * 0.7) * 0.9));
      const ref = new Float64Array(n * n);
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) { const a = A.data[r * n + k]; for (let c = 0; c < n; c++) ref[r * n + c] += a * B.data[k * n + c]; }
      let mA = 0, mB = 0; for (let i = 0; i < n * n; i++) { mA = Math.max(mA, Math.abs(A.data[i])); mB = Math.max(mB, Math.abs(B.data[i])); }
      const budget = n * mA * mB * 2 * 2 ** -11;
      const C = t.gpu.alloc(n * n);
      const s = run(A, B, C, n);
      let e = 0; for (let i = 0; i < n * n; i++) e = Math.max(e, Math.abs(C.data[i] - ref[i]));
      t.check(`n = ${n}: within the FP16 error budget`, !!s && e <= budget, s ? `max error ${e.toFixed(5)}, budget ${budget.toFixed(5)}` : "return the stats");
      if (s && n === 256) {
        t.check("uses tensor cores", s.tensorOps > 0, `tensorOps ${s.tensorOps}`);
        t.check("≥ 200% of the FP32 peak", s.percentOfPeakFp32 >= 200, `${s.percentOfPeakFp32}% (${s.achievedGflops} GFLOP/s), limited by ${s.limitedBy}`);
      }
    }
  },
});
