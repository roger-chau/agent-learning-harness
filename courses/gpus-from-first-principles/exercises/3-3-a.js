GW.exercise({
  id: "3-3-a",
  title: "A privatised histogram",
  file: "histogram.js",
  prompt: `
<p>Write <code>histogram(x, bins, n)</code>: a 256-bin histogram of the <code>u8</code> values in <code>x</code>, accumulated into the <code>u32</code> buffer <code>bins</code> (which starts at zero). Use a <strong>shared-memory private histogram per block</strong>, and merge into <code>bins</code> with at most one global atomic per bin per block.</p>
<p><code>runHistogram(x, bins, n)</code> launches it with <strong>64 blocks of 256 threads</strong> and returns the stats.</p>`,
  starter: `
function histogram(x, bins, n) {
  // TODO
}

function runHistogram(x, bins, n) {
  // TODO
}

function main() {
  const n = 20000;
  const x = gpu.from(Array.from({ length: n }, (_, i) => (i * 37) % 256), "u8");
  const bins = gpu.alloc(256, "u32");
  table(runHistogram(x, bins, n));
  print(bins.toArray().slice(0, 8));
}
`,
  tests(t) {
    const run = t.fn("runHistogram");
    for (const n of [65536, 1000, 1]) {
      const xs = Array.from({ length: n }, (_, i) => (i * 37 + (i >> 3)) % 256);
      const x = t.gpu.from(xs, "u8"), bins = t.gpu.alloc(256, "u32");
      const s = run(x, bins, n);
      const want = new Array(256).fill(0); for (const v of xs) want[v]++;
      const bad = want.findIndex((c, b) => bins.data[b] !== c);
      t.check(`n = ${n}: histogram correct`, bad < 0 && !!s, !s ? "return the stats" : `bin ${bad}: ${bins.data[bad]} vs ${want[bad]}`);
      if (s && n === 65536) {
        t.check("64 blocks of 256", s.blocks === 64 && s.threads === 64 * 256, `${s.blocks} blocks`);
        t.check("global atomics ≤ one per bin per block (merged from shared memory)", s.globalAtomics <= 64 * 8 && s.atomics > s.globalAtomics, `${s.globalAtomics} global atomic warp-instructions, ${s.atomics} in total`);
      }
    }
  },
});
