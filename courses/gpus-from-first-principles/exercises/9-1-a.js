GW.exercise({
  id: "9-1-a",
  title: "Reproducible and accurate sums",
  file: "numerics.js",
  prompt: `
<ol>
<li><code>sumF32(xs)</code>: a plain running sum, rounding after every add with <code>Math.fround</code>.</li>
<li><code>kahanF32(xs)</code>: Kahan's compensated sum, with every operation rounded to FP32.</li>
<li><code>ulpDistance(a, b)</code>: how many FP32 values lie between <code>Math.fround(a)</code> and <code>Math.fround(b)</code> (0 if equal). Hint: the bit patterns of non-negative floats are ordered like integers; use a <code>Float32Array</code> and an <code>Int32Array</code> on the same buffer.</li>
<li><code>sumDeterministic(x, n, launchOpts)</code>: the sum of a float buffer on the GPU, returning <code>{ value, stats }</code>, where <code>value</code> is identical to the bit whatever the block order. Spread <code>launchOpts</code> into every launch config (the tests use it to shuffle the block order). <code>sumAtomic</code> in the starter isn't reproducible.</li>
</ol>`,
  starter: `
function sumF32(xs) {
  // TODO
}
function kahanF32(xs) {
  // TODO
}
function ulpDistance(a, b) {
  // TODO
}

const K = gpu.compile(\`
function atomicSum(x, out, n) {
  const i = blockIdx.x * blockDim.x + threadIdx.x;
  let v = i < n ? x[i] : 0;
  for (let o = 16; o > 0; o >>= 1) v += __shfl_down_sync(0xffffffff, v, o);
  if ((threadIdx.x & 31) === 0) atomicAdd(out, 0, v);
}
// your deterministic kernel(s) here
\`);
function sumAtomic(x, n, launchOpts) {
  const out = gpu.from([0]);
  const s = gpu.launch(K.atomicSum, { grid: Math.ceil(n / 256), block: 256, ...launchOpts }, x, out, n);
  return { value: out.data[0], stats: [s] };
}
function sumDeterministic(x, n, launchOpts) {
  // TODO
}

function main() {
  const xs = Array.from({ length: 100000 }, (_, i) => (i % 2 ? 1e-3 : 1) * (1 + (i % 7) / 10));
  print("f32:", sumF32(xs), " kahan:", kahanF32(xs), " exact:", xs.reduce((a, b) => a + b, 0));
  const n = 1 << 14, x = gpu.from(Array.from({ length: n }, (_, i) => Math.sin(i) * 1000 + 1e-3 * i));
  for (const seed of [1, 2, 3]) print("seed", seed, "atomic:", sumAtomic(x, n, { blockOrder: "shuffle", seed }).value);
}
`,
  tests(t) {
    const sf = t.fn("sumF32"), kh = t.fn("kahanF32"), ud = t.fn("ulpDistance"), sd = t.fn("sumDeterministic"), sa = t.fn("sumAtomic");
    const xs = Array.from({ length: 100000 }, (_, i) => (i % 2 ? 1e-3 : 1) * (1 + (i % 7) / 10));
    let naive = 0; for (const x of xs) naive = Math.fround(naive + x);
    const exact = xs.reduce((a, b) => a + b, 0);
    t.check("sumF32 matches a rounded running sum", sf(xs) === naive, `got ${sf(xs)}, expected ${naive}`);
    const k = kh(xs);
    t.check("kahanF32 is much closer to the exact sum than sumF32", Math.abs(k - exact) < Math.abs(naive - exact) / 50, `kahan error ${Math.abs(k - exact)}, plain error ${Math.abs(naive - exact)}`);
    t.check("kahanF32 result is an FP32 value", Math.fround(k) === k, `got ${k}`);
    t.check("ulpDistance(1, 1) = 0", ud(1, 1) === 0, `got ${ud(1, 1)}`);
    t.check("ulpDistance(1, 1 + 2^-23) = 1", ud(1, 1 + 2 ** -23) === 1, `got ${ud(1, 1 + 2 ** -23)}`);
    t.check("ulpDistance(1, 1 + 2^-21) = 4", ud(1, 1 + 2 ** -21) === 4, `got ${ud(1, 1 + 2 ** -21)}`);
    t.check("ulpDistance(2, 1) = 2^23", ud(2, 1) === 2 ** 23, `got ${ud(2, 1)}`);
    const n = 1 << 14, x = t.gpu.from(Array.from({ length: n }, (_, i) => Math.sin(i * 1.7) * 1000 + 1e-3 * i));
    const ex = Array.from(x.data).reduce((a, b) => a + b, 0);
    const atomics = new Set([1, 2, 3, 4].map((seed) => sa(x, n, { blockOrder: "shuffle", seed }).value));
    t.check("(the atomic version really does vary with block order)", atomics.size > 1, `${atomics.size} distinct results`);
    const vals = [1, 2, 3, 4].map((seed) => { const r = sd(x, n, { blockOrder: "shuffle", seed }) || {}; return r.value; });
    t.check("sumDeterministic: identical bits for every block order", vals.every((v) => Object.is(v, vals[0])), `got ${vals.join(", ")}`);
    t.check("sumDeterministic: accurate (relative error ≤ 1e-6)", typeof vals[0] === "number" && Math.abs(vals[0] - ex) <= 1e-6 * Math.abs(ex), `got ${vals[0]}, exact ${ex}`);
  },
});
