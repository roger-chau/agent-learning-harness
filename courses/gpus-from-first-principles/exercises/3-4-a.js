GW.exercise({
  id: "3-4-a",
  title: "Single-pass reduction: the last block finishes the job",
  file: "last_block.js",
  prompt: `
<p>Write a <strong>single kernel</strong> <code>sumLastBlock(x, n, partials, counter, result)</code> that sums <code>n</code> floats into <code>result[0]</code> using the last-block pattern: each block reduces its share (a grid-stride loop is fine), thread 0 writes the block's partial, fences, takes a ticket from <code>counter</code>, and the block that gets the last ticket sums all the partials.</p>
<p>The block that's last must also <em>know</em> it's last, and every one of its threads must reach any <code>__syncthreads()</code>. Share the ticket through shared memory.</p>
<p><code>sumOneLaunch(x, n, opts)</code> allocates what it needs, makes <strong>one</strong> launch with blocks of 256 (spreading <code>opts</code> into the config), and returns <code>{ sum, stats }</code>.</p>`,
  starter: `
function sumLastBlock(x, n, partials, counter, result) {
  // TODO
}

function sumOneLaunch(x, n, opts = {}) {
  // TODO: one launch, { grid, block: 256, ...opts }; return { sum, stats }
}

function main() {
  const n = 100000;
  const x = gpu.from(Array.from({ length: n }, () => 1));
  const r = sumOneLaunch(x, n, { blockOrder: "shuffle", seed: 7 });
  print(r.sum); // 100000
  table(r.stats);
}
`,
  tests(t) {
    const run = t.fn("sumOneLaunch");
    for (const [n, seed] of [[100000, 1], [100000, 2], [513, 3], [1, 4]]) {
      const xs = Array.from({ length: n }, (_, i) => ((i * 13) % 9) - 3.5);
      const x = t.gpu.from(xs);
      let want = 0; for (const v of x.data) want += v;
      const r = run(x, n, { blockOrder: "shuffle", seed });
      const ok = r && typeof r.sum === "number" && r.stats && typeof r.stats.cycles === "number";
      t.check(`n = ${n}, order ${seed}: returns { sum, stats } from one launch`, ok, "return { sum, stats } where stats is the single launch's result");
      if (!ok) continue;
      t.check(`n = ${n}, order ${seed}: sum correct`, Math.abs(r.sum - want) <= 1e-3 * Math.max(1, Math.abs(want)), `got ${r.sum}, expected ${want}`);
      if (n === 100000 && seed === 1) t.check("uses an atomic ticket", r.stats.globalAtomics >= r.stats.blocks, `${r.stats.globalAtomics} global atomics for ${r.stats.blocks} blocks`);
    }
  },
});
