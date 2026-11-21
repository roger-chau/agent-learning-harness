GW.exercise({
  id: "2-6-a",
  title: "Build the occupancy calculator",
  file: "occupancy.js",
  prompt: `
<p>Implement <code>occupancy(threadsPerBlock, registersPerThread, sharedBytesPerBlock)</code> for the GW-1, using the rules in the chapter. Return:</p>
<pre><code>{ blocksPerSM, warpsPerSM, occupancy, limiter }</code></pre>
<p>Here <code>limiter</code> is one of <code>"warps"</code>, <code>"blocks"</code>, <code>"registers"</code> or <code>"sharedMemory"</code>. When limits tie, prefer them in that order. The GW-1 numbers: 64 warps, 16 blocks, 65,536 registers allocated per warp in chunks of 256, and 65,536 bytes of shared memory allocated in chunks of 256.</p>
<p>Then write <code>bestBlockSize(registersPerThread, sharedBytesPerBlock)</code>. It tries block sizes 64, 96, …, 1024 (multiples of 32) and returns the smallest one that reaches the highest occupancy.</p>
<p>The checks compare your calculator with the simulator's on hundreds of configurations.</p>`,
  starter: `
const GW1 = { maxWarps: 64, maxBlocks: 16, registers: 65536, regUnit: 256, shared: 65536, sharedUnit: 256 };

function occupancy(threadsPerBlock, registersPerThread, sharedBytesPerBlock) {
  // TODO
}

function bestBlockSize(registersPerThread, sharedBytesPerBlock) {
  // TODO
}

function main() {
  print(occupancy(256, 32, 0));      // 8 blocks, 100%
  print(occupancy(256, 80, 0));      // 3 blocks
  print(occupancy(128, 32, 20000));  // shared memory limits
  print(bestBlockSize(72, 0));
}
`,
  tests(t) {
    const occ = t.fn("occupancy"), best = t.fn("bestBlockSize");
    let seed = 3;
    const rnd = (m) => (seed = (seed * 1103515245 + 12345) % 2147483648) % m;
    const configs = [[256, 32, 0], [256, 64, 0], [256, 80, 0], [128, 32, 20000], [32, 16, 0], [1024, 64, 0], [96, 255, 0], [512, 40, 49152]];
    for (let i = 0; i < 300; i++) configs.push([32 * (1 + rnd(32)), 16 + rnd(240), rnd(4) === 0 ? 0 : rnd(49153)]);
    let bad = null, n = 0;
    for (const [tpb, regs, smem] of configs) {
      const want = t.gpu.occupancy(tpb, regs, smem);
      const got = occ(tpb, regs, smem);
      n++;
      if (!got || got.blocksPerSM !== want.blocksPerSM || got.warpsPerSM !== want.warpsPerSM || Math.abs(got.occupancy - want.occupancy) > 1e-9 || got.limiter !== want.limiter) {
        bad = `occupancy(${tpb}, ${regs}, ${smem}): expected ${want.blocksPerSM} blocks, ${want.warpsPerSM} warps, limiter ${want.limiter}; got ${got ? `${got.blocksPerSM}, ${got.warpsPerSM}, ${got.limiter}` : got}`;
        break;
      }
    }
    t.check(`matches the simulator on ${configs.length} configurations`, !bad, bad || "");
    const refBest = (regs, smem) => {
      let bestB = 64, bestO = -1;
      for (let b = 64; b <= 1024; b += 32) { const o = t.gpu.occupancy(b, regs, smem).occupancy; if (o > bestO + 1e-12) { bestO = o; bestB = b; } }
      return bestB;
    };
    for (const [regs, smem] of [[32, 0], [72, 0], [128, 0], [40, 12000], [255, 0]]) {
      const want = refBest(regs, smem);
      t.check(`bestBlockSize(${regs}, ${smem}) = ${want}`, best(regs, smem) === want, `got ${best(regs, smem)}`);
    }
  },
});
