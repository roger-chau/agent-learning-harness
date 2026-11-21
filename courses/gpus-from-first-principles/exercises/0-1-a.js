GW.exercise({
  id: "0-1-a",
  title: "Little's law, in code",
  file: "littles_law.js",
  prompt: `
<p>Write two functions.</p>
<ol>
<li><code>bytesInFlight(latencyNs, bandwidthGBs)</code> returns how many bytes must be in flight to sustain <code>bandwidthGBs</code> when each request takes <code>latencyNs</code>.</li>
<li><code>threadsNeeded(latencyNs, bandwidthGBs, bytesPerThread)</code> returns how many threads you need if each thread keeps exactly <code>bytesPerThread</code> bytes in flight. It must be a whole number of threads, and enough of them.</li>
</ol>
<p>Use <code>main()</code> and <code>print(...)</code> to try values before pressing <strong>Test &amp; submit</strong>. For the GW-1 (270 ns, 512 GB/s, 4-byte loads) you should get about 34,560 threads.</p>`,
  starter: `
// Little's law: in flight = throughput × latency.
// Units: GB/s × ns = bytes  (1e9 bytes/s × 1e-9 s)

function bytesInFlight(latencyNs, bandwidthGBs) {
  // TODO
}

function threadsNeeded(latencyNs, bandwidthGBs, bytesPerThread) {
  // TODO
}

function main() {
  print("GW-1 bytes in flight:", bytesInFlight(270, 512));
  print("GW-1 threads (4 B each):", threadsNeeded(270, 512, 4));
}
`,
  tests(t) {
    const bif = t.fn("bytesInFlight");
    const tn = t.fn("threadsNeeded");
    const cases = [[270, 512], [500, 1000], [100, 7.68], [600, 3350], [1, 1]];
    for (const [l, b] of cases) {
      const got = bif(l, b);
      t.check(`bytesInFlight(${l}, ${b})`, t.approx(got, l * b, 1e-9), `expected ${l * b}, got ${got}`);
    }
    const tcases = [[270, 512, 4, 34560], [500, 1000, 4, 125000], [100, 8, 64, 13], [300, 100, 128, 235], [10, 1, 3, 4]];
    for (const [l, b, per, want] of tcases) {
      const got = tn(l, b, per);
      t.check(`threadsNeeded(${l}, ${b}, ${per}) = ${want}`, got === want, `got ${got}`);
    }
    t.check("threadsNeeded returns an integer", Number.isInteger(tn(123, 45.6, 7)), "round to a whole number of threads, upward");
  },
});
