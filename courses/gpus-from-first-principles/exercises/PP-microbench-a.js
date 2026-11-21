GW.exercise({
  id: "PP-microbench-a",
  title: "Dissect a hidden GPU",
  file: "dissect.js",
  prompt: `<p>Implement <code>dissect(dev)</code>, returning <code>{ dramLatencyCycles, dramBytesPerCycle, l2Bytes, sectorBytes, sharedBanks }</code> measured through <code>dev.launch(...).cycles</code> only.</p>`,
  starter: `
const MB = gpu.compile(\`
// your microbenchmark kernels here
function chase(x, y, n) { let s = 0; for (let i = 0; i < n; i++) s += x[i * 64]; y[0] = s; }
\`);

function dissect(dev) {
  const out = {};
  // 1. DRAM latency: a difference measurement with one thread
  // 2. Peak bandwidth: lots of bytes in flight
  // 3. L2 capacity: when does re-reading stop being free?
  // 4. Sector size: sweep a stride
  // 5. Shared banks: sweep a stride in shared memory
  return out;
}

function main() {
  // On the documented GW-1 you can check yourself against gpu.spec.
  const w = { alloc: (n, t) => gpu.alloc(n, t), from: (a, t) => gpu.from(a, t), launch: (k, c, ...a) => ({ cycles: gpu.launch(k, c, ...a).cycles }) };
  print(JSON.stringify(dissect(w)));
  print(JSON.stringify(gpu.spec));
}
`,
  tests(t) {
    const dissect = t.fn("dissect");
    const hidden = [
      { dramLatencyCycles: 600, dramBandwidthGBs: 768, l2Bytes: 128 * 1024, sectorBytes: 64, sharedBanks: 16 },
      { dramLatencyCycles: 300, dramBandwidthGBs: 300, l2Bytes: 512 * 1024, sectorBytes: 16, sharedBanks: 64 },
    ];
    hidden.forEach((spec, k) => {
      const d = new t.GPUSim.Device(spec);
      const dev = { alloc: (n, ty) => d.alloc(n, ty), from: (a, ty) => d.from(a, ty), launch: (kern, c, ...a) => ({ cycles: d.launch(kern, c, ...a).cycles }) };
      const r = dissect(dev) || {};
      const bpc = d.spec.dramBandwidthGBs / d.spec.clockGHz, near = (a, b) => typeof a === "number" && Math.abs(a - b) <= 0.05 * b;
      t.check(`GPU ${k + 1}: DRAM latency`, near(r.dramLatencyCycles, spec.dramLatencyCycles), `got ${r.dramLatencyCycles}`);
      t.check(`GPU ${k + 1}: DRAM bytes per cycle`, near(r.dramBytesPerCycle, bpc), `got ${r.dramBytesPerCycle}`);
      t.check(`GPU ${k + 1}: L2 capacity`, r.l2Bytes === spec.l2Bytes, `got ${r.l2Bytes}`);
      t.check(`GPU ${k + 1}: sector size`, r.sectorBytes === spec.sectorBytes, `got ${r.sectorBytes}`);
      t.check(`GPU ${k + 1}: shared banks`, r.sharedBanks === spec.sharedBanks, `got ${r.sharedBanks}`);
    });
  },
});
