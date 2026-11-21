GW.exercise({
  id: "paper-dissect-a",
  title: "Reading a pointer-chase curve",
  file: "pchase.js",
  prompt: `
<p>A pointer-chase sweep gives points <code>[sizeBytes, cyclesPerAccess]</code>, sorted by size (a made-up GPU, with noise).</p>
<ol>
<li><code>plateaus(points, tol)</code>: group consecutive points whose latency is within <code>tol</code> (relative) of the group's first point. Return <code>[{ latency, upTo }]</code>: the median latency of each group and the largest size in it.</li>
<li><code>capacities(points, tol)</code>: the cache capacities the curve reveals: the <code>upTo</code> of every plateau except the last.</li>
</ol>`,
  starter: `
function plateaus(points, tol) {
  // TODO
}
function capacities(points, tol) {
  // TODO
}

const CURVE = [[4096, 31], [8192, 30], [16384, 31], [32768, 32], [65536, 30], [131072, 205], [262144, 199],
  [524288, 201], [1048576, 203], [2097152, 198], [4194304, 640], [8388608, 655], [16777216, 648]];

function main() {
  print(JSON.stringify(plateaus(CURVE, 0.15)));
  print(JSON.stringify(capacities(CURVE, 0.15)));
}
`,
  tests(t) {
    const pl = t.fn("plateaus"), ca = t.fn("capacities");
    const C1 = [[4096, 31], [8192, 30], [16384, 31], [32768, 32], [65536, 30], [131072, 205], [262144, 199], [524288, 201], [1048576, 203], [2097152, 198], [4194304, 640], [8388608, 655], [16777216, 648]];
    const p = pl(C1, 0.15) || [];
    t.check("three plateaus", p.length === 3, `got ${JSON.stringify(p)}`);
    t.check("latencies 31, 201, 648", p.length === 3 && p[0].latency === 31 && p[1].latency === 201 && p[2].latency === 648, `got ${JSON.stringify(p.map((x) => x.latency))}`);
    t.check("capacities 64 KB and 2 MB", JSON.stringify(ca(C1, 0.15)) === "[65536,2097152]", `got ${JSON.stringify(ca(C1, 0.15))}`);
    const C2 = [[1024, 20], [2048, 22], [4096, 21], [8192, 90], [16384, 95], [32768, 92], [65536, 94], [131072, 400]];
    t.check("another GPU: capacities 4 KB and 64 KB", JSON.stringify(ca(C2, 0.15)) === "[4096,65536]", `got ${JSON.stringify(ca(C2, 0.15))}`);
    t.check("one plateau: no capacities", JSON.stringify(ca([[1024, 10], [2048, 11]], 0.15)) === "[]", `got ${JSON.stringify(ca([[1024, 10], [2048, 11]], 0.15))}`);
  },
});
