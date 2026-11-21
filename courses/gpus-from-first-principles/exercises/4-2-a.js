GW.exercise({
  id: "4-2-a",
  title: "Tile-size trade-offs",
  file: "tiles.js",
  prompt: `
<p>For an <code>n × n</code> GEMM with square <code>T × T</code> shared-memory tiles (one thread per output, FP32):</p>
<ol>
<li><code>globalLoads(n, T)</code>: total global element loads (A and B) over the whole kernel.</li>
<li><code>sharedBytesPerBlock(T)</code>: bytes of shared memory per block (one tile of A and one of B).</li>
<li><code>blocksFor(n, T)</code>: how many blocks the grid has.</li>
<li><code>bestTile(n, sms, candidates)</code>: among the candidate tile sizes, the <strong>largest</strong> T that still gives at least one block per SM (<code>blocksFor ≥ sms</code>) and uses at most 1,024 threads per block. Return <code>null</code> if none qualify.</li>
</ol>`,
  starter: `
function globalLoads(n, T) {
  // TODO
}
function sharedBytesPerBlock(T) {
  // TODO
}
function blocksFor(n, T) {
  // TODO
}
function bestTile(n, sms, candidates) {
  // TODO
}

function main() {
  for (const T of [8, 16, 32]) print(T, globalLoads(256, T), sharedBytesPerBlock(T), blocksFor(256, T));
  print("best for 256 on 16 SMs:", bestTile(256, 16, [8, 16, 32, 64]));
}
`,
  tests(t) {
    const gl = t.fn("globalLoads"), sb = t.fn("sharedBytesPerBlock"), bf = t.fn("blocksFor"), bt = t.fn("bestTile");
    t.check("globalLoads(256, 16) = 2·256³/16", gl(256, 16) === (2 * 256 ** 3) / 16, `got ${gl(256, 16)}`);
    t.check("globalLoads(128, 32)", gl(128, 32) === (2 * 128 ** 3) / 32, `got ${gl(128, 32)}`);
    t.check("sharedBytesPerBlock(16) = 2048", sb(16) === 2048, `got ${sb(16)}`);
    t.check("sharedBytesPerBlock(32) = 8192", sb(32) === 8192, `got ${sb(32)}`);
    t.check("blocksFor(256, 16) = 256", bf(256, 16) === 256, `got ${bf(256, 16)}`);
    t.check("blocksFor(100, 16) = 49", bf(100, 16) === 49, `got ${bf(100, 16)}`);
    t.check("bestTile(256, 16, [8,16,32,64]) = 32", bt(256, 16, [8, 16, 32, 64]) === 32, `got ${bt(256, 16, [8, 16, 32, 64])} (64×64 needs 4,096 threads)`);
    t.check("bestTile(64, 16, [8,16,32]) = 16", bt(64, 16, [8, 16, 32]) === 16, `got ${bt(64, 16, [8, 16, 32])}`);
    t.check("bestTile(16, 16, [8, 16]) = null", bt(16, 16, [8, 16]) === null, `got ${bt(16, 16, [8, 16])}`);
  },
});
