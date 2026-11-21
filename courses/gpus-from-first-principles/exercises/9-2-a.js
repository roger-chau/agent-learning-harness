GW.exercise({
  id: "9-2-a",
  title: "Port a kernel to 64-wide wavefronts",
  file: "portable.js",
  prompt: `
<p><code>runCount(dev, x, n, th)</code> counts the elements of <code>x</code> above <code>th</code> with ballots on device <code>dev</code>, and returns the count. The starter's kernel works on a 32-lane GPU and silently gives the wrong answer on a 64-lane one. Make it correct on both, using <code>warpSize</code> and <code>__popc</code>. Launch with <code>dev.launch</code>.</p>
<p>Also write <code>lanesPerBlock(threads, waveSize)</code>: the warps (wavefronts) a block of <code>threads</code> occupies, rounding up.</p>`,
  starter: `
const K = gpu.compile(\`
function countAbove(x, out, n, th) {
  const i = blockIdx.x * blockDim.x + threadIdx.x;
  const m = __ballot_sync(0xffffffff, i < n && x[i] > th);
  if ((threadIdx.x & 31) === 0) atomicAdd(out, 0, __popc(m));
}
\`);

function runCount(dev, x, n, th) {
  const out = dev.from([0], "u32");
  dev.launch(K.countAbove, { grid: Math.ceil(n / 256), block: 256 }, x, out, n, th);
  return out.data[0];
}
function lanesPerBlock(threads, waveSize) {
  // TODO
}

function main() {
  for (const ws of [32, 64]) {
    const dev = new GPUSim.Device({ warpSize: ws });
    const x = dev.from(Array.from({ length: 1000 }, (_, i) => i % 10));
    print("warp size", ws, ":", runCount(dev, x, 1000, 6), "(should be 300)");
  }
}
`,
  tests(t) {
    const rc = t.fn("runCount"), lp = t.fn("lanesPerBlock");
    for (const ws of [32, 64]) {
      const dev = new t.GPUSim.Device({ warpSize: ws });
      for (const [n, th] of [[1000, 6], [4096, 2.5], [777, 8]]) {
        const x = dev.from(Array.from({ length: n }, (_, i) => (i * 7) % 10));
        const want = Array.from(x.data).filter((v) => v > th).length;
        const got = rc(dev, x, n, th);
        t.check(`warp size ${ws}, n = ${n}: count = ${want}`, got === want, `got ${got}`);
      }
    }
    t.check("lanesPerBlock(256, 64) = 4", lp(256, 64) === 4, `got ${lp(256, 64)}`);
    t.check("lanesPerBlock(96, 64) = 2", lp(96, 64) === 2, `got ${lp(96, 64)}`);
    t.check("lanesPerBlock(96, 32) = 3", lp(96, 32) === 3, `got ${lp(96, 32)}`);
  },
});
