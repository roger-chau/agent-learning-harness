GW.exercise({
  id: "2-2-a",
  title: "Count sectors like the hardware",
  file: "sectors.js",
  prompt: `
<p>Implement the memory system's arithmetic, and it'll be checked against the simulator itself.</p>
<ol>
<li><code>sectorsTouched(addresses, size)</code>: <code>addresses</code> holds the byte address each lane accesses (up to 32 lanes); each access is <code>size</code> bytes. Return how many distinct 32-byte sectors are touched. An access can straddle two sectors.</li>
<li><code>efficiency(addresses, size)</code>: bytes requested ÷ (32 × sectors).</li>
<li><code>stridedAddresses(offset, stride, size)</code>: the 32 byte addresses of a warp where lane <code>l</code> reads element <code>offset + l·stride</code> of an array of <code>size</code>-byte elements.</li>
</ol>
<p>The checks generate random access patterns, run them through a probe kernel on the simulator, and compare its transaction count with yours.</p>`,
  starter: `
function sectorsTouched(addresses, size) {
  // TODO
}

function efficiency(addresses, size) {
  // TODO
}

function stridedAddresses(offset, stride, size) {
  // TODO
}

function main() {
  for (const [o, s] of [[0, 1], [1, 1], [0, 2], [0, 8], [3, 33]]) {
    const a = stridedAddresses(o, s, 4);
    print(\`offset \${o} stride \${s}: \${sectorsTouched(a, 4)} sectors, \${(efficiency(a, 4) * 100).toFixed(1)}%\`);
  }
}
`,
  tests(t) {
    const st = t.fn("sectorsTouched"), ef = t.fn("efficiency"), sa = t.fn("stridedAddresses");
    const { probe } = t.gpu.compile(`function probe(buf, idx) { const l = threadIdx.x; buf[idx[l]]; }`);
    const simSectors = (elemIdx, type) => {
      const buf = t.gpu.alloc(1 << 16, type), idx = t.gpu.from(elemIdx, "i32");
      const s = t.gpu.launch(probe, { grid: 1, block: elemIdx.length }, buf, idx);
      return s.transactions - Math.ceil((elemIdx.length * 4) / 32 + (0)) ; // minus the idx read (contiguous i32)
    };
    for (const [o, s, n] of [[0, 1, 4], [1, 1, 5], [0, 2, 8], [0, 8, 32], [0, 0, 1], [7, 3, 0]]) {
      const a = sa(o, s, 4);
      const ok = Array.isArray(a) && a.length === 32 && a.every((v, l) => v === (o + l * s) * 4);
      t.check(`stridedAddresses(${o}, ${s}, 4)`, ok, "lane l → (offset + l·stride) · size");
      if (n) t.check(`offset ${o}, stride ${s}: ${n} sectors`, st(a || [], 4) === n, `got ${st(a || [], 4)}`);
    }
    let seed = 11;
    const rnd = (m) => (seed = (seed * 1103515245 + 12345) % 2147483648) % m;
    const types = [["f32", 4], ["f64", 8], ["u8", 1], ["u16", 2]];
    for (let trial = 0; trial < 12; trial++) {
      const [type, size] = types[trial % 4];
      const lanes = 32;
      const elems = Array.from({ length: lanes }, () => (trial % 3 === 0 ? rnd(64) : trial % 3 === 1 ? rnd(4000) : 17 + rnd(40)));
      const want = simSectors(elems, type);
      const got = st(elems.map((e) => e * size), size);
      t.check(`random pattern ${trial + 1} (${type}): matches the simulator (${want} sectors)`, got === want, `got ${got}`);
      const eff = ef(elems.map((e) => e * size), size);
      t.check(`random pattern ${trial + 1}: efficiency`, t.approx(eff, (lanes * size) / (32 * want), 1e-9), `got ${eff}`);
    }
  },
});
