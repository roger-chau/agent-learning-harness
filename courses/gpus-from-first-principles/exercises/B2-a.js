GW.exercise({
  id: "B2-a",
  title: "Single-pass scan with decoupled look-back",
  file: "scan.js",
  prompt: `<p>Implement <code>scanInclusive(x, y, n, opts)</code>: one launch, which spreads <code>opts</code> into its launch config and returns the stats.</p>`,
  starter: `
function scanTiles(x, y, n, counter, status, aggregate, prefix) {
  // TODO: dynamic tile id, block scan, publish aggregate, look back, publish prefix, write output
}

function scanInclusive(x, y, n, opts = {}) {
  const tiles = Math.ceil(n / 256);
  const counter = gpu.alloc(1, "i32");
  const status = gpu.alloc(tiles, "i32");     // 0 = X (nothing yet), 1 = A, 2 = P
  const aggregate = gpu.alloc(tiles), prefix = gpu.alloc(tiles);
  // TODO: one launch, with ...opts in the config
}

function main() {
  const n = 5000;
  const x = gpu.from(Array.from({ length: n }, () => 1));
  const y = gpu.alloc(n);
  table(scanInclusive(x, y, n, { blockOrder: "shuffle", seed: 1 }));
  print(y.data[0], y.data[n - 1]); // 1 5000
}
`,
  tests(t) {
    const scan = t.fn("scanInclusive");
    for (const [n, seed] of [[256, 1], [5000, 2], [65536, 3], [65536, 4], [77, 5]]) {
      const xs = Array.from({ length: n }, (_, i) => ((i * 7) % 5) - 1);
      const x = t.gpu.from(xs), y = t.gpu.alloc(n);
      const s = scan(x, y, n, { blockOrder: "shuffle", seed });
      let acc = 0, bad = -1;
      for (let i = 0; i < n; i++) { acc += xs[i]; if (Math.abs(y.data[i] - acc) > 1e-3) { bad = i; break; } }
      t.check(`n = ${n}, block order seed ${seed}: correct`, bad < 0 && !!s && typeof s.cycles === "number", !s || typeof s.cycles !== "number" ? "return the stats of your single launch" : `y[${bad}] = ${y.data[bad]}`);
      if (s && n === 65536 && seed === 3) {
        t.check("single pass: DRAM traffic ≤ 1.25 × (input + output)", s.dramBytes <= 1.25 * 8 * n, `${s.dramBytes} bytes for ${8 * n} bytes of input + output`);
      }
    }
  },
});
