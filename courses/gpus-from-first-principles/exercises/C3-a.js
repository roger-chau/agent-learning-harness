GW.exercise({
  id: "C3-a",
  title: "SGEMM at 60% of peak",
  file: "gemm_fast.js",
  prompt: `<p>Implement <code>gemmFast</code> and <code>runFast(A, B, C, n)</code>. Paste the numbers from each step into your optimisation log.</p>`,
  starter: `
function gemmFast(A, B, C, n) {
  // TODO: start from your C2 kernel
}
function runFast(A, B, C, n) {
  // TODO: declare registers (and ilp, only if your loop overlaps)
}

function main() {
  const n = 256;
  const A = gpu.from(Array.from({ length: n * n }, (_, i) => (i % 7) / 4));
  const B = gpu.from(Array.from({ length: n * n }, (_, i) => (i % 5) - 2));
  const s = runFast(A, B, gpu.alloc(n * n), n);
  print(s.percentOfPeakFp32 + "% of FP32 peak, limited by " + s.limitedBy);
  table(s);
}
`,
  tests(t) {
    const run = t.fn("runFast");
    for (const n of [64, 256]) {
      const A = t.gpu.from(Array.from({ length: n * n }, (_, i) => ((i * 7) % 11) / 8)), B = t.gpu.from(Array.from({ length: n * n }, (_, i) => ((i * 5) % 13) / 8 - 0.5));
      const ref = new Float64Array(n * n);
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) { const a = A.data[r * n + k]; for (let c = 0; c < n; c++) ref[r * n + c] += a * B.data[k * n + c]; }
      const C = t.gpu.alloc(n * n);
      const s = run(A, B, C, n);
      let e = 0; for (let i = 0; i < n * n; i++) e = Math.max(e, Math.abs(C.data[i] - ref[i]));
      t.check(`n = ${n}: correct`, !!s && e < 1e-3, s ? `max error ${e}` : "return the stats");
      if (s && n === 256) {
        t.check("uses fma() for every multiply-add", s.flops === 2 * n ** 3, `flops ${s.flops}`);
        t.check("≥ 60% of FP32 peak", s.percentOfPeakFp32 >= 60, `${s.percentOfPeakFp32}% (${s.achievedGflops} GFLOP/s), limited by ${s.limitedBy}`);
      }
    }
  },
});
