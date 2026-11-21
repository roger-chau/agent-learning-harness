GW.exercise({
  id: "1-2-b",
  title: "A grid-stride loop with a fixed grid",
  file: "grid_stride.js",
  prompt: `
<p>Write <code>sumOfSquaresParts(x, partial, n)</code>, a kernel using a <strong>grid-stride loop</strong>. Each thread accumulates <code>x[i]²</code> over every element <code>i</code> it visits, then writes its own total to <code>partial[t]</code>, where <code>t</code> is its global thread index. Summing <code>partial</code> afterwards gives the sum of squares.</p>
<p>Then write <code>runParts(x, partial, n)</code>. It must always launch <strong>exactly 4 blocks of 128 threads</strong>, whatever <code>n</code> is, and return the stats. <code>partial</code> has exactly 512 entries.</p>`,
  starter: `
function sumOfSquaresParts(x, partial, n) {
  // TODO: grid-stride loop, then one write per thread
}

function runParts(x, partial, n) {
  // TODO: exactly 4 blocks of 128
}

function main() {
  const n = 3000;
  const x = gpu.from(Array.from({ length: n }, (_, i) => (i % 10) / 10));
  const partial = gpu.alloc(512);
  table(runParts(x, partial, n));
  print("sum of squares =", partial.toArray().reduce((a, b) => a + b, 0));
}
`,
  tests(t) {
    const run = t.fn("runParts");
    for (const n of [1, 500, 512, 3000, 20000]) {
      const xs = Array.from({ length: n }, (_, i) => ((i * 7) % 13) / 4 - 1);
      const x = t.gpu.from(xs), partial = t.gpu.alloc(512);
      const s = run(x, partial, n);
      const f = xs.map((v) => Math.fround(v));
      let ok = true, where = "";
      for (let th = 0; th < 512 && ok; th++) {
        let acc = 0;
        for (let i = th; i < n; i += 512) acc += f[i] * f[i];
        if (Math.abs(partial.data[th] - acc) > 1e-3 * Math.max(1, acc)) { ok = false; where = `partial[${th}] = ${partial.data[th]}, expected ${acc}`; }
      }
      t.check(`n = ${n}: every thread's partial sum is right`, ok, where);
      t.check(`n = ${n}: exactly 4 blocks of 128`, s && s.blocks === 4 && s.threads === 512,
        s ? `launched ${s.blocks} blocks, ${s.threads} threads` : "return the stats");
    }
  },
});
