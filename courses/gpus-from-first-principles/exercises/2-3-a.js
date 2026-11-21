GW.exercise({
  id: "2-3-a",
  title: "Particles: array of structures to structure of arrays",
  file: "particles.js",
  prompt: `
<p>The starter has an AoS particle update. Each particle is 4 floats <code>[x, y, vx, vy]</code>, and the kernel moves it by <code>dt</code> and applies gravity to <code>vy</code>. Run <code>main()</code> to see its coalescing.</p>
<ol>
<li><code>toSoA(p, n)</code> (plain JavaScript, not a kernel) takes the AoS buffer and returns <code>{ x, y, vx, vy }</code>, four new <code>f32</code> device buffers made with <code>gpu.from(...)</code>.</li>
<li>Kernel <code>stepSoA(x, y, vx, vy, n, dt)</code> does the same update on the SoA layout.</li>
<li><code>runSoA(soa, n, dt)</code> launches it with blocks of 256 and returns the stats.</li>
</ol>
<p>The checks compare against the AoS kernel and require at least 99% coalescing.</p>`,
  starter: `
const G = -9.8;

function stepAoS(p, n, dt) {
  const i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i < n) {
    const vy = p[4 * i + 3] + G * dt;
    p[4 * i + 0] = p[4 * i + 0] + p[4 * i + 2] * dt;
    p[4 * i + 1] = p[4 * i + 1] + vy * dt;
    p[4 * i + 3] = vy;
  }
}

function toSoA(p, n) {
  // TODO: return { x, y, vx, vy } as f32 device buffers
}

function stepSoA(x, y, vx, vy, n, dt) {
  // TODO
}

function runSoA(soa, n, dt) {
  // TODO
}

function main() {
  const n = 4096;
  const init = Array.from({ length: 4 * n }, (_, k) => (k % 7) - 3);
  const p = gpu.from(init);
  print("AoS:"); table(gpu.launch(stepAoS, { grid: n / 256, block: 256 }, p, n, 0.01));
  const soa = toSoA(gpu.from(init), n);
  print("SoA:"); table(runSoA(soa, n, 0.01));
}
`,
  tests(t) {
    const conv = t.fn("toSoA"), run = t.fn("runSoA"), aos = t.fn("stepAoS");
    for (const n of [1, 1000, 4096]) {
      const init = Array.from({ length: 4 * n }, (_, k) => ((k * 13) % 11) - 5);
      const p = t.gpu.from(init);
      t.gpu.launch(aos, { grid: Math.ceil(n / 256), block: 256 }, p, n, 0.02);
      const soa = conv(t.gpu.from(init), n);
      const shapeOk = soa && ["x", "y", "vx", "vy"].every((k) => soa[k] && soa[k].data && soa[k].data.length === n);
      t.check(`n = ${n}: toSoA returns four buffers of length n`, shapeOk, "return { x, y, vx, vy } made with gpu.from(...)");
      if (!shapeOk) continue;
      const s = run(soa, n, 0.02);
      let bad = -1;
      for (let i = 0; i < n && bad < 0; i++) {
        const got = [soa.x.data[i], soa.y.data[i], soa.vx.data[i], soa.vy.data[i]];
        for (let f = 0; f < 4; f++) if (Math.abs(got[f] - p.data[4 * i + f]) > 1e-4) bad = i;
      }
      t.check(`n = ${n}: SoA result matches AoS`, bad < 0, bad >= 0 ? `particle ${bad} differs` : "");
      t.check(`n = ${n}: SoA is coalesced (≥99%)`, s && s.coalescing >= 0.99 - (n < 32 ? 1 : 0), s ? `coalescing ${(s.coalescing * 100).toFixed(1)}%` : "return the stats");
    }
  },
});
