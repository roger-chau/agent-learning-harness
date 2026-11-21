GW.exercise({
  id: "1-4-a",
  title: "Make the work warp-uniform",
  file: "uniform.js",
  prompt: `
<p>Every element needs <code>work(x[i], trips)</code>, where <code>trips</code> is <strong>8 for even <code>i</code> and 3 for odd <code>i</code></strong>. The naive kernel gives thread <code>i</code> element <code>i</code>, so in every warp half the lanes loop 8 times and half loop 3 times: the loop diverges in every warp.</p>
<p>Write <code>evenOdd(x, out, n)</code> and <code>runEvenOdd(x, out, n)</code> so that each warp handles <strong>only even or only odd elements</strong>. You choose the mapping from threads to elements and the launch size, but don't change <code>work</code>. Return the stats.</p>
<p>The checks require correct results and at most <strong>3 divergent branches in total</strong>. A few warps at the edges of your even and odd ranges may split on a guard; the naive version has one per warp.</p>`,
  starter: `
// Don't change this function: its loop is what diverges when trips differ.
function work(v, trips) {
  let r = v;
  for (let k = 0; k < trips; k++) r = r * 0.5 + k;
  return r;
}

// The naive version, for comparison: every warp diverges.
function naive(x, out, n) {
  const i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i < n) out[i] = work(x[i], i % 2 === 0 ? 8 : 3);
}

function evenOdd(x, out, n) {
  // TODO: map threads to elements so each warp is all-even or all-odd
}

function runEvenOdd(x, out, n) {
  // TODO: launch evenOdd and return the stats
}

function main() {
  const n = 1000;
  const x = gpu.from(Array.from({ length: n }, (_, i) => i % 7));
  const out = gpu.alloc(n);
  print("naive:");
  table(gpu.launch(naive, { grid: Math.ceil(n / 128), block: 128 }, x, out, n));
  print("yours:");
  table(runEvenOdd(x, out, n));
}
`,
  tests(t) {
    const run = t.fn("runEvenOdd");
    const ref = (v, trips) => { let r = v; for (let k = 0; k < trips; k++) r = r * 0.5 + k; return r; };
    for (const n of [64, 1000, 1001, 4096, 7]) {
      const xs = Array.from({ length: n }, (_, i) => (i * 13) % 11);
      const x = t.gpu.from(xs), out = t.gpu.alloc(n);
      out.data.fill(NaN);
      const s = run(x, out, n);
      let bad = -1;
      for (let i = 0; i < n; i++) {
        const want = Math.fround(ref(Math.fround(xs[i]), i % 2 === 0 ? 8 : 3));
        if (!(Math.abs(out.data[i] - want) <= 1e-4 * Math.max(1, Math.abs(want)))) { bad = i; break; }
      }
      t.check(`n = ${n}: every element correct`, bad < 0, bad >= 0 ? `out[${bad}] = ${out.data[bad]}` : "");
      t.check(`n = ${n}: at most 3 divergent branches`, s && s.divergentBranches <= 3,
        s ? `${s.divergentBranches} divergent branches (out of ${s.branches})` : "return the stats");
    }
  },
});
