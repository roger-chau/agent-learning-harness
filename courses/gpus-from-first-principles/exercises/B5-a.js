GW.exercise({
  id: "B5-a",
  title: "Profile and fix the library",
  file: "library.js",
  prompt: `<p>Diagnose all four kernels; make at least two of sum, histogram and scan ≥ 3× faster. Keep the runner signatures.</p>`,
  starter: `
// ---- the teammate's library, as shipped ----
function sumSlow(x, out, n) {
  const sh = shared("sh", 256), tid = threadIdx.x, i = blockIdx.x * 256 + tid;
  sh[tid] = i < n ? x[i] : 0;
  __syncthreads();
  for (let s = 1; s < 256; s *= 2) {
    if (tid % (2 * s) === 0) sh[tid] += sh[tid + s];
    __syncthreads();
  }
  if (tid === 0) atomicAdd(out, 0, sh[0]);
}
function histSlow(x, bins, n) {
  const i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i < n) atomicAdd(bins, x[i] & 15, 1);
}
function speedOf(p, out, n) {
  // particles stored as 8 floats each: x, y, z, vx, vy, vz, mass, id
  const i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i < n) out[i] = p[i * 8 + 3] * 2;
}
function scanOneBlock(x, y, n) {
  // one block walks the whole array in chunks of 256, Hillis-Steele inside each chunk
  const sh = shared("sh", 256), tid = threadIdx.x;
  let carry = 0;
  for (let c = 0; c < n; c += 256) {
    sh[tid] = x[c + tid];
    __syncthreads();
    for (let o = 1; o < 256; o *= 2) { const v = tid >= o ? sh[tid - o] : 0; __syncthreads(); sh[tid] += v; __syncthreads(); }
    y[c + tid] = sh[tid] + carry;
    carry += sh[255];
    __syncthreads();
  }
}

function runSum(x, out, n) {
  out.data[0] = 0;
  return [gpu.launch(sumSlow, { grid: Math.ceil(n / 256), block: 256 }, x, out, n)];
}
function runHist(x, bins, n) {
  bins.data.fill(0);
  return [gpu.launch(histSlow, { grid: Math.ceil(n / 256), block: 256 }, x, bins, n)];
}
function runSpeed(p, out, n) {
  return [gpu.launch(speedOf, { grid: Math.ceil(n / 256), block: 256 }, p, out, n)];
}
function runScan(x, y, n) {
  return [gpu.launch(scanOneBlock, { grid: 1, block: 256 }, x, y, n)];
}

function main() {
  const n = 1 << 18;
  const x = gpu.from(Array.from({ length: n }, (_, i) => (i * 7) % 13));
  const xi = gpu.from(Array.from({ length: n }, (_, i) => (i % 4 ? 3 : (i * 2654435761) >>> 0)), "u32");
  const p = gpu.from(Array.from({ length: n * 8 }, (_, i) => i % 9));
  const report = (name, st) => print(name.padEnd(6), st.reduce((a, s) => a + s.cycles, 0), "cycles |", st.map((s) => s.limitedBy + " " + JSON.stringify(s.sol) + " balance " + s.smBalance).join(" | "));
  report("sum", runSum(x, gpu.alloc(1), n));
  report("hist", runHist(xi, gpu.alloc(16, "u32"), n));
  report("speed", runSpeed(p, gpu.alloc(n), n));
  const m = 1 << 16;
  report("scan", runScan(gpu.from(Array.from({ length: m }, (_, i) => i % 5)), gpu.alloc(m), m));
}
`,
  tests(t) {
    const BASE = { sum: 24400, hist: 13712, scan: 205200 };
    const total = (st) => (Array.isArray(st) && st.length && st.every((s) => s && typeof s.cycles === "number") ? st.reduce((a, s) => a + s.cycles, 0) : NaN);
    const n = 1 << 18, m = 1 << 16;
    const x = t.gpu.from(Array.from({ length: n }, (_, i) => ((i * 11) % 17) - 8));
    const xi = t.gpu.from(Array.from({ length: n }, (_, i) => (i % 4 ? 7 : (i * 2246822519) >>> 0)), "u32");
    const p = t.gpu.from(Array.from({ length: n * 8 }, (_, i) => (i % 13) / 4));
    let fixed = 0;
    const speed = (name, c) => { const r = BASE[name] / c; if (r >= 3) fixed++; t.check(`${name}: ${c} cycles, ${r.toFixed(2)}× the shipped ${BASE[name]}`, c > 0, "return the launch stats"); };
    {
      const out = t.gpu.from([123]), st = t.fn("runSum")(x, out, n);
      let ref = 0; for (let i = 0; i < n; i++) ref += x.data[i];
      t.check("sum: correct", Math.abs(out.data[0] - ref) < 1e-3 * Math.max(1, Math.abs(ref)), `got ${out.data[0]}, expected ${ref}`);
      speed("sum", total(st));
    }
    {
      const bins = t.gpu.from(new Array(16).fill(99), "u32"), st = t.fn("runHist")(xi, bins, n);
      const ref = new Array(16).fill(0); for (let i = 0; i < n; i++) ref[xi.data[i] & 15]++;
      t.check("hist: correct", ref.every((v, i) => bins.data[i] === v), `got ${JSON.stringify([...bins.data])}`);
      speed("hist", total(st));
    }
    {
      const out = t.gpu.alloc(n), st = t.fn("runSpeed")(p, out, n);
      let ok = true; for (let i = 0; i < n; i++) if (Math.abs(out.data[i] - 2 * p.data[i * 8 + 3]) > 1e-6) { ok = false; break; }
      t.check("speed: correct", ok && total(st) > 0, "wrong output or no stats");
    }
    {
      const xs = t.gpu.from(Array.from({ length: m }, (_, i) => (i * 3) % 7)), y = t.gpu.alloc(m), st = t.fn("runScan")(xs, y, m);
      let s = 0, ok = true; for (let i = 0; i < m; i++) { s += xs.data[i]; if (y.data[i] !== s) { ok = false; break; } }
      t.check("scan: correct", ok, "wrong prefix sums");
      speed("scan", total(st));
    }
    t.check("at least two of sum, hist and scan are ≥ 3× faster", fixed >= 2, `${fixed} of 3`);
  },
});
