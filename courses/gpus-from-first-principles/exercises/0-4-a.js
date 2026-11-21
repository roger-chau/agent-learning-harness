GW.exercise({
  id: "0-4-a",
  title: "Your first kernel: SAXPY",
  file: "saxpy.js",
  prompt: `
<p>SAXPY ("single-precision a·x plus y") is the "hello world" of GPU computing: <code>out[i] = a * x[i] + y[i]</code>.</p>
<ol>
<li>Write the kernel <code>saxpy(a, x, y, out, n)</code>, with one element per thread.</li>
<li>Write <code>launchSaxpy(a, x, y, out, n)</code>. It chooses a block size and grid size, launches the kernel with <code>gpu.launch(...)</code>, and <strong>returns the stats</strong> that <code>launch</code> gives back.</li>
</ol>
<p>The checks run several sizes, including <code>n = 1</code> and sizes that aren't a multiple of your block size. The buffers are exactly <code>n</code> long, so any out-of-bounds access fails. They also check that memory access is fully coalesced and that you don't launch wildly more threads than needed.</p>`,
  starter: `
function saxpy(a, x, y, out, n) {
  // TODO: compute this thread's global index and do one element
}

function launchSaxpy(a, x, y, out, n) {
  // TODO: choose block and grid sizes, then:
  // return gpu.launch(saxpy, { grid, block }, a, x, y, out, n);
}

function main() {
  const n = 1000;
  const x = gpu.from(Array.from({ length: n }, (_, i) => i));
  const y = gpu.from(Array.from({ length: n }, () => 1));
  const out = gpu.alloc(n);
  const stats = launchSaxpy(2, x, y, out, n);
  print(out.toArray().slice(0, 5)); // [1, 3, 5, 7, 9]
  table(stats);
}
`,
  tests(t) {
    const launch = t.fn("launchSaxpy");
    t.fn("saxpy");
    const f = Math.fround;
    for (const n of [1, 31, 1000, 4096, 10007]) {
      const xs = Array.from({ length: n }, (_, i) => (i % 97) * 0.5 - 7);
      const ys = Array.from({ length: n }, (_, i) => (i % 13) - 3.25);
      const x = t.gpu.from(xs), y = t.gpu.from(ys), out = t.gpu.alloc(n);
      const a = 2.5;
      const stats = launch(a, x, y, out, n);
      let bad = -1;
      for (let i = 0; i < n; i++) {
        const want = f(f(a * f(xs[i])) + f(ys[i]));
        if (Math.abs(out.data[i] - want) > 1e-4 * Math.max(1, Math.abs(want))) { bad = i; break; }
      }
      t.check(`n = ${n}: every element correct`, bad < 0, bad >= 0 ? `out[${bad}] = ${out.data[bad]}` : "");
      t.check(`n = ${n}: y is unchanged`, y.data.every((v, i) => v === f(ys[i])), "the kernel should only write to out");
      const ok = stats && typeof stats.transactions === "number";
      t.check(`n = ${n}: launchSaxpy returns the launch stats`, ok, "return the value of gpu.launch(...)");
      if (!ok) continue;
      t.check(`n = ${n}: enough threads, not wildly more`, stats.threads >= n && stats.threads < n + 1024, `launched ${stats.threads} threads`);
      // Best possible: every sector touched is one the array actually occupies.
      const ideal = (n * 4) / (Math.ceil((n * 4) / 32) * 32);
      t.check(`n = ${n}: fully coalesced`, stats.coalescing >= ideal - 1e-6,
        `coalescing ${(stats.coalescing * 100).toFixed(1)}%, best possible ${(ideal * 100).toFixed(1)}%`);
    }
  },
});
