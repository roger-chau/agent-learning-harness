GW.exercise({
  id: "10-5-a",
  title: "CSR SpMV, a warp per row",
  file: "spmv.js",
  prompt: `
<p>Compute <code>y = A·x</code> for a sparse matrix A in <strong>CSR</strong> form: <code>rowPtr</code> (<code>i32</code>, nRows + 1 entries), <code>colIdx</code> (<code>i32</code>) and <code>vals</code> (<code>f32</code>), with dense <code>f32</code> vectors x and y.</p>
<p>Write the <strong>vector kernel</strong> <code>spmvVector(rowPtr, colIdx, vals, x, y, nRows)</code>: one warp per row; lane ℓ handles the row's entries ℓ, ℓ + 32, …, accumulating with <code>fma</code>; then a shuffle reduction (<code>__shfl_down_sync</code>) and lane 0 writes <code>y[row]</code>. Consecutive lanes now read consecutive entries of <code>colIdx</code> and <code>vals</code>.</p>
<p><code>runSpmv(...)</code> launches it with 128-thread blocks (4 rows per block) and returns the stats. The scalar kernel (one thread per row) moves about 3.2 sectors per non-zero on the test matrix; yours must move at most 2.</p>`,
  starter: `
function spmvVector(rowPtr, colIdx, vals, x, y, nRows) {
  // TODO: warp = global thread / 32, lane = threadIdx.x & 31
}

function runSpmv(rowPtr, colIdx, vals, x, y, nRows) {
  // TODO
}

function main() {
  // 3 x 3: [[1, 0, 2], [0, 0, 3], [4, 5, 0]]
  const rp = gpu.from([0, 2, 3, 5], "i32"), ci = gpu.from([0, 2, 2, 0, 1], "i32"), v = gpu.from([1, 2, 3, 4, 5], "f32");
  const x = gpu.from([1, 1, 1], "f32"), y = gpu.alloc(3, "f32");
  table(runSpmv(rp, ci, v, x, y, 3));
  print(y.toArray(), "should be", [3, 3, 9]);
}
`,
  tests(t) {
    const run = t.fn("runSpmv");
    for (const [n, base, spread] of [[512, 48, 33], [301, 0, 9]]) {
      const rp = [0], ci = [], vv = [];
      for (let r = 0; r < n; r++) { const len = base + (r * 7) % spread; for (let k = 0; k < len; k++) { ci.push((r * 13 + k * 31) % n); vv.push(((r + k) % 5) - 2); } rp.push(ci.length); }
      const xs = Array.from({ length: n }, (_, i) => (i % 7) - 3);
      const y = t.gpu.alloc(n, "f32");
      const s = run(t.gpu.from(rp, "i32"), t.gpu.from(ci.length ? ci : [0], "i32"), t.gpu.from(vv.length ? vv : [0], "f32"), t.gpu.from(xs, "f32"), y, n);
      let bad = -1;
      for (let r = 0; r < n; r++) { let a = 0; for (let k = rp[r]; k < rp[r + 1]; k++) a += vv[k] * xs[ci[k]]; if (y.data[r] !== a) { bad = r; break; } }
      t.check(`${n} rows (${ci.length} non-zeros, rows of ${base}–${base + spread - 1}): correct`, bad < 0 && !!s, !s ? "return the stats" : `row ${bad}: ${y.data[bad]}`);
      if (s && n === 512) t.check("at most 2 sectors per non-zero (scalar kernel: 3.2)", s.transactions / ci.length <= 2, `${(s.transactions / ci.length).toFixed(2)} sectors per non-zero`);
    }
  },
});
