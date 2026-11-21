GW.exercise({
  id: "1-5-a",
  title: "Branch-free kernels",
  file: "branch_free.js",
  prompt: `
<p>Write two kernels with <strong>no divergent branches except the bounds guard</strong>. Use <code>Math.min</code>, <code>Math.max</code> or ternaries instead of <code>if</code> for the decisions.</p>
<ol>
<li><code>relu6(x, out, n)</code>: <code>out[i] = min(max(x[i], 0), 6)</code>.</li>
<li><code>smooth(x, out, n)</code>: <code>out[i] = (x[i−1] + 2·x[i] + x[i+1]) / 4</code>, where indices outside <code>[0, n−1]</code> are clamped to the nearest end.</li>
</ol>
<p>Also write <code>runRelu6(x, out, n)</code> and <code>runSmooth(x, out, n)</code>. Use blocks of 64 threads and return the stats. The inputs are chosen so a branchy version would diverge in every warp; yours may have at most 1 divergent branch, from the warp straddling <code>n</code>.</p>`,
  starter: `
function relu6(x, out, n) {
  // TODO
}

function smooth(x, out, n) {
  // TODO
}

function runRelu6(x, out, n) {
  // TODO
}

function runSmooth(x, out, n) {
  // TODO
}

function main() {
  const n = 10;
  const x = gpu.from([-3, 2, 9, 0, 7, -1, 4, 6, 12, 1]);
  const a = gpu.alloc(n), b = gpu.alloc(n);
  table(runRelu6(x, a, n)); print(a.toArray());
  table(runSmooth(x, b, n)); print(b.toArray());
}
`,
  tests(t) {
    const rr = t.fn("runRelu6"), rs = t.fn("runSmooth");
    for (const n of [1, 2, 100, 1000, 1024]) {
      const xs = Array.from({ length: n }, (_, i) => ((i * 37) % 23) - 8);
      const x = t.gpu.from(xs), a = t.gpu.alloc(n), b = t.gpu.alloc(n);
      const s1 = rr(x, a, n), s2 = rs(x, b, n);
      const f = xs.map(Math.fround);
      const okA = f.every((v, i) => Math.abs(a.data[i] - Math.min(Math.max(v, 0), 6)) < 1e-5);
      const c = (i) => f[Math.min(Math.max(i, 0), n - 1)];
      const okB = f.every((v, i) => Math.abs(b.data[i] - (c(i - 1) + 2 * v + c(i + 1)) / 4) < 1e-4);
      t.check(`n = ${n}: relu6 correct`, okA, "check the clamp to [0, 6]");
      t.check(`n = ${n}: smooth correct (with clamped ends)`, okB, "check the ends");
      for (const [name, s] of [["relu6", s1], ["smooth", s2]]) {
        const ok = s && s.divergentBranches <= 1 && s.blocks === Math.ceil(n / 64) && s.threads === s.blocks * 64;
        t.check(`n = ${n}: ${name} is branch-free, with blocks of 64`, ok,
          s ? `${s.divergentBranches} divergent branches, ${s.blocks} blocks of ${s.threads / s.blocks}` : "return the stats");
      }
    }
  },
});
