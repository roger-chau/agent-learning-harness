GW.exercise({
  id: "1-1-a",
  title: "From vectors to threads",
  file: "simd_to_simt.js",
  prompt: `
<p>Count the work both ways, then write the SIMT version.</p>
<ol>
<li><code>simdInstructions(n, width)</code>: how many vector instructions a strip-mined loop issues to process <code>n</code> elements with vectors of <code>width</code> lanes, if the tail uses one masked instruction.</li>
<li><code>tailLanes(n, width)</code>: how many lanes are active in the <em>last</em> instruction (for SIMD) or the last warp (for SIMT with <code>width = 32</code>). If <code>n</code> divides evenly, the last one is full.</li>
<li>Kernel <code>poly(x, out, n)</code> computes <code>out[i] = 3·x[i]² + 2·x[i] + 1</code>, one element per thread.</li>
<li><code>launchPoly(x, out, n)</code> launches it with blocks of 128 threads and returns the stats.</li>
</ol>`,
  starter: `
function simdInstructions(n, width) {
  // TODO
}

function tailLanes(n, width) {
  // TODO
}

function poly(x, out, n) {
  // TODO
}

function launchPoly(x, out, n) {
  // TODO: blocks of 128 threads; return gpu.launch(...)
}

function main() {
  print(simdInstructions(1000, 16), tailLanes(1000, 16)); // 63 8
  const n = 10;
  const x = gpu.from(Array.from({ length: n }, (_, i) => i));
  const out = gpu.alloc(n);
  table(launchPoly(x, out, n));
  print(out.toArray()); // [1, 6, 17, ...]
}
`,
  tests(t) {
    const si = t.fn("simdInstructions"), tl = t.fn("tailLanes"), lp = t.fn("launchPoly");
    for (const [n, w, ins, tail] of [[1000, 16, 63, 8], [1024, 16, 64, 16], [1, 32, 1, 1], [1000, 32, 32, 8], [33, 8, 5, 1], [64, 32, 2, 32]]) {
      t.check(`simdInstructions(${n}, ${w}) = ${ins}`, si(n, w) === ins, `got ${si(n, w)}`);
      t.check(`tailLanes(${n}, ${w}) = ${tail}`, tl(n, w) === tail, `got ${tl(n, w)}`);
    }
    for (const n of [1, 100, 128, 1000]) {
      const xs = Array.from({ length: n }, (_, i) => (i % 17) - 8.5);
      const x = t.gpu.from(xs), out = t.gpu.alloc(n);
      const s = lp(x, out, n);
      const ok = xs.every((v, i) => Math.abs(out.data[i] - Math.fround(3 * v * v + 2 * v + 1)) < 1e-3);
      t.check(`n = ${n}: poly correct`, ok, "compare out[i] with 3x² + 2x + 1");
      t.check(`n = ${n}: blocks of 128, just enough of them`, s && s.blocks === Math.ceil(n / 128) && s.threads === s.blocks * 128,
        s ? `launched ${s.blocks} blocks, ${s.threads} threads` : "return the stats from gpu.launch");
    }
  },
});
