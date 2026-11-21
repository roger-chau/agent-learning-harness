GW.exercise({
  id: "B4-a",
  title: "Radix sort from your own primitives",
  file: "radix_sort.js",
  prompt: `<p>Implement <code>radixSort(keys, n)</code> → <code>{ sorted, stats: [every launch] }</code> for <code>u32</code> keys.</p>`,
  starter: `
function radixSort(keys, n) {
  // TODO: per digit: histogram → scan → stable scatter; ping-pong buffers
}

function main() {
  const n = 4096;
  let seed = 1;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
  const keys = gpu.from(Array.from({ length: n }, () => rnd()), "u32");
  const r = radixSort(keys, n);
  print(r.sorted.toArray().slice(0, 5), "…", r.stats.length, "launches");
}
`,
  tests(t) {
    const run = t.fn("radixSort");
    let seed = 77;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
    const n = 16384;
    const sets = [
      ["random", Array.from({ length: n }, () => rnd())],
      ["all equal", Array(n).fill(123456789)],
      ["already sorted", Array.from({ length: n }, (_, i) => i * 3)],
      ["reverse sorted", Array.from({ length: n }, (_, i) => (n - i) * 7)],
      ["few distinct", Array.from({ length: n }, () => [5, 0xffffffff, 77, 0x80000000][rnd() % 4])],
      ["near 0xFFFFFFFF", Array.from({ length: 1000 }, () => 0xffffffff - (rnd() % 5000))],
      ["one key", [42]],
    ];
    const origA = Array.prototype.sort, origT = Object.getPrototypeOf(Uint32Array.prototype).sort;
    for (const [name, arr] of sets) {
      const want = origA.call(arr.slice(), (a, b) => a - b);
      let r;
      Array.prototype.sort = function () { throw new Error("Array.prototype.sort is disabled: sort on the GPU"); };
      Object.getPrototypeOf(Uint32Array.prototype).sort = function () { throw new Error("TypedArray sort is disabled: sort on the GPU"); };
      try { r = run(t.gpu.from(arr, "u32"), arr.length); }
      finally { Array.prototype.sort = origA; Object.getPrototypeOf(Uint32Array.prototype).sort = origT; }
      const ok = r && r.sorted && r.sorted.data && Array.isArray(r.stats) && r.stats.length >= 1;
      t.check(`${name}: returns { sorted, stats }`, ok, "return { sorted, stats: [...] }");
      if (!ok) continue;
      const bad = want.findIndex((v, i) => r.sorted.data[i] !== v);
      t.check(`${name} (n = ${arr.length}): sorted correctly`, bad < 0, `position ${bad}: got ${r.sorted.data[bad]}, expected ${want[bad]}`);
    }
  },
});
