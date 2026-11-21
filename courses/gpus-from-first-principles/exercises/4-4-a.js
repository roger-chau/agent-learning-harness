GW.exercise({
  id: "4-4-a",
  title: "Sizing a pipeline",
  file: "pipeline.js",
  prompt: `
<ol>
<li><code>copyInstructions(elements, threads, vec)</code>: warp-level load instructions for a block of <code>threads</code> threads to copy <code>elements</code> floats with <code>vec</code>-wide loads (each thread loops until the tile is covered: ceil(elements / (threads · vec)) iterations per thread, and every warp issues one instruction per iteration).</li>
<li><code>stageBytes(BM, BN, BK)</code>: bytes of one shared-memory stage holding a BM×BK tile of A and a BK×BN tile of B (4-byte floats).</li>
<li><code>maxStages(BM, BN, BK, sharedLimit)</code>: how many whole stages fit in <code>sharedLimit</code> bytes.</li>
<li><code>ilpToSaturate(residentWarps, bytesPerRequest, latencyCycles, peakBytesPerCycle)</code>: the smallest whole number of independent requests per warp that keeps enough bytes in flight to reach peak bandwidth (Little's law).</li>
</ol>`,
  starter: `
function copyInstructions(elements, threads, vec) {
  // TODO
}
function stageBytes(BM, BN, BK) {
  // TODO
}
function maxStages(BM, BN, BK, sharedLimit) {
  // TODO
}
function ilpToSaturate(residentWarps, bytesPerRequest, latencyCycles, peakBytesPerCycle) {
  // TODO
}

function main() {
  print(copyInstructions(64 * 16, 64, 1), copyInstructions(64 * 16, 64, 4));
  print(stageBytes(128, 128, 32), maxStages(128, 128, 32, 48 * 1024));
  print(ilpToSaturate(256, 128, 400, 512 / 1.5));
}
`,
  tests(t) {
    const ci = t.fn("copyInstructions"), sb = t.fn("stageBytes"), ms = t.fn("maxStages"), il = t.fn("ilpToSaturate");
    t.check("copyInstructions(1024, 64, 1) = 32", ci(1024, 64, 1) === 32, `got ${ci(1024, 64, 1)}`);
    t.check("copyInstructions(1024, 64, 4) = 8", ci(1024, 64, 4) === 8, `got ${ci(1024, 64, 4)}`);
    t.check("copyInstructions(1000, 256, 4) = 8 (partial last pass)", ci(1000, 256, 4) === 8, `got ${ci(1000, 256, 4)}`);
    t.check("stageBytes(64, 64, 16) = 8192", sb(64, 64, 16) === 8192, `got ${sb(64, 64, 16)}`);
    t.check("stageBytes(128, 128, 32) = 32768", sb(128, 128, 32) === 32768, `got ${sb(128, 128, 32)}`);
    t.check("maxStages(128, 128, 32, 48 KB) = 1", ms(128, 128, 32, 49152) === 1, `got ${ms(128, 128, 32, 49152)}`);
    t.check("maxStages(64, 64, 16, 48 KB) = 6", ms(64, 64, 16, 49152) === 6, `got ${ms(64, 64, 16, 49152)}`);
    t.check("ilpToSaturate(256, 128, 400, 341.33) = 5", il(256, 128, 400, 512 / 1.5) === 5, `got ${il(256, 128, 400, 512 / 1.5)}`);
    t.check("ilpToSaturate(2048, 128, 400, 341.33) = 1", il(2048, 128, 400, 512 / 1.5) === 1, `got ${il(2048, 128, 400, 512 / 1.5)}`);
  },
});
