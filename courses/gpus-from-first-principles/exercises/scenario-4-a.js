GW.exercise({
  id: "scenario-4-a",
  title: "Decode: batch 1 vs batch 8",
  file: "decode.js",
  prompt: `<p>Implement <code>decode(W, X, Y, batch)</code>, returning the stats of every launch.</p>`,
  starter: `
// Your kernels here.

function decode(W, X, Y, batch) {
  const stats = [];
  // TODO: launch your kernel(s), pushing each launch's stats
  return stats;
}

function main() {
  const d = 512;
  const W = gpu.from(Array.from({ length: d * d }, (_, i) => Math.sin(i) / 16));
  for (const batch of [1, 8]) {
    const X = gpu.from(Array.from({ length: batch * d }, (_, i) => Math.cos(i)));
    const st = decode(W, X, gpu.alloc(batch * d), batch);
    const cycles = st.reduce((a, s) => a + s.cycles, 0);
    print("batch", batch, ":", cycles, "cycles;", st.map((s) => s.limitedBy).join(", "));
  }
}
`,
  tests(t) {
    const dec = t.fn("decode"), d = 512;
    const W = t.gpu.from(Array.from({ length: d * d }, (_, i) => Math.sin(i * 1.1) / 16));
    for (const [batch, budget] of [[3, 0], [1, 4000], [8, 11000]]) {
      const X = t.gpu.from(Array.from({ length: batch * d }, (_, i) => Math.cos(i * 0.9)));
      const Y = t.gpu.alloc(batch * d);
      const st = dec(W, X, Y, batch);
      let err = 0, mag = 0;
      for (let b = 0; b < batch; b++) for (let r = 0; r < d; r++) {
        let ref = 0; for (let i = 0; i < d; i++) ref += W.data[r * d + i] * X.data[b * d + i];
        err = Math.max(err, Math.abs(ref - Y.data[b * d + r])); mag = Math.max(mag, Math.abs(ref));
      }
      t.check(`batch ${batch}: correct`, err <= 1e-4 * Math.max(1, mag), `max error ${err}`);
      if (!budget) continue;
      const ok = Array.isArray(st) && st.length > 0 && st.every((s) => s && typeof s.cycles === "number");
      const cycles = ok ? st.reduce((a, s) => a + s.cycles, 0) : Infinity;
      t.check(`batch ${batch}: ≤ ${budget.toLocaleString()} cycles`, cycles <= budget, ok ? `${cycles} cycles (${st.map((s) => s.limitedBy).join(", ")})` : "return an array of launch stats");
    }
  },
});
