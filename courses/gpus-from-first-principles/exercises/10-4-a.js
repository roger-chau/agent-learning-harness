GW.exercise({
  id: "10-4-a",
  title: "Bitonic sort in shared memory",
  file: "bitonic.js",
  prompt: `
<p>Sort each consecutive run of 512 <code>f32</code> keys in place, one block per run, with a <strong>bitonic sorting network in shared memory</strong>.</p>
<p><code>bitonicBlock(keys)</code> runs with 256 threads: each loads 2 keys into a 512-element shared array. Then, for <code>k = 2, 4, …, 512</code> and <code>j = k/2, k/4, …, 1</code>, thread t compares the pair <code>i = ⌊t/j⌋·2j + (t mod j)</code> and <code>i + j</code>, and swaps them so the pair is ascending when <code>(i &amp; k) == 0</code> and descending otherwise, with a barrier after each step. Finally each thread writes its 2 keys back.</p>
<p><code>runBitonic(keys, nBlocks)</code> launches <code>nBlocks</code> blocks of 256 threads and returns the stats.</p>`,
  starter: `
function bitonicBlock(keys) {
  // TODO: load 2 keys per thread to shared memory, run the network, write back
}

function runBitonic(keys, nBlocks) {
  // TODO
}

function main() {
  const keys = gpu.from(Array.from({ length: 512 }, (_, i) => (i * 37) % 101), "f32");
  table(runBitonic(keys, 1));
  print(keys.toArray().slice(0, 16));
}
`,
  tests(t) {
    const run = t.fn("runBitonic");
    for (const nb of [4, 1]) {
      const xs = Array.from({ length: 512 * nb }, (_, i) => ((i * 2654435761) >>> 0) % 1000 - 500);
      const K = t.gpu.from(xs, "f32");
      const s = run(K, nb);
      let bad = -1;
      for (let b = 0; b < nb && bad < 0; b++) {
        const w = xs.slice(b * 512, b * 512 + 512).sort((x, y) => x - y);
        for (let i = 0; i < 512; i++) if (K.data[b * 512 + i] !== w[i]) { bad = b * 512 + i; break; }
      }
      t.check(`${nb} block(s) of 512 keys sorted`, bad < 0 && !!s, !s ? "return the stats" : `position ${bad}`);
      if (s && nb === 4) {
        t.check("all 256 threads work (a sorting network, not one thread sorting)", s.threads === 1024 && s.sharedLoads > 0 && s.barriers > 0, `${s.threads} threads, ${s.barriers} barrier waits`);
        t.check("fast: under 10 µs (one thread per block would take about 180)", s.timeUs < 10, `${s.timeUs} µs`);
      }
    }
  },
});
