GW.exercise({
  id: "2-5-a",
  title: "Row sums through shared memory, conflict-free",
  file: "row_sums.js",
  prompt: `
<p><code>a</code> is a row-major matrix of <code>rows × 32</code> floats. <code>rowSumsSlow</code> gives each thread one row to sum directly from global memory, so consecutive lanes are 128 bytes apart. Run it and look at its coalescing.</p>
<ol>
<li><code>conflictDegree(words)</code>: given the 4-byte word index each lane accesses, return the number of shared-memory passes. That's the most <em>distinct</em> words in any one of the 32 banks; identical words are broadcast.</li>
<li>Kernel <code>rowSums(a, out, rows)</code> with blocks of 32 threads, where each block handles 32 rows. The threads first load the 32×32 tile <strong>coalesced</strong> into shared memory, then <code>__syncthreads()</code>, then each thread sums its row from shared memory with <strong>no bank conflicts</strong>.</li>
<li><code>runRowSums(a, out, rows)</code> launches it (<code>rows</code> is a multiple of 32) and returns the stats.</li>
</ol>`,
  starter: `
function rowSumsSlow(a, out, rows) {
  const r = blockIdx.x * blockDim.x + threadIdx.x;
  let s = 0;
  for (let c = 0; c < 32; c++) s += a[r * 32 + c];
  out[r] = s;
}

function conflictDegree(words) {
  // TODO
}

function rowSums(a, out, rows) {
  // TODO: shared tile (padded?), coalesced load loop, __syncthreads(), conflict-free sum
}

function runRowSums(a, out, rows) {
  // TODO
}

function main() {
  const rows = 256;
  const a = gpu.from(Array.from({ length: rows * 32 }, (_, i) => i % 9));
  const o1 = gpu.alloc(rows), o2 = gpu.alloc(rows);
  print("slow:"); table(gpu.launch(rowSumsSlow, { grid: rows / 32, block: 32 }, a, o1, rows));
  print("yours:"); table(runRowSums(a, o2, rows));
  print(conflictDegree(Array.from({ length: 32 }, (_, l) => 32 * l))); // 32
}
`,
  tests(t) {
    const cd = t.fn("conflictDegree"), run = t.fn("runRowSums");
    const lanes = (f) => Array.from({ length: 32 }, (_, l) => f(l));
    for (const [name, words, want] of [["row", lanes((l) => l), 1], ["column", lanes((l) => 32 * l), 32], ["padded column", lanes((l) => 33 * l), 1],
      ["broadcast", lanes(() => 7), 1], ["stride 2", lanes((l) => 2 * l), 2], ["stride 8", lanes((l) => 8 * l), 8], ["half broadcast", lanes((l) => (l < 16 ? 0 : 32)), 2]]) {
      t.check(`conflictDegree(${name}) = ${want}`, cd(words) === want, `got ${cd(words)}`);
    }
    for (const rows of [32, 256]) {
      const a = t.gpu.from(Array.from({ length: rows * 32 }, (_, i) => ((i * 7) % 11) - 3)), out = t.gpu.alloc(rows);
      const s = run(a, out, rows);
      let bad = -1;
      for (let r = 0; r < rows; r++) { let want = 0; for (let c = 0; c < 32; c++) want += a.data[r * 32 + c]; if (Math.abs(out.data[r] - want) > 1e-3) { bad = r; break; } }
      t.check(`${rows} rows: sums correct`, bad < 0, bad >= 0 ? `row ${bad}: got ${out.data[bad]}` : "");
      t.check(`${rows} rows: global loads coalesced (≥99%)`, s && s.coalescing >= 0.99, s ? `${(s.coalescing * 100).toFixed(1)}%` : "return the stats");
      t.check(`${rows} rows: uses shared memory with no bank conflicts`, s && s.sharedLoads > 0 && s.bankConflicts === 0, s ? `${s.sharedLoads} shared loads, ${s.bankConflicts} conflicts` : "");
    }
  },
});
