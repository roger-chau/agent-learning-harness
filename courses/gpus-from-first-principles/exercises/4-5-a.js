GW.exercise({
  id: "4-5-a",
  title: "Mixed precision by hand",
  file: "precision.js",
  prompt: `
<p><code>f16(x)</code> rounds a number to the nearest FP16 value; <code>Math.fround(x)</code> rounds to FP32.</p>
<ol>
<li><code>dotHalf(a, b)</code>: a dot product done entirely in FP16. Round both inputs, each product and each running sum to FP16.</li>
<li><code>dotMixed(a, b)</code>: tensor-core style. Round both inputs to FP16, then multiply and accumulate in FP32 (round each product and each sum with <code>Math.fround</code>).</li>
<li><code>errorBudget(n, maxA, maxB)</code>: the worst-case bound n · maxA · maxB · 2 · 2<sup>-11</sup>.</li>
<li><code>fragmentOwner(row, col)</code>: in the simulator's 16×16 accumulator layout, which lane holds C[row][col], and at which of its 8 slots: return <code>{ lane, slot }</code>.</li>
</ol>`,
  starter: `
function dotHalf(a, b) {
  // TODO
}
function dotMixed(a, b) {
  // TODO
}
function errorBudget(n, maxA, maxB) {
  // TODO
}
function fragmentOwner(row, col) {
  // TODO
}

function main() {
  const ones = new Array(4096).fill(1);
  print("FP16 accumulate:", dotHalf(ones, ones), " mixed:", dotMixed(ones, ones));
  print(errorBudget(256, 1, 1), JSON.stringify(fragmentOwner(5, 11)));
}
`,
  tests(t) {
    const h = t.fn("dotHalf"), m = t.fn("dotMixed"), eb = t.fn("errorBudget"), fo = t.fn("fragmentOwner");
    const f16 = t.GPUSim.f16round, ones = new Array(4096).fill(1);
    t.check("dotHalf of 4096 ones gets stuck at 2048", h(ones, ones) === 2048, `got ${h(ones, ones)}`);
    t.check("dotMixed of 4096 ones = 4096", m(ones, ones) === 4096, `got ${m(ones, ones)}`);
    const a = Array.from({ length: 300 }, (_, i) => Math.sin(i) * 3), b = Array.from({ length: 300 }, (_, i) => Math.cos(i * 1.7));
    let rh = 0, rm = 0;
    for (let i = 0; i < 300; i++) { rh = f16(rh + f16(f16(a[i]) * f16(b[i]))); rm = Math.fround(rm + Math.fround(f16(a[i]) * f16(b[i]))); }
    t.check("dotHalf matches the FP16 reference", h(a, b) === rh, `got ${h(a, b)}, expected ${rh}`);
    t.check("dotMixed matches the mixed reference", m(a, b) === rm, `got ${m(a, b)}, expected ${rm}`);
    t.check("errorBudget(256, 1, 1) = 0.25", t.approx(eb(256, 1, 1), 0.25), `got ${eb(256, 1, 1)}`);
    t.check("errorBudget(1024, 2, 0.5) = 1", t.approx(eb(1024, 2, 0.5), 1), `got ${eb(1024, 2, 0.5)}`);
    for (const [r, c, l, s] of [[0, 0, 0, 0], [0, 9, 1, 1], [5, 11, 11, 3], [15, 15, 31, 7]]) {
      const o = fo(r, c) || {};
      t.check(`fragmentOwner(${r}, ${c}) = lane ${l}, slot ${s}`, o.lane === l && o.slot === s, `got ${JSON.stringify(o)}`);
    }
  },
});
