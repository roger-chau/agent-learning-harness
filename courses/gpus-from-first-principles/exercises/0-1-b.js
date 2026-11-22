GW.exercise({
  id: "0-1-b",
  title: "The operating point under load",
  file: "operating_point.js",
  prompt: `
<p>Worked Example 4 solved Little's law with a latency that rises with load, in closed form for one latency model. Real latency curves come from measurements, so write it for <em>any</em> model.</p>
<ol>
<li><code>achieved(L, W, P)</code>: bandwidth (GB/s) with <code>L</code> bytes in flight, a <em>fixed</em> latency <code>W</code> ns and peak <code>P</code> GB/s.</li>
<li><code>operatingPoint(L, latencyAt, P)</code>: the bandwidth λ in [0, P) satisfying λ = L / latencyAt(λ), where <code>latencyAt(λ)</code> returns the loaded latency in ns at bandwidth λ and is non-decreasing. Accurate to 10⁻⁶ GB/s. (Hint: g(λ) = λ − L / latencyAt(λ) is increasing, so bisection works.)</li>
<li><code>bytesForTarget(target, latencyAt)</code>: the bytes in flight needed to reach <code>target</code> GB/s under that latency model.</li>
</ol>`,
  starter: `
function achieved(L, W, P) {
  // TODO
}
function operatingPoint(L, latencyAt, P) {
  // TODO: bisection on g(λ) = λ - L / latencyAt(λ)
}
function bytesForTarget(target, latencyAt) {
  // TODO
}

function main() {
  const queue = (lam) => 270 / (1 - lam / 512);
  print("fixed latency:", achieved(64000, 270, 512));
  print("loaded:", operatingPoint(64000, queue, 512), "(Example 4 says ~162)");
  print("bytes for 450 GB/s:", bytesForTarget(450, queue));
}
`,
  tests(t) {
    const ac = t.fn("achieved"), op = t.fn("operatingPoint"), bt = t.fn("bytesForTarget");
    t.check("achieved(64000, 270, 512) = 237.04", t.approx(ac(64000, 270, 512), 64000 / 270), `got ${ac(64000, 270, 512)}`);
    t.check("achieved caps at the peak", ac(1e6, 270, 512) === 512, `got ${ac(1e6, 270, 512)}`);
    const queue = (P, W0) => (lam) => W0 / (1 - lam / P);
    for (const [L, W0, P] of [[64000, 270, 512], [100000, 270, 512], [2e6, 600, 3350], [500, 400, 100]]) {
      const want = (L / W0) / (1 + L / (W0 * P)), got = op(L, queue(P, W0), P);
      t.check(`queueing model L=${L}, W0=${W0}, P=${P}: λ = ${want.toFixed(4)}`, typeof got === "number" && Math.abs(got - want) < 1e-6, `got ${got}`);
    }
    // a measured-looking curve: flat, then a knee
    const knee = (lam) => 300 + 2000 * Math.max(0, lam - 300) ** 2 / 1e4;
    const g = op(150000, knee, 512);
    t.check("a non-closed-form curve: λ = L / latencyAt(λ) holds", typeof g === "number" && Math.abs(g - 150000 / knee(g)) < 1e-5 && g < 512, `got ${g}, L/latencyAt(λ) = ${150000 / knee(g)}`);
    const q = queue(512, 270);
    t.check("bytesForTarget(450, queueing) = 450 · latencyAt(450)", t.approx(bt(450, q), 450 * q(450)), `got ${bt(450, q)}`);
    t.check("round trip: operatingPoint(bytesForTarget(x)) = x", Math.abs(op(bt(300, q), q, 512) - 300) < 1e-5, `got ${op(bt(300, q), q, 512)}`);
  },
});
