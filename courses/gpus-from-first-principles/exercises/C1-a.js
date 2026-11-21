GW.exercise({
  id: "C1-a",
  title: "Tiled SGEMM in shared memory",
  file: "gemm_tiled.js",
  prompt: `<p>Implement <code>gemmNaive</code>/<code>runNaive</code> and <code>gemmTiled</code>/<code>runTiled</code> as described.</p>`,
  starter: `
function gemmNaive(A, B, C, n) {
  // TODO (your 4.1 kernel)
}
function runNaive(A, B, C, n) {
  // TODO
}

function gemmTiled(A, B, C, n) {
  // TODO: 16x16 tiles of A and B in shared memory
}
function runTiled(A, B, C, n) {
  // TODO
}

function main() {
  const n = 128;
  const A = gpu.from(Array.from({ length: n * n }, (_, i) => (i % 7) / 4));
  const B = gpu.from(Array.from({ length: n * n }, (_, i) => (i % 5) - 2));
  print("naive:"); table(runNaive(A, B, gpu.alloc(n * n), n));
  print("tiled:"); table(runTiled(A, B, gpu.alloc(n * n), n));
}
`,
  tests(t) {
    const rn = t.fn("runNaive"), rt = t.fn("runTiled");
    const share = (s) => s.fmaInstructions / (s.memInstructions + s.branches + s.sharedWavefronts + s.barriers + s.fmaInstructions + s.warpOps);
    for (const n of [32, 128]) {
      const A = t.gpu.from(Array.from({ length: n * n }, (_, i) => ((i * 7) % 11) / 8)), B = t.gpu.from(Array.from({ length: n * n }, (_, i) => ((i * 5) % 13) / 8 - 0.5));
      const ref = new Float64Array(n * n);
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) { const a = A.data[r * n + k]; for (let c = 0; c < n; c++) ref[r * n + c] += a * B.data[k * n + c]; }
      const Cn = t.gpu.alloc(n * n), Ct = t.gpu.alloc(n * n);
      const sn = rn(A, B, Cn, n), st = rt(A, B, Ct, n);
      const err = (C) => { let e = 0; for (let i = 0; i < n * n; i++) e = Math.max(e, Math.abs(C.data[i] - ref[i])); return e; };
      t.check(`n = ${n}: naive correct`, !!sn && err(Cn) < 1e-3, sn ? `max error ${err(Cn)}` : "return the stats");
      t.check(`n = ${n}: tiled correct`, !!st && err(Ct) < 1e-3, st ? `max error ${err(Ct)}` : "return the stats");
      if (!sn || !st || n !== 128) continue;
      t.check("both use fma() for every multiply-add", sn.flops === 2 * n ** 3 && st.flops === 2 * n ** 3, `naive ${sn.flops}, tiled ${st.flops} FLOPs`);
      t.check("tiled uses shared memory", st.sharedLoads > 0, `${st.sharedLoads} shared loads`);
      const bn = sn.bytesMoved / (sn.flops / 2), bt = st.bytesMoved / (st.flops / 2);
      t.check("global traffic per FMA ≥ 4× lower than naive", bn / bt >= 4, `naive ${bn.toFixed(3)} B/FMA, tiled ${bt.toFixed(3)} B/FMA (${(bn / bt).toFixed(1)}×)`);
      t.check("FMA share of issued instructions ≥ 27%", share(st) >= 0.27, `${(share(st) * 100).toFixed(1)}%`);
    }
  },
});
