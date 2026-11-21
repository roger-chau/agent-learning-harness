GW.exercise({
  id: "PP-triton-a",
  title: "A tile compiler and autotuner",
  file: "tilec.js",
  prompt: `<p>Implement <code>compileMatmul(cfg)</code> (returns kernel source), <code>launchConfig(cfg, n)</code> and <code>autotune(n, configs, A, B, C, bias)</code>.</p>`,
  starter: `
function compileMatmul(cfg) {
  const { BM, BN, BK, TM, TN, epilogue = "none" } = cfg;
  // TODO: return the source of function matmul(A, B, C, bias, n) { ... } as a string
  return "";
}
function launchConfig(cfg, n) {
  // TODO
}
function autotune(n, configs, A, B, C, bias) {
  // TODO: for each config, gpu.compile(compileMatmul(cfg)).matmul, launch, record cycles
  return { best: null, results: [] };
}

function main() {
  const n = 64;
  const A = gpu.from(Array.from({ length: n * n }, (_, i) => (i % 7) / 7)), B = gpu.from(Array.from({ length: n * n }, (_, i) => (i % 5) / 5 - 0.5));
  const bias = gpu.from(new Array(n).fill(0.1)), C = gpu.alloc(n * n);
  const cfg = { BM: 32, BN: 32, BK: 16, TM: 2, TN: 2, epilogue: "relu" };
  print(compileMatmul(cfg));
  const r = autotune(n, [cfg, { ...cfg, TM: 4, TN: 4 }], A, B, C, bias);
  print(JSON.stringify(r));
}
`,
  tests(t) {
    const cm = t.fn("compileMatmul"), lc = t.fn("launchConfig"), at = t.fn("autotune");
    const mk = (n) => ({
      A: t.gpu.from(Array.from({ length: n * n }, (_, i) => ((i * 7) % 11) / 8 - 0.5)),
      B: t.gpu.from(Array.from({ length: n * n }, (_, i) => ((i * 5) % 13) / 8 - 0.7)),
      bias: t.gpu.from(Array.from({ length: n }, (_, i) => (i % 3) - 1)),
    });
    const n = 64, d = mk(n), prod = new Float64Array(n * n);
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) { const a = d.A.data[r * n + k]; for (let c = 0; c < n; c++) prod[r * n + c] += a * d.B.data[k * n + c]; }
    const EPI = { none: (v) => v, relu: (v) => Math.max(v, 0), "bias-relu": (v, c) => Math.max(v + d.bias.data[c], 0) };
    const cfgs = [{ BM: 16, BN: 16, BK: 16, TM: 1, TN: 1, epilogue: "none" }, { BM: 32, BN: 32, BK: 16, TM: 2, TN: 2, epilogue: "relu" }, { BM: 32, BN: 64, BK: 8, TM: 4, TN: 4, epilogue: "bias-relu" }, { BM: 64, BN: 32, BK: 16, TM: 4, TN: 2, epilogue: "none" }];
    for (const cfg of cfgs) {
      const label = `BM${cfg.BM} BN${cfg.BN} BK${cfg.BK} ${cfg.TM}×${cfg.TN} ${cfg.epilogue}`;
      let k;
      try { k = t.gpu.compile(cm(cfg)).matmul; } catch (e) { t.check(`${label}: compiles`, false, e.message); continue; }
      const C = t.gpu.from(new Array(n * n).fill(5));
      try { t.gpu.launch(k, lc(cfg, n), d.A, d.B, C, d.bias, n); } catch (e) { t.check(`${label}: runs`, false, e.message); continue; }
      let e = 0; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) e = Math.max(e, Math.abs(C.data[r * n + c] - EPI[cfg.epilogue](prod[r * n + c], c)));
      t.check(`${label}: correct`, e < 1e-3, `max error ${e}`);
    }
    const n2 = 128, d2 = mk(n2);
    const cands = [{ BM: 32, BN: 32, BK: 16, TM: 2, TN: 2, epilogue: "none" }, { BM: 32, BN: 32, BK: 16, TM: 4, TN: 4, epilogue: "none" }, { BM: 64, BN: 64, BK: 16, TM: 4, TN: 4, epilogue: "none" }, { BM: 64, BN: 32, BK: 8, TM: 4, TN: 4, epilogue: "none" }];
    const res = at(n2, cands.map((c) => ({ ...c })), d2.A, d2.B, t.gpu.alloc(n2 * n2), d2.bias) || {};
    const rs = Array.isArray(res.results) ? res.results : [];
    t.check("autotune measured every candidate", rs.length === 4 && rs.every((r) => r && typeof r.cycles === "number" && r.cfg), `got ${rs.length} results`);
    if (rs.length === 4 && res.best) {
      const min = Math.min(...rs.map((r) => r.cycles)), bestR = rs.find((r) => JSON.stringify(r.cfg) === JSON.stringify(res.best));
      t.check("best is the fastest measured", bestR && bestR.cycles === min, `best ${JSON.stringify(res.best)}`);
      const s = t.gpu.launch(t.gpu.compile(cm(res.best)).matmul, lc(res.best, n2), d2.A, d2.B, t.gpu.alloc(n2 * n2), d2.bias, n2);
      t.check("re-running the best reproduces its cycles", Math.abs(s.cycles - min) <= 0.01 * min, `re-run ${s.cycles} vs reported ${min}`);
    }
  },
});
