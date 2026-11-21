GW.exercise({
  id: "scenario-9-a",
  title: "The metric that wouldn't match",
  file: "metric.js",
  prompt: `<p>Implement <code>runMetric(dev, x, n, th, launchOpts)</code>: exact count, accurate sum, identical bits on 32- and 64-lane GPUs and any block order, no slower than <code>runShipped</code>.</p>`,
  starter: `
const K = gpu.compile(\`
// Shipped: fast, but warp-size dependent and order dependent.
function metricShipped(x, cnt, sum, n, th) {
  const i = blockIdx.x * blockDim.x + threadIdx.x, v = i < n ? x[i] : 0, hit = i < n && v > th;
  const m = __ballot_sync(0xffffffff, hit);
  let s = hit ? v : 0;
  for (let o = 16; o > 0; o >>= 1) s += __shfl_down_sync(0xffffffff, s, o);
  if ((threadIdx.x & 31) === 0) { atomicAdd(cnt, 0, __popc(m)); atomicAdd(sum, 0, s); }
}
// your kernel(s) here
\`);

function runShipped(dev, x, n, th, launchOpts) {
  const cnt = dev.from([0], "u32"), sum = dev.from([0]);
  const s = dev.launch(K.metricShipped, { grid: Math.ceil(n / 256), block: 256, ...launchOpts }, x, cnt, sum, n, th);
  return { count: cnt.data[0], sum: sum.data[0], stats: [s] };
}

function runMetric(dev, x, n, th, launchOpts) {
  return runShipped(dev, x, n, th, launchOpts); // TODO
}

function main() {
  const n = 1 << 16;
  for (const ws of [32, 64]) for (const seed of [1, 2]) {
    const dev = new GPUSim.Device({ warpSize: ws });
    const x = dev.from(Array.from({ length: n }, (_, i) => Math.sin(i * 1.3) * 100 + 1e-3 * (i % 97)));
    const r = runMetric(dev, x, n, 20, { blockOrder: "shuffle", seed });
    print("warp", ws, "order", seed, ": count", r.count, "sum", r.sum, "cycles", r.stats.reduce((a, s) => a + s.cycles, 0));
  }
}
`,
  tests(t) {
    const run = t.fn("runMetric"), ship = t.fn("runShipped"), n = 1 << 16, th = 15;
    const data = Array.from({ length: n }, (_, i) => Math.cos(i * 0.71) * 100 + 1e-3 * (i % 89));
    const ref = new Float32Array(data), hits = Array.from(ref).filter((v) => v > th), exact = hits.reduce((a, b) => a + b, 0);
    const sums = [];
    let shippedCycles = 0, yourCycles = 0;
    for (const ws of [32, 64]) for (const seed of [3, 4]) {
      const dev = new t.GPUSim.Device({ warpSize: ws }), x = dev.from(data);
      const r = run(dev, x, n, th, { blockOrder: "shuffle", seed }) || {};
      t.check(`warp ${ws}, order ${seed}: count exact`, r.count === hits.length, `got ${r.count}, expected ${hits.length}`);
      t.check(`warp ${ws}, order ${seed}: sum accurate`, typeof r.sum === "number" && Math.abs(r.sum - exact) <= 1e-6 * Math.abs(exact), `got ${r.sum}, exact ${exact}`);
      sums.push(r.sum);
      if (ws === 32 && seed === 3) {
        yourCycles = Array.isArray(r.stats) ? r.stats.reduce((a, s) => a + (s.cycles || 0), 0) : Infinity;
        shippedCycles = ship(dev, x, n, th, { blockOrder: "shuffle", seed }).stats.reduce((a, s) => a + s.cycles, 0);
      }
    }
    t.check("sum is bit-for-bit identical on both GPUs and every order", sums.every((s) => Object.is(s, sums[0])), `got ${sums.join(", ")}`);
    t.check("no slower than the shipped version", yourCycles <= shippedCycles, `${yourCycles} cycles vs shipped ${shippedCycles}`);
  },
});
