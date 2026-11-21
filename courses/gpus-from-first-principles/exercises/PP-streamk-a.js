GW.exercise({
  id: "PP-streamk-a",
  title: "Stream-K GEMM",
  file: "streamk.js",
  prompt: `<p>Implement <code>runDataParallel</code> and <code>runStreamK</code>, each returning an array of launch stats.</p>`,
  starter: `
// Your kernels here (data-parallel and Stream-K; write the tile loop out in each).

function runDataParallel(A, B, C, n) {
  // TODO
  return [];
}
function runStreamK(A, B, C, n) {
  // TODO
  return [];
}

function main() {
  const n = 192;
  const A = gpu.from(Array.from({ length: n * n }, (_, i) => (i % 7) / 4)), B = gpu.from(Array.from({ length: n * n }, (_, i) => (i % 5) - 2));
  for (const f of [runDataParallel, runStreamK]) {
    const st = f(A, B, gpu.alloc(n * n), n);
    print(f.name, st.reduce((a, s) => a + s.cycles, 0), "cycles;", st.map((s) => s.limitedBy + ", balance " + s.smBalance).join(" | "));
  }
}
`,
  tests(t) {
    const dp = t.fn("runDataParallel"), sk = t.fn("runStreamK");
    const total = (st) => (Array.isArray(st) && st.length && st.every((s) => s && typeof s.cycles === "number") ? st.reduce((a, s) => a + s.cycles, 0) : NaN);
    const setup = (n) => {
      const A = t.gpu.from(Array.from({ length: n * n }, (_, i) => ((i * 7) % 11) / 8)), B = t.gpu.from(Array.from({ length: n * n }, (_, i) => ((i * 5) % 13) / 8 - 0.5));
      const ref = new Float64Array(n * n);
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) { const a = A.data[r * n + k]; for (let c = 0; c < n; c++) ref[r * n + c] += a * B.data[k * n + c]; }
      return { A, B, ref };
    };
    const err = (C, ref) => { let e = 0; for (let i = 0; i < ref.length; i++) e = Math.max(e, Math.abs(C.data[i] - ref[i])); return e; };
    const s1 = setup(192);
    const C1 = t.gpu.from(new Array(192 * 192).fill(7)), d = dp(s1.A, s1.B, C1, 192);
    t.check("n = 192: data-parallel correct", err(C1, s1.ref) < 1e-3, `max error ${err(C1, s1.ref)}`);
    const C2 = t.gpu.from(new Array(192 * 192).fill(7)), s = sk(s1.A, s1.B, C2, 192);
    t.check("n = 192: Stream-K correct (C started as garbage)", err(C2, s1.ref) < 1e-3, `max error ${err(C2, s1.ref)}`);
    const td = total(d), ts = total(s);
    t.check("n = 192: Stream-K ≥ 1.4× faster than data-parallel", ts > 0 && td / ts >= 1.4, `data-parallel ${td} cycles, Stream-K ${ts} cycles (${(td / ts).toFixed(2)}×)`);
    const s3 = setup(320), C3 = t.gpu.from(new Array(320 * 320).fill(-3)), s320 = sk(s3.A, s3.B, C3, 320);
    t.check("n = 320: Stream-K correct", err(C3, s3.ref) < 1e-3, `max error ${err(C3, s3.ref)}`);
    const bal = Array.isArray(s320) && s320.length ? Math.max(...s320.map((x) => x.smBalance || 0)) : 0;
    t.check("n = 320: work evenly balanced (smBalance ≥ 0.95)", bal >= 0.95, `best smBalance ${bal}`);
  },
});
