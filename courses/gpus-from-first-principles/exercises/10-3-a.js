GW.exercise({
  id: "10-3-a",
  title: "Parallel merge with co-rank",
  file: "merge.js",
  prompt: `
<p>Merge two sorted <code>f32</code> arrays A (length m) and B (length n) into C, in parallel and <strong>stably</strong> (on equal values, A's elements come first).</p>
<ol>
<li><code>coRank(k, A, m, B, n)</code>: how many of the first k outputs come from A. A binary search over i, with j = k − i: if <code>j &gt; 0 &amp;&amp; i &lt; m &amp;&amp; B[j−1] &gt;= A[i]</code>, too few were taken from A.</li>
<li><code>mergeKernel(A, m, B, n, C)</code>: each thread produces one contiguous slice of C (⌈(m + n)/threads⌉ outputs), finds where its slice starts and ends in A and B with <code>coRank</code>, and merges sequentially.</li>
<li><code>runMerge(A, m, B, n, C)</code>: 8 blocks of 64 threads; return the stats.</li>
</ol>`,
  starter: `
function coRank(k, A, m, B, n) {
  // TODO: binary search for i in [max(0, k - n), min(k, m)]
}

function mergeKernel(A, m, B, n, C) {
  // TODO
}

function runMerge(A, m, B, n, C) {
  // TODO
}

function main() {
  const A = gpu.from([1, 3, 5, 7, 9], "f32"), B = gpu.from([2, 3, 4, 10], "f32"), C = gpu.alloc(9, "f32");
  table(runMerge(A, 5, B, 4, C));
  print(C.toArray());
}
`,
  tests(t) {
    const co = t.fn("coRank"), run = t.fn("runMerge");
    const ref = (k, a, b) => { let i = 0, j = 0; while (i + j < k) { if (j >= b.length || (i < a.length && a[i] <= b[j])) i++; else j++; } return i; };
    const cases = [[[1, 2, 2], [2, 2, 3]], [[], [1, 2]], [[5, 6], []], [[1, 1, 1, 1], [1, 1]], [[0, 4, 8], [1, 2, 3, 9, 10]]];
    let bad = null;
    for (const [a, b] of cases) for (let k = 0; k <= a.length + b.length; k++) {
      const got = co(k, t.gpu.from(a.length ? a : [0], "f32").data, a.length, t.gpu.from(b.length ? b : [0], "f32").data, b.length);
      if (got !== ref(k, a, b)) { bad = `A=[${a}] B=[${b}] k=${k}: got ${got}, want ${ref(k, a, b)}`; break; }
    }
    t.check("coRank is correct and stable (ties: A first)", !bad, bad);
    for (const [m, n] of [[3000, 2000], [1, 700], [513, 0]]) {
      const a = Array.from({ length: m }, (_, i) => Math.floor(i / 3));
      const b = Array.from({ length: n }, (_, i) => Math.floor(i / 2) + 0.5 * ((i >> 1) % 3 === 0));
      const A = t.gpu.from(a.length ? a : [0], "f32"), B = t.gpu.from(b.length ? b : [0], "f32"), C = t.gpu.alloc(m + n, "f32");
      const s = run(A, m, B, n, C);
      const want = [...a, ...b].sort((x, y) => x - y);
      const k = want.findIndex((v, i) => C.data[i] !== v);
      t.check(`merge of ${m} + ${n}`, k < 0 && !!s, !s ? "return the stats" : `C[${k}] = ${C.data[k]}, want ${want[k]}`);
      if (s && m === 3000) t.check("runs in parallel: 512 threads, well under 20 µs", s.threads === 512 && s.timeUs < 20, `${s.threads} threads, ${s.timeUs} µs`);
    }
  },
});
