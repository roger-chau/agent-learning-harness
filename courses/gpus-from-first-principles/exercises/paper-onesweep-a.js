GW.exercise({
  id: "paper-onesweep-a",
  title: "Traffic models and a reference radix sort",
  file: "onesweep.js",
  prompt: `
<ol>
<li><code>keyMovements(n, keyBits, digitBits, design)</code>: total key reads + writes through DRAM for a whole sort. Use <code>"reduce-then-scan"</code> = 3n per pass, and <code>"onesweep"</code> = n for the upfront histogram plus 2n per pass. Passes = ⌈keyBits / digitBits⌉.</li>
<li><code>countingPass(keys, shift, digitBits)</code>: one <strong>stable</strong> counting-sort pass on the digit at <code>shift</code>, as plain JavaScript. Takes and returns an ordinary array.</li>
<li><code>lsdSort(keys, digitBits)</code>: sorts 32-bit unsigned keys with repeated <code>countingPass</code>. No built-in <code>sort</code> (it's disabled during the checks).</li>
</ol>`,
  starter: `
function keyMovements(n, keyBits, digitBits, design) {
  // TODO
}

function countingPass(keys, shift, digitBits) {
  // TODO: histogram, exclusive scan, stable placement
}

function lsdSort(keys, digitBits) {
  // TODO
}

function main() {
  print(keyMovements(1e6, 32, 8, "reduce-then-scan"), keyMovements(1e6, 32, 8, "onesweep"));
  print(lsdSort([170, 45, 75, 90, 802, 24, 2, 66], 4));
}
`,
  tests(t) {
    const km = t.fn("keyMovements"), cp = t.fn("countingPass"), ls = t.fn("lsdSort");
    t.check("reduce-then-scan, 32-bit keys, 8-bit digits = 12n", km(1000, 32, 8, "reduce-then-scan") === 12000, `got ${km(1000, 32, 8, "reduce-then-scan")}`);
    t.check("onesweep, 32-bit keys, 8-bit digits = 9n", km(1000, 32, 8, "onesweep") === 9000, `got ${km(1000, 32, 8, "onesweep")}`);
    t.check("onesweep, 32-bit keys, 4-bit digits = 17n", km(1000, 32, 4, "onesweep") === 17000, `got ${km(1000, 32, 4, "onesweep")}`);
    t.check("reduce-then-scan, 30-bit keys, 8-bit digits = 12n (4 passes)", km(1000, 30, 8, "reduce-then-scan") === 12000, `got ${km(1000, 30, 8, "reduce-then-scan")}`);
    // stability: sort pairs by low digit, check equal digits keep order
    const keys = [0x21, 0x11, 0x32, 0x12, 0x01, 0x22];
    const p = cp(keys, 0, 4);
    t.check("countingPass is stable", JSON.stringify(p) === JSON.stringify([0x21, 0x11, 0x01, 0x32, 0x12, 0x22]), `got ${JSON.stringify(p)}`);
    const orig = Array.prototype.sort;
    let seed = 5;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
    for (const [name, arr, bits] of [["random", Array.from({ length: 3000 }, () => rnd()), 8], ["random, 4-bit digits", Array.from({ length: 500 }, () => rnd()), 4], ["with 0xFFFFFFFF", [0xffffffff, 0, 0x80000000, 7, 0xffffffff], 8]]) {
      const want = orig.call(arr.slice(), (a, b) => a - b);
      let got;
      Array.prototype.sort = function () { throw new Error("sort is disabled"); };
      try { got = ls(arr.slice(), bits); } finally { Array.prototype.sort = orig; }
      t.check(`lsdSort ${name}`, Array.isArray(got) && got.length === want.length && want.every((v, i) => got[i] === v), "not sorted");
    }
  },
});
