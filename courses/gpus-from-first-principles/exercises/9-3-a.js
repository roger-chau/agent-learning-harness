GW.exercise({
  id: "9-3-a",
  title: "Energy, clocks and data movement",
  file: "energy.js",
  prompt: `
<ol>
<li><code>dynamicPower(C, V, f)</code>: C · V² · f.</li>
<li><code>kernelEnergyJ(s, m)</code>: energy in joules of a launch with stats <code>s</code>: <code>s.flops · m.pjPerFlop + s.dramBytes · m.pjPerDramByte + s.bytesMoved · m.pjPerL2Byte</code> picojoules, plus <code>m.staticW</code> watts for <code>s.timeUs</code> microseconds.</li>
<li><code>bestClock(job, freqs, p)</code>: a job needs <code>job.cycles</code> core cycles and at least <code>job.memUs</code> µs of DRAM time. At clock f (GHz) its time is max(cycles / (f · 1000), memUs) µs and the power is <code>p.staticW + p.k · f³</code> watts. Return the f in <code>freqs</code> with the lowest energy (power × time); on a tie, the higher f.</li>
</ol>`,
  starter: `
function dynamicPower(C, V, f) {
  // TODO
}
function kernelEnergyJ(s, m) {
  // TODO
}
function bestClock(job, freqs, p) {
  // TODO
}

const MODEL = { pjPerFlop: 2, pjPerDramByte: 80, pjPerL2Byte: 10, staticW: 30 };
const K = gpu.compile(\`
function copy(x, y, n) { const i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) y[i] = x[i]; }
function strided(x, y, n) { const i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) y[i] = x[(i * 8) % n]; }
\`);

function main() {
  const n = 1 << 14, x = gpu.from(new Array(n).fill(1)), y = gpu.alloc(n);
  for (const k of [K.copy, K.strided]) { const s = gpu.launch(k, { grid: n / 256, block: 256 }, x, y, n); print(k.name, (kernelEnergyJ(s, MODEL) * 1e6).toFixed(2), "µJ in", s.timeUs, "µs"); }
  const freqs = [0.6, 0.9, 1.2, 1.5, 1.8], p = { staticW: 150, k: 20 };
  print("compute-bound:", bestClock({ cycles: 1.5e6, memUs: 100 }, freqs, p), "GHz;  memory-bound:", bestClock({ cycles: 0.3e6, memUs: 800 }, freqs, p), "GHz");
}
`,
  tests(t) {
    const dp = t.fn("dynamicPower"), ke = t.fn("kernelEnergyJ"), bc = t.fn("bestClock");
    t.check("dynamicPower(1e-9, 1, 1.5e9) = 1.5", t.approx(dp(1e-9, 1, 1.5e9), 1.5), `got ${dp(1e-9, 1, 1.5e9)}`);
    t.check("dynamicPower scales with V²", t.approx(dp(2, 2, 3) / dp(2, 1, 3), 4), `got ${dp(2, 2, 3) / dp(2, 1, 3)}`);
    const m = { pjPerFlop: 2, pjPerDramByte: 80, pjPerL2Byte: 10, staticW: 30 };
    const s = { flops: 1e6, dramBytes: 2e5, bytesMoved: 3e5, timeUs: 5 };
    t.check("kernelEnergyJ", t.approx(ke(s, m), (1e6 * 2 + 2e5 * 80 + 3e5 * 10) * 1e-12 + 30 * 5e-6), `got ${ke(s, m)}`);
    const freqs = [0.6, 0.9, 1.2, 1.5, 1.8], p = { staticW: 150, k: 20 };
    const ref = (job) => { let best = null, be = Infinity; for (const f of freqs) { const tt = Math.max(job.cycles / (f * 1000), job.memUs), e = (p.staticW + p.k * f ** 3) * tt; if (e <= be) { be = e; best = f; } } return best; };
    for (const job of [{ cycles: 1.5e6, memUs: 100 }, { cycles: 0.3e6, memUs: 800 }, { cycles: 1e6, memUs: 900 }, { cycles: 2e6, memUs: 0 }]) {
      t.check(`bestClock(${job.cycles} cycles, ${job.memUs} µs) = ${ref(job)} GHz`, bc(job, freqs, p) === ref(job), `got ${bc(job, freqs, p)}`);
    }
    t.check("a memory-bound job prefers a lower clock than a compute-bound one", ref({ cycles: 0.3e6, memUs: 800 }) < ref({ cycles: 1.5e6, memUs: 100 }) && bc({ cycles: 0.3e6, memUs: 800 }, freqs, p) < bc({ cycles: 1.5e6, memUs: 100 }, freqs, p), "check your time model");
  },
});
