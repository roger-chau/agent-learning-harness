GW.exercise({
  id: "scenario-3-a",
  title: "Lidar occupancy within 12,000 cycles",
  file: "voxels.js",
  prompt: `<p><code>occupancyList(px, py, pz, n)</code> → <code>{ ids, counts, k, stats }</code>, exact and ≤ 12,000 total cycles on the test sweep.</p>`,
  starter: `
function occupancyList(px, py, pz, n) {
  // TODO: your design. Return { ids, counts, k, stats: [every launch] }.
}

// A synthetic sweep: ground plane, a wall, and clutter.
function makeSweep(n, seed0) {
  let seed = seed0;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const P = [[], [], []];
  for (let i = 0; i < n; i++) {
    const r = rnd();
    if (r < 0.5) { P[0].push(rnd() * 32); P[1].push((rnd() - 0.5) * 32); P[2].push(-1.8 + rnd() * 0.3); }
    else if (r < 0.8) { P[0].push(10 + rnd() * 0.8); P[1].push(-4 + rnd() * 8); P[2].push(-1.5 + rnd() * 3); }
    else { P[0].push(rnd() * 40); P[1].push((rnd() - 0.5) * 40); P[2].push(-3 + rnd() * 10); }
  }
  return P;
}

function main() {
  const P = makeSweep(50000, 11);
  const r = occupancyList(gpu.from(P[0]), gpu.from(P[1]), gpu.from(P[2]), 50000);
  print("occupied voxels:", r.k, " total cycles:", r.stats.reduce((a, s) => a + s.cycles, 0));
  r.stats.forEach((s) => table(s));
}
`,
  tests(t) {
    const run = t.fn("occupancyList"), mk = t.fn("makeSweep");
    for (const [n, seed] of [[50000, 23], [3000, 5]]) {
      const P = mk(n, seed);
      const fx = P.map((a) => Float32Array.from(a));
      const grid = new Map();
      for (let i = 0; i < n; i++) {
        const vx = Math.floor(fx[0][i] / 0.5), vy = Math.floor((fx[1][i] + 16) / 0.5), vz = Math.floor((fx[2][i] + 2) / 0.5);
        if (vx >= 0 && vx < 64 && vy >= 0 && vy < 64 && vz >= 0 && vz < 16) { const id = (vz * 64 + vy) * 64 + vx; grid.set(id, (grid.get(id) || 0) + 1); }
      }
      const want = [...grid.keys()].sort((a, b) => a - b);
      const r = run(t.gpu.from(P[0]), t.gpu.from(P[1]), t.gpu.from(P[2]), n);
      const ok = r && r.ids && r.counts && typeof r.k === "number" && Array.isArray(r.stats);
      t.check(`${n} points: returns { ids, counts, k, stats }`, ok, "return { ids, counts, k, stats: [...] }");
      if (!ok) continue;
      let bad = r.k === want.length ? -1 : -2;
      if (bad === -1) for (let j = 0; j < want.length; j++) if (r.ids.data[j] !== want[j] || r.counts.data[j] !== grid.get(want[j])) { bad = j; break; }
      t.check(`${n} points: exact occupied voxels, ascending, with counts`, bad === -1,
        bad === -2 ? `k = ${r.k}, expected ${want.length}` : `entry ${bad}: id ${r.ids.data[bad]} count ${r.counts.data[bad]}, expected id ${want[bad]} count ${grid.get(want[bad])}`);
      if (n === 50000) {
        const total = r.stats.reduce((a, s) => a + s.cycles, 0);
        t.check("50,000 points: ≤ 12,000 total cycles", total <= 12000, `${total} cycles over ${r.stats.length} launches`);
      }
    }
  },
});
