GW.exercise({
  id: "scenario-1-a",
  title: "Divergent physics: 2× fewer cycles",
  file: "particles.js",
  prompt: `<p><code>runParticles(state, x, out, n)</code> must fill <code>out</code> exactly as <code>baseline</code> does and return an array with the stats of every launch you made. The check requires the total cycles to be at most half the baseline's.</p>`,
  starter: `
const TRIPS = [0, 8, 64]; // idle, drifting, colliding

// Don't change this.
function physics(v, trips) {
  let r = v;
  for (let k = 0; k < trips; k++) r = r * 0.99 + 0.01 * k;
  return r;
}

function baseline(state, x, out, n) {
  const i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i < n) out[i] = physics(x[i], TRIPS[state[i]]);
}

function runParticles(state, x, out, n) {
  // TODO: your approach. Return [stats, stats, ...] for every launch.
  return [gpu.launch(baseline, { grid: Math.ceil(n / 256), block: 256 }, state, x, out, n)];
}

function main() {
  const n = 20000;
  let seed = 5;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const st = Array.from({ length: n }, () => { const r = rnd(); return r < 0.6 ? 0 : r < 0.9 ? 1 : 2; });
  const state = gpu.from(st, "u8"), x = gpu.from(Array.from({ length: n }, () => rnd())), out = gpu.alloc(n);
  const runs = runParticles(state, x, out, n);
  print("launches:", runs.length, " total cycles:", runs.reduce((a, s) => a + s.cycles, 0));
  runs.forEach((s) => table(s));
}
`,
  tests(t) {
    const run = t.fn("runParticles"), base = t.fn("baseline");
    for (const [n, seed0] of [[20000, 5], [7777, 99]]) {
      let seed = seed0;
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const st = Array.from({ length: n }, () => { const r = rnd(); return r < 0.6 ? 0 : r < 0.9 ? 1 : 2; });
      const xs = Array.from({ length: n }, () => rnd());
      const state = t.gpu.from(st, "u8"), x = t.gpu.from(xs), want = t.gpu.alloc(n), out = t.gpu.alloc(n);
      const sb = t.gpu.launch(base, { grid: Math.ceil(n / 256), block: 256 }, state, x, want, n);
      const runs = run(t.gpu.from(st, "u8"), t.gpu.from(xs), out, n);
      const ok = Array.isArray(runs) && runs.length > 0 && runs.every((s) => s && typeof s.cycles === "number");
      t.check(`n = ${n}: returns the stats of every launch`, ok, "return an array of launch stats");
      if (!ok) continue;
      let bad = -1;
      for (let i = 0; i < n; i++) if (Math.abs(out.data[i] - want.data[i]) > 1e-5) { bad = i; break; }
      t.check(`n = ${n}: results identical to the baseline`, bad < 0, bad >= 0 ? `out[${bad}] = ${out.data[bad]}, expected ${want.data[bad]}` : "");
      const total = runs.reduce((a, s) => a + s.cycles, 0);
      if (n === 20000) t.check(`n = ${n}: at most half the baseline's cycles`, total * 2 <= sb.cycles, `${total} cycles vs baseline ${sb.cycles} (${(sb.cycles / total).toFixed(2)}×)`);
    }
  },
});
