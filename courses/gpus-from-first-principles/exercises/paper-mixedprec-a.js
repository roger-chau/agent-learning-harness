GW.exercise({
  id: "paper-mixedprec-a",
  title: "FP16 training, broken and fixed",
  file: "mixed.js",
  prompt: `
<p><code>f16(x)</code> rounds to FP16; <code>Math.fround(x)</code> rounds to FP32.</p>
<ol>
<li><code>trainFP16(w, g, lr, steps)</code>: the weight is stored in FP16: each step <code>w = f16(w − f16(lr · g))</code>. Return the final w.</li>
<li><code>trainMaster(w, g, lr, steps)</code>: an FP32 master weight: each step <code>m = fround(m − fround(lr · g))</code>, starting from <code>m = w</code>. Return <code>f16(m)</code>, the FP16 copy the next forward pass would use.</li>
<li><code>underflowFraction(grads, scale)</code>: among the non-zero gradients, the fraction that become 0 when <code>f16(g · scale)</code> is stored.</li>
<li><code>bestScale(grads)</code>: the largest power of two <code>S = 2^k</code> (0 ≤ k ≤ 24) such that every <code>|g| · S</code> stays below 65,504 (no overflow).</li>
</ol>`,
  starter: `
function trainFP16(w, g, lr, steps) {
  // TODO
}
function trainMaster(w, g, lr, steps) {
  // TODO
}
function underflowFraction(grads, scale) {
  // TODO
}
function bestScale(grads) {
  // TODO
}

function main() {
  print("FP16 weight:", trainFP16(1, 1e-4, 0.01, 1000), " master:", trainMaster(1, 1e-4, 0.01, 1000));
  const grads = Array.from({ length: 1000 }, (_, i) => 1e-9 * Math.pow(1.02, i) * (i % 2 ? 1 : -1));
  print("underflow at scale 1:", underflowFraction(grads, 1), " best scale:", bestScale(grads), " underflow there:", underflowFraction(grads, bestScale(grads)));
}
`,
  tests(t) {
    const tf = t.fn("trainFP16"), tm = t.fn("trainMaster"), uf = t.fn("underflowFraction"), bs = t.fn("bestScale");
    const f16 = t.GPUSim.f16round;
    t.check("trainFP16(1, 1e-4, 0.01, 1000) never moves", tf(1, 1e-4, 0.01, 1000) === 1, `got ${tf(1, 1e-4, 0.01, 1000)}`);
    let m = 1; for (let i = 0; i < 1000; i++) m = Math.fround(m - Math.fround(0.01 * 1e-4));
    t.check("trainMaster(1, 1e-4, 0.01, 1000) accumulates the updates", tm(1, 1e-4, 0.01, 1000) === f16(m) && f16(m) < 1, `got ${tm(1, 1e-4, 0.01, 1000)}, expected ${f16(m)}`);
    let w = 0.5; for (let i = 0; i < 50; i++) w = f16(w - f16(0.1 * 0.03));
    t.check("trainFP16 with a large update matches the definition", tf(0.5, 0.03, 0.1, 50) === w, `got ${tf(0.5, 0.03, 0.1, 50)}, expected ${w}`);
    const grads = Array.from({ length: 1000 }, (_, i) => 1e-9 * Math.pow(1.02, i) * (i % 2 ? 1 : -1)).concat([0, 0]);
    const ufRef = (s) => { const nz = grads.filter((g) => g !== 0); return nz.filter((g) => f16(g * s) === 0).length / nz.length; };
    t.check("underflowFraction at scale 1", t.approx(uf(grads, 1), ufRef(1)), `got ${uf(grads, 1)}, expected ${ufRef(1)}`);
    t.check("underflowFraction at scale 1024", t.approx(uf(grads, 1024), ufRef(1024)), `got ${uf(grads, 1024)}, expected ${ufRef(1024)}`);
    const mx = Math.max(...grads.map(Math.abs)); let k = 0; while (k < 24 && mx * 2 ** (k + 1) < 65504) k++;
    t.check(`bestScale = 2^${k}`, bs(grads) === 2 ** k, `got ${bs(grads)}`);
    t.check("bestScale caps at 2^24", bs([1e-12, -3e-12]) === 2 ** 24, `got ${bs([1e-12, -3e-12])}`);
    t.check("scaling rescues most gradients here", ufRef(bs(grads)) < ufRef(1) / 2, `${ufRef(1)} → ${ufRef(bs(grads))}`);
  },
});
