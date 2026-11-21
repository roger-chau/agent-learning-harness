GW.exercise({
  id: "3-2-a",
  title: "A block-wide inclusive scan from warp scans",
  file: "block_scan.js",
  prompt: `
<p>Write <code>blockScan(x, y, totals, n)</code> for blocks of <strong>256</strong> threads. Each block computes the <strong>inclusive</strong> scan of its 256 elements (elements past <code>n</code> count as 0), writes it to <code>y</code> (only for indices below <code>n</code>), and writes its tile's total to <code>totals[blockIdx.x]</code>.</p>
<ol>
<li>Each warp scans its 32 values with <code>__shfl_up_sync</code>.</li>
<li>Each warp's last lane writes the warp total to shared memory; <code>__syncthreads()</code>.</li>
<li>Warp 0 scans the 8 warp totals; <code>__syncthreads()</code>.</li>
<li>Every thread adds the total of all earlier warps.</li>
</ol>
<p><code>runBlockScan(x, y, totals, n)</code> launches it and returns the stats.</p>`,
  starter: `
function blockScan(x, y, totals, n) {
  // TODO
}

function runBlockScan(x, y, totals, n) {
  // TODO
}

function main() {
  const n = 600;
  const x = gpu.from(Array.from({ length: n }, () => 1));
  const y = gpu.alloc(n), totals = gpu.alloc(Math.ceil(n / 256));
  table(runBlockScan(x, y, totals, n));
  print(y.toArray().slice(250, 262), totals.toArray()); // 251.. then restarts at 1
}
`,
  tests(t) {
    const run = t.fn("runBlockScan");
    for (const n of [256, 600, 2048, 33]) {
      const xs = Array.from({ length: n }, (_, i) => ((i * 5) % 7) - 2);
      const x = t.gpu.from(xs), y = t.gpu.alloc(n), totals = t.gpu.alloc(Math.ceil(n / 256));
      const s = run(x, y, totals, n);
      let bad = null;
      for (let b = 0; b < Math.ceil(n / 256) && !bad; b++) {
        let acc = 0;
        for (let i = 256 * b; i < Math.min(n, 256 * b + 256); i++) { acc += xs[i]; if (Math.abs(y.data[i] - acc) > 1e-3) { bad = `y[${i}] = ${y.data[i]}, expected ${acc}`; break; } }
        if (!bad && Math.abs(totals.data[b] - acc) > 1e-3) bad = `totals[${b}] = ${totals.data[b]}, expected ${acc}`;
      }
      t.check(`n = ${n}: tile scans and totals correct`, !bad && !!s, !s ? "return the stats" : bad || "");
      if (s && n === 2048) t.check("uses warp shuffles and no bank conflicts", s.warpOps >= 8 * 5 * 8 && s.bankConflicts === 0, `${s.warpOps} warp ops, ${s.bankConflicts} conflicts`);
    }
  },
});
