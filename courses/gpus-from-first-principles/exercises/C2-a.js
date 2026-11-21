GW.exercise({
  id: "C2-a",
  title: "Register-tiled SGEMM at 40% of peak",
  file: "gemm_reg.js",
  prompt: `<p>Implement <code>gemmReg</code> and <code>runReg(A, B, C, n)</code>.</p>`,
  starter: `
function gemmReg(A, B, C, n) {
  // TODO: shared tiles (A transposed), thread outer products with ldg4 and fma
}
function runReg(A, B, C, n) {
  // TODO
}

function main() {
  const n = 256;
  const A = gpu.from(Array.from({ length: n * n }, (_, i) => (i % 7) / 4));
  const B = gpu.from(Array.from({ length: n * n }, (_, i) => (i % 5) - 2));
  table(runReg(A, B, gpu.alloc(n * n), n));
}
`,
  tests(t) {
    const run = t.fn("runReg");
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
        t.check("≥ 40% of FP32 peak", s.percentOfPeakFp32 >= 40, `${s.percentOfPeakFp32}% (${s.achievedGflops} GFLOP/s), limited by ${s.limitedBy}`);
      }
    }
  },
});
