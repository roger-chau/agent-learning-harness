GW.exercise({
  id: "10-8-a",
  title: "Direct Coulomb summation: gather and coarsen",
  file: "dcs.js",
  prompt: `
<p>Compute the electrostatic potential on one z-slice of a grid: for grid point (i, j), at position (i·h, j·h, z0), <code>pot[j·NX + i] = Σ_a q_a / distance</code> over all atoms. Atoms are stored as <code>[x, y, z, q]</code> per atom in an <code>f32</code> array.</p>
<p>Write <code>dcs(atoms, nAtoms, pot, NX, NY, h, z0)</code> as a <strong>gather</strong> (each thread owns output points and loops over atoms: no atomics) with <strong>thread coarsening</strong>: each thread computes <strong>4 consecutive points in x</strong>, loading each atom once and reusing dy² + dz², which is the same for all four. Guard the last points when NX isn't a multiple of 4.</p>
<p><code>runDcs(...)</code> launches 16 × 8 blocks (each thread covering 4 x-points) and returns the stats. Checks: relative error under 10⁻⁵, no atomics, at most 1.5 warp-loads per atom–point pair (×32 lanes), and under 10 µs (the scatter version, a thread per atom with atomicAdd into every point, takes about 44).</p>`,
  starter: `
function dcs(atoms, nAtoms, pot, NX, NY, h, z0) {
  // TODO: i0 = 4 * (global x thread), j = global y thread; four accumulators
}

function runDcs(atoms, nAtoms, pot, NX, NY, h, z0) {
  // TODO
}

function main() {
  const atoms = gpu.from([1, 1, 0, 1,  3, 2, 0, -1], "f32"), pot = gpu.alloc(8 * 4, "f32");
  table(runDcs(atoms, 2, pot, 8, 4, 0.5, 1));
  print(pot.toArray().slice(0, 8));
}
`,
  tests(t) {
    const run = t.fn("runDcs");
    for (const [NX, NY, nA] of [[62, 16, 64], [9, 3, 5]]) {
      const h = 0.5, z0 = 1.25, at = [];
      for (let a = 0; a < nA; a++) at.push(((a * 37) % 61) * 0.5 + 0.17, ((a * 11) % 17) * 0.5 + 0.31, (a % 5) * 0.4, (a % 3) - 1 || 0.5);
      const pot = t.gpu.alloc(NX * NY, "f32");
      const s = run(t.gpu.from(at, "f32"), nA, pot, NX, NY, h, z0);
      const f = Math.fround;
      let worst = 0, where = -1;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        let v = 0;
        for (let a = 0; a < nA; a++) { const dx = i * h - f(at[4 * a]), dy = j * h - f(at[4 * a + 1]), dz = z0 - f(at[4 * a + 2]); v += f(at[4 * a + 3]) / Math.sqrt(dx * dx + dy * dy + dz * dz); }
        const e = Math.abs(pot.data[j * NX + i] - v) / Math.max(1, Math.abs(v));
        if (!(e <= worst)) { worst = e; where = j * NX + i; }
      }
      t.check(`${NX} × ${NY} points, ${nA} atoms: accurate`, worst < 1e-5 && !!s, !s ? "return the stats" : `point ${where}: relative error ${worst}`);
      if (s && NX === 62) {
        t.check("a gather: no atomics", s.atomics === 0, `${s.atomics} atomic instructions`);
        const lp = (s.loads * 32) / (NX * NY * nA);
        t.check("coarsened: at most 1.5 loads per atom–point pair", lp <= 1.5, `${lp.toFixed(2)}`);
        t.check("under 10 µs", s.timeUs < 10, `${s.timeUs} µs`);
      }
    }
  },
});
