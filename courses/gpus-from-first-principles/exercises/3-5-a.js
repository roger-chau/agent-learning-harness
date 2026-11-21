GW.exercise({
  id: "3-5-a",
  title: "Stable stream compaction on the GPU",
  file: "compact.js",
  prompt: `
<p>Write <code>compact(x, n, threshold)</code>, which keeps every element of <code>x</code> that is <strong>greater than</strong> <code>threshold</code>, <strong>in its original order</strong>, and returns <code>{ out, count, stats }</code>. Here <code>out</code> is a device buffer whose first <code>count</code> entries are the kept elements, and <code>stats</code> is the stats of every launch.</p>
<p>The GPU must do the work: per-block counts, a scan of the counts, then a scatter that uses block-local scans. The host may read back a single number (the total count) and allocate buffers, but must not loop over the elements. <code>Array.prototype.filter</code> and <code>sort</code> are disabled while the checks run.</p>`,
  starter: `
function compact(x, n, threshold) {
  // TODO: launches for counts → scan → scatter; return { out, count, stats: [...] }
}

function main() {
  const n = 10000;
  const x = gpu.from(Array.from({ length: n }, (_, i) => ((i * 37) % 101) - 50));
  const r = compact(x, n, 0);
  print("kept", r.count, "first few", r.out.toArray().slice(0, 6));
  r.stats.forEach((s) => table(s));
}
`,
  tests(t) {
    const run = t.fn("compact");
    const origFilter = Array.prototype.filter, origSort = Array.prototype.sort;
    for (const [n, thr] of [[10000, 0], [65536, 40], [77, 100], [1, -1000]]) {
      const xs = Array.from({ length: n }, (_, i) => ((i * 37 + (i >> 4)) % 101) - 50);
      const want = origFilter.call(xs, (v) => v > thr);
      let r;
      Array.prototype.filter = function () { throw new Error("Array.prototype.filter is disabled: compact on the GPU"); };
      Array.prototype.sort = function () { throw new Error("Array.prototype.sort is disabled"); };
      try { r = run(t.gpu.from(xs), n, thr); }
      finally { Array.prototype.filter = origFilter; Array.prototype.sort = origSort; }
      const ok = r && r.out && typeof r.count === "number" && Array.isArray(r.stats);
      t.check(`n = ${n}, > ${thr}: returns { out, count, stats }`, ok, "return { out, count, stats: [...] }");
      if (!ok) continue;
      let bad = r.count === want.length ? -1 : -2;
      if (bad === -1) for (let k = 0; k < want.length; k++) if (r.out.data[k] !== want[k]) { bad = k; break; }
      t.check(`n = ${n}, > ${thr}: kept the right elements in order`, bad === -1, bad === -2 ? `count ${r.count}, expected ${want.length}` : `out[${bad}] = ${r.out.data[bad]}, expected ${want[bad]}`);
    }
  },
});
