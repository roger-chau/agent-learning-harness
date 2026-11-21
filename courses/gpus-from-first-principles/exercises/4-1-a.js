GW.exercise({
  id: "4-1-a",
  title: "GEMM arithmetic, and a naive kernel that's counted",
  file: "gemm_naive.js",
  prompt: `
<ol>
<li><code>gemmFlops(m, n, k)</code>, <code>minBytes(m, n, k)</code> (FP32, read A and B once, write C once), and <code>maxIntensity(m, n, k)</code>.</li>
<li><code>naiveFmaShare(loadsPerFma, branchesPerFma)</code>: the fraction of issued instructions that are FMAs if every FMA comes with that many loads and branches.</li>
<li>Kernel <code>gemmNaive(A, B, C, n)</code> using <code>fma()</code>, and <code>runNaive(A, B, C, n)</code> with 16×16 blocks returning the stats. The checks verify the result and that <code>flops</code> equals 2n³.</li>
</ol>`,
  starter: `
function gemmFlops(m, n, k) {
  // TODO
}
function minBytes(m, n, k) {
  // TODO
}
function maxIntensity(m, n, k) {
  // TODO
}
function naiveFmaShare(loadsPerFma, branchesPerFma) {
  // TODO
}

function gemmNaive(A, B, C, n) {
  // TODO
}
function runNaive(A, B, C, n) {
  // TODO
}

function main() {
  const n = 64;
  const A = gpu.from(Array.from({ length: n * n }, (_, i) => (i % 7) / 4));
  const B = gpu.from(Array.from({ length: n * n }, (_, i) => (i % 5) - 2));
  const C = gpu.alloc(n * n);
  table(runNaive(A, B, C, n));
}
`,
  tests(t) {
    const gf = t.fn("gemmFlops"), mb = t.fn("minBytes"), mi = t.fn("maxIntensity"), sh = t.fn("naiveFmaShare"), run = t.fn("runNaive");
    t.check("gemmFlops(256, 256, 256)", gf(256, 256, 256) === 2 * 256 ** 3, `got ${gf(256, 256, 256)}`);
    t.check("gemmFlops(128, 64, 32)", gf(128, 64, 32) === 2 * 128 * 64 * 32, `got ${gf(128, 64, 32)}`);
    t.check("minBytes(128, 64, 32) = 4·(mk + kn + mn)", mb(128, 64, 32) === 4 * (128 * 32 + 32 * 64 + 128 * 64), `got ${mb(128, 64, 32)}`);
    t.check("maxIntensity(256, 256, 256) ≈ 42.67", t.approx(mi(256, 256, 256), 256 / 6, 1e-9), `got ${mi(256, 256, 256)}`);
    t.check("naiveFmaShare(2, 1) = 0.25", t.approx(sh(2, 1), 0.25), `got ${sh(2, 1)}`);
    t.check("naiveFmaShare(0.125, 0.0625)", t.approx(sh(0.125, 0.0625), 1 / 1.1875), `got ${sh(0.125, 0.0625)}`);
    for (const n of [32, 48]) {
      const A = t.gpu.from(Array.from({ length: n * n }, (_, i) => ((i * 7) % 11) / 8)), B = t.gpu.from(Array.from({ length: n * n }, (_, i) => ((i * 5) % 13) / 8 - 0.5));
      const C = t.gpu.alloc(n * n);
      const s = run(A, B, C, n);
      let bad = -1;
      for (let r = 0; r < n && bad < 0; r++) for (let c = 0; c < n; c++) {
        let w = 0; for (let k = 0; k < n; k++) w += A.data[r * n + k] * B.data[k * n + c];
        if (Math.abs(C.data[r * n + c] - w) > 1e-3) { bad = r * n + c; break; }
      }
      t.check(`n = ${n}: C correct`, bad < 0 && !!s, !s ? "return the stats" : `C[${bad}] = ${C.data[bad]}`);
      if (s) t.check(`n = ${n}: uses fma() (flops = 2n³)`, s.flops === 2 * n ** 3, `flops = ${s.flops}`);
    }
  },
});
