GW.exercise({
  id: "3-1-a",
  title: "Block sums: shared-memory tree, then a warp shuffle",
  file: "block_sum.js",
  prompt: `
<p>Write <code>blockSums(x, out, n)</code> for blocks of <strong>256</strong> threads. Block <code>b</code> sums elements <code>256b … 256b+255</code> (treating elements past <code>n</code> as 0) and writes the total to <code>out[b]</code>.</p>
<ul>
<li>Use <code>shared(...)</code> and a <strong>sequential-addressing</strong> tree for the strides 128, 64, 32 (with <code>__syncthreads()</code> between rounds).</li>
<li>Finish the last 32 values inside warp 0 with <code>__shfl_down_sync</code>.</li>
</ul>
<p>Then <code>runBlockSums(x, out, n)</code> launches it and returns the stats. The checks need correct sums, <strong>zero bank conflicts</strong>, and shuffles being used.</p>`,
  starter: `
function blockSums(x, out, n) {
  // TODO
}

function runBlockSums(x, out, n) {
  // TODO
}

function main() {
  const n = 1000;
  const x = gpu.from(Array.from({ length: n }, (_, i) => i % 10));
  const out = gpu.alloc(Math.ceil(n / 256));
  table(runBlockSums(x, out, n));
  print(out.toArray());
}
`,
  tests(t) {
    const run = t.fn("runBlockSums");
    for (const n of [256, 1000, 4096, 1]) {
      const xs = Array.from({ length: n }, (_, i) => ((i * 7) % 13) - 6);
      const x = t.gpu.from(xs), out = t.gpu.alloc(Math.ceil(n / 256));
      const s = run(x, out, n);
      let bad = -1;
      for (let b = 0; b < Math.ceil(n / 256); b++) {
        let want = 0; for (let i = 256 * b; i < Math.min(n, 256 * b + 256); i++) want += xs[i];
        if (Math.abs(out.data[b] - want) > 1e-3) { bad = b; break; }
      }
      t.check(`n = ${n}: block sums correct`, bad < 0 && !!s, !s ? "return the stats" : `out[${bad}] = ${out.data[bad]}`);
      if (s && n === 4096) {
        t.check("blocks of 256", s.blocks === 16 && s.threads === 4096, `${s.blocks} blocks, ${s.threads} threads`);
        t.check("zero bank conflicts", s.bankConflicts === 0 && s.sharedLoads > 0, `${s.bankConflicts} conflicts, ${s.sharedLoads} shared loads`);
        t.check("finishes with warp shuffles", s.warpOps >= 5 * 16, `${s.warpOps} warp operations`);
      }
    }
  },
});
