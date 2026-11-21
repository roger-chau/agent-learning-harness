GW.exercise({
  id: "paper-tesla-a",
  title: "Back-of-the-envelope for any GPU",
  file: "envelope.js",
  prompt: `
<p>Turn the chapter's calculations into functions, so you can run them on any GPU's spec sheet.</p>
<ol>
<li><code>cyclesPerWarpInstruction(warpSize, lanesPerSM)</code>: cycles one warp instruction occupies the SM's lanes (assume the warp size divides evenly).</li>
<li><code>residentThreads(sms, threadsPerSM)</code>.</li>
<li><code>registersPerThread(regsPerSM, threadsPerSM)</code>: the most registers each thread can have at full occupancy (a whole number).</li>
<li><code>peakGflops(lanes, clockGHz, flopsPerLanePerCycle)</code>.</li>
<li><code>canSaturate(spec)</code> returns <code>true</code> if the GPU's resident threads, with one <code>spec.bytesPerThread</code>-byte load in flight each, cover Little's law for <code>spec.bandwidthGBs</code> and <code>spec.latencyNs</code>. <code>spec</code> also has <code>sms</code> and <code>threadsPerSM</code>.</li>
</ol>`,
  starter: `
function cyclesPerWarpInstruction(warpSize, lanesPerSM) {
  // TODO
}

function residentThreads(sms, threadsPerSM) {
  // TODO
}

function registersPerThread(regsPerSM, threadsPerSM) {
  // TODO
}

function peakGflops(lanes, clockGHz, flopsPerLanePerCycle) {
  // TODO
}

function canSaturate(spec) {
  // TODO
}

function main() {
  const g80 = { sms: 16, threadsPerSM: 768, bandwidthGBs: 86.4, latencyNs: 400, bytesPerThread: 4 };
  print("cycles per warp instruction:", cyclesPerWarpInstruction(32, 8)); // 4
  print("resident threads:", residentThreads(16, 768));
  print("registers per thread:", registersPerThread(8192, 768));
  print("peak GFLOPS (multiply-add = 2 flops):", peakGflops(128, 1.35, 2));
  print("can saturate memory:", canSaturate(g80));
}
`,
  tests(t) {
    const c = t.fn("cyclesPerWarpInstruction"), r = t.fn("residentThreads"), reg = t.fn("registersPerThread"),
      p = t.fn("peakGflops"), cs = t.fn("canSaturate");
    t.check("cyclesPerWarpInstruction(32, 8) = 4", c(32, 8) === 4, `got ${c(32, 8)}`);
    t.check("cyclesPerWarpInstruction(32, 32) = 1", c(32, 32) === 1, `got ${c(32, 32)}`);
    t.check("cyclesPerWarpInstruction(64, 16) = 4", c(64, 16) === 4, `got ${c(64, 16)}`);
    t.check("residentThreads(16, 768) = 12288", r(16, 768) === 12288, `got ${r(16, 768)}`);
    t.check("registersPerThread(8192, 768) = 10", reg(8192, 768) === 10, `got ${reg(8192, 768)}`);
    t.check("registersPerThread(65536, 2048) = 32", reg(65536, 2048) === 32, `got ${reg(65536, 2048)}`);
    t.check("peakGflops(128, 1.35, 2) ≈ 345.6", t.approx(p(128, 1.35, 2), 345.6, 1e-9), `got ${p(128, 1.35, 2)}`);
    t.check("peakGflops(6912, 1.41, 2) ≈ 19491.8", t.approx(p(6912, 1.41, 2), 19491.84, 1e-6), `got ${p(6912, 1.41, 2)}`);
    const g80 = { sms: 16, threadsPerSM: 768, bandwidthGBs: 86.4, latencyNs: 400, bytesPerThread: 4 };
    t.check("G80 at 400 ns can saturate", cs(g80) === true, `got ${cs(g80)}`);
    t.check("G80 at 600 ns cannot (needs 12,960 threads)", cs({ ...g80, latencyNs: 600 }) === false, `got ${cs({ ...g80, latencyNs: 600 })}`);
    const big = { sms: 108, threadsPerSM: 2048, bandwidthGBs: 1555, latencyNs: 600, bytesPerThread: 4 };
    t.check("a 108-SM GPU at 600 ns with 4-byte loads cannot", cs(big) === false, `got ${cs(big)}`);
    t.check("…but with 16 bytes in flight per thread it can", cs({ ...big, bytesPerThread: 16 }) === true, `got ${cs({ ...big, bytesPerThread: 16 })}`);
  },
});
