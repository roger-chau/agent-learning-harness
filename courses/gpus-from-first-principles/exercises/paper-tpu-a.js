GW.exercise({
  id: "paper-tpu-a",
  title: "The TPU's roofline",
  file: "tpu_roofline.js",
  prompt: `
<p>Work in the paper's units: operations per second (1 MAC = 2 ops) and operational intensity in <strong>MACs per weight byte</strong>.</p>
<ol>
<li><code>peakTops(dim, ghz)</code>: peak tera-ops/s of a dim × dim MAC array at <code>ghz</code>.</li>
<li><code>ridgePoint(dim, ghz, gbs)</code>: the intensity (MACs per weight byte) where memory time equals compute time, for <code>gbs</code> GB/s of weight bandwidth.</li>
<li><code>attainableTops(intensity, dim, ghz, gbs)</code>: the roofline: min(peak, 2 · intensity · bandwidth), in tera-ops/s.</li>
<li><code>minBatch(dim, ghz, gbs, bytesPerWeight)</code>: the smallest whole batch size at which a fully connected layer reaches the ridge, when each weight takes <code>bytesPerWeight</code> bytes (intensity = batch / bytesPerWeight).</li>
</ol>`,
  starter: `
function peakTops(dim, ghz) {
  // TODO
}
function ridgePoint(dim, ghz, gbs) {
  // TODO
}
function attainableTops(intensity, dim, ghz, gbs) {
  // TODO
}
function minBatch(dim, ghz, gbs, bytesPerWeight) {
  // TODO
}

function main() {
  print("TPU peak", peakTops(256, 0.7), "TOPS, ridge", ridgePoint(256, 0.7, 34));
  for (const b of [1, 16, 200, 2000]) print("batch", b, attainableTops(b, 256, 0.7, 34), "TOPS");
  print("batch to reach the ridge:", minBatch(256, 0.7, 34, 1), " with GDDR5 (180 GB/s):", minBatch(256, 0.7, 180, 1));
}
`,
  tests(t) {
    const pk = t.fn("peakTops"), rp = t.fn("ridgePoint"), at = t.fn("attainableTops"), mb = t.fn("minBatch");
    t.check("peakTops(256, 0.7) ≈ 91.75", Math.abs(pk(256, 0.7) - 91.75) < 0.01, `got ${pk(256, 0.7)}`);
    t.check("ridgePoint(256, 0.7, 34) ≈ 1349", Math.abs(rp(256, 0.7, 34) - 1349.27) < 0.5, `got ${rp(256, 0.7, 34)}`);
    t.check("attainable at intensity 100 ≈ 6.8 TOPS", Math.abs(at(100, 256, 0.7, 34) - 6.8) < 0.01, `got ${at(100, 256, 0.7, 34)}`);
    t.check("attainable at intensity 5000 = peak", Math.abs(at(5000, 256, 0.7, 34) - 91.75) < 0.01, `got ${at(5000, 256, 0.7, 34)}`);
    t.check("minBatch(256, 0.7, 34, 1) = 1350", mb(256, 0.7, 34, 1) === 1350, `got ${mb(256, 0.7, 34, 1)}`);
    t.check("minBatch with 2-byte weights = 2699", mb(256, 0.7, 34, 2) === 2699, `got ${mb(256, 0.7, 34, 2)}`);
    t.check("minBatch(256, 0.7, 180, 1) = 255", mb(256, 0.7, 180, 1) === 255, `got ${mb(256, 0.7, 180, 1)}`);
  },
});
