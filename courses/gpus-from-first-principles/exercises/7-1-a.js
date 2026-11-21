GW.exercise({
  id: "7-1-a",
  title: "Online softmax and a fused kernel",
  file: "softmax.js",
  prompt: `
<ol>
<li><code>combine(a, b)</code>: merge two online-softmax states <code>{ m, s }</code> (see the chapter). The empty state is <code>{ m: -Infinity, s: 0 }</code>.</li>
<li><code>softmaxOnline(xs)</code>: softmax of an array with one pass to get <code>{ m, s }</code> (using <code>combine</code>) and one pass to write the output. It must work for large values (e.g. 1000).</li>
<li><code>runSoftmax(X, Y, rows)</code>: row-wise softmax of a rows × 1024 matrix on the GPU, in <strong>one kernel</strong> that reads X once and writes Y once (DRAM bytes ≤ 1.1 × the ideal), in ≤ 4,000 cycles for 128 rows. Return the launch stats.</li>
</ol>`,
  starter: `
function combine(a, b) {
  // TODO
}
function softmaxOnline(xs) {
  // TODO
}

const K = gpu.compile(\`
function softmaxRow(X, Y, cols) {
  // TODO: one block per row
}
\`);
function runSoftmax(X, Y, rows) {
  return gpu.launch(K.softmaxRow, { grid: rows, block: 256 }, X, Y, 1024);
}

function main() {
  print(softmaxOnline([1, 2, 3]), softmaxOnline([1000, 1001]));
  const rows = 128, X = gpu.from(Array.from({ length: rows * 1024 }, (_, i) => Math.sin(i * 0.01) * 4)), Y = gpu.alloc(rows * 1024);
  table(runSoftmax(X, Y, rows));
}
`,
  tests(t) {
    const cb = t.fn("combine"), so = t.fn("softmaxOnline"), rs = t.fn("runSoftmax");
    const ref = (xs) => { const m = Math.max(...xs), e = xs.map((x) => Math.exp(x - m)), s = e.reduce((a, b) => a + b, 0); return e.map((v) => v / s); };
    const c = cb({ m: 2, s: 1 }, { m: 5, s: 1 });
    t.check("combine({2,1}, {5,1}) = {5, 1 + e^-3}", c && c.m === 5 && t.approx(c.s, 1 + Math.exp(-3)), `got ${JSON.stringify(c)}`);
    const e = cb({ m: -Infinity, s: 0 }, { m: 3, s: 2 });
    t.check("combine with the empty state", e && e.m === 3 && t.approx(e.s, 2), `got ${JSON.stringify(e)}`);
    const ab = cb(cb({ m: 3, s: 1 }, { m: -1, s: 1 }), { m: 7, s: 1 }), ba = cb({ m: 3, s: 1 }, cb({ m: -1, s: 1 }, { m: 7, s: 1 }));
    t.check("combine is associative", ab && ba && ab.m === ba.m && t.approx(ab.s, ba.s), `${JSON.stringify(ab)} vs ${JSON.stringify(ba)}`);
    for (const v of [[3, -1, 7, 2, 7, 0.5], [1000, 1001, 999], [-50, -51]]) {
      const o = so(v) || [], r = ref(v);
      t.check(`softmaxOnline([${v}])`, o.length === r.length && o.every((x, i) => t.approx(x, r[i], 1e-9, 1e-12)), `got ${JSON.stringify(o)}`);
    }
    for (const rows of [64, 128]) {
      const X = t.gpu.from(Array.from({ length: rows * 1024 }, (_, i) => Math.cos(i * 0.017) * 6 + (i % 3))), Y = t.gpu.alloc(rows * 1024);
      const s = rs(X, Y, rows);
      let err = 0;
      for (let r = 0; r < rows; r++) {
        const want = ref(Array.from(X.data.subarray(r * 1024, r * 1024 + 1024)));
        for (let k = 0; k < 1024; k++) err = Math.max(err, Math.abs(Y.data[r * 1024 + k] - want[k]));
      }
      t.check(`rows = ${rows}: correct`, err < 1e-6, `max error ${err}`);
      if (rows === 128 && s) {
        const ideal = 2 * rows * 1024 * 4;
        t.check("one read, one write (DRAM ≤ 1.1 × ideal)", s.dramBytes <= 1.1 * ideal, `${s.dramBytes} bytes vs ideal ${ideal}`);
        t.check("≤ 4,000 cycles for 128 rows", s.cycles <= 4000, `${s.cycles} cycles, ${s.limitedBy}`);
      }
    }
  },
});
