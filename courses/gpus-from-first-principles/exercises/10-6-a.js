GW.exercise({
  id: "10-6-a",
  title: "Frontier-based BFS",
  file: "bfs.js",
  prompt: `
<p>Compute breadth-first-search levels from a source vertex on a graph in CSR form (<code>rowPtr</code>, <code>colIdx</code>, both <code>i32</code>): <code>level[v]</code> is the number of edges on a shortest path from <code>src</code>, or −1 if unreachable.</p>
<ol>
<li><code>bfsLevel(rowPtr, colIdx, level, frontier, size, next, nextSize, depth)</code>: one thread per vertex of the current frontier. For each neighbour u, claim it with <code>atomicCAS(level, u, -1, depth + 1)</code>; if the old value was −1, append u to the next frontier with <code>slot = atomicAdd(nextSize, 0, 1)</code>.</li>
<li><code>runBfs(rowPtr, colIdx, n, src, level)</code>: on the host, set every level to −1 and the source's to 0, then launch <code>bfsLevel</code> once per level (blocks of 128, enough for the frontier), read the new frontier size back from <code>nextSize.data[0]</code>, swap the queues, and stop when the frontier is empty. Return <code>{ levels, launches, threads }</code>, where <code>threads</code> is the total threads launched.</li>
</ol>
<p>The checks require correct levels, and that you launch work only for the frontier: no more than n + 128 × levels threads in total (a kernel that scans all n vertices every level launches about 10× more).</p>`,
  starter: `
function bfsLevel(rowPtr, colIdx, level, frontier, size, next, nextSize, depth) {
  // TODO
}

function runBfs(rowPtr, colIdx, n, src, level) {
  // TODO: host loop over levels with two i32 queues and a 1-element counter
}

function main() {
  // a path 0 - 1 - 2 - 3 plus an edge 0 - 3
  const rp = gpu.from([0, 2, 4, 6, 8], "i32"), ci = gpu.from([1, 3, 0, 2, 1, 3, 2, 0], "i32");
  const level = gpu.alloc(4, "i32");
  print(JSON.stringify(runBfs(rp, ci, 4, 0, level)), level.toArray());
}
`,
  tests(t) {
    const run = t.fn("runBfs");
    const build = (n, edges) => { const adj = Array.from({ length: n }, () => []); for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); } const rp = [0], ci = []; for (const a of adj) { ci.push(...a); rp.push(ci.length); } return { adj, rp, ci }; };
    const W = 40, grid = []; for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const v = y * W + x; if (x + 1 < W) grid.push([v, v + 1]); if (y + 1 < W) grid.push([v, v + W]); }
    for (let i = 0; i < 40; i++) grid.push([(i * 97) % (W * W), (i * 389 + 7) % (W * W)]);
    const cases = [["40 × 40 grid with shortcuts", W * W, grid, 0], ["two components", 10, [[0, 1], [1, 2], [2, 0], [5, 6], [6, 7]], 1]];
    for (const [name, n, edges, src] of cases) {
      const { adj, rp, ci } = build(n, edges);
      const level = t.gpu.alloc(n, "i32");
      const r = run(t.gpu.from(rp, "i32"), t.gpu.from(ci.length ? ci : [0], "i32"), n, src, level);
      const want = new Array(n).fill(-1); want[src] = 0; const q = [src];
      for (let h = 0; h < q.length; h++) for (const u of adj[q[h]]) if (want[u] < 0) { want[u] = want[q[h]] + 1; q.push(u); }
      const bad = want.findIndex((v, i) => level.data[i] !== v);
      t.check(`${name}: correct levels`, bad < 0 && !!r, !r ? "return { levels, launches, threads }" : `vertex ${bad}: ${level.data[bad]}, want ${want[bad]}`);
      if (r && n === W * W) t.check("work proportional to the frontiers", r.threads <= n + 128 * r.levels, `${r.threads} threads launched over ${r.levels} levels`);
    }
  },
});
