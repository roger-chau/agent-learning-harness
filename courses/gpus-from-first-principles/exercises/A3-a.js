GW.exercise({
  id: "A3-a",
  title: "Transpose three ways, and a tiled blur",
  file: "bandwidth.js",
  prompt: `<p>Implement the kernels and launchers described above.</p>`,
  starter: `
function transposeNaive(a, b, n) {
  // TODO
}

function transposeTiled(a, b, n) {
  // TODO: 32x32 shared tile, no padding
}

function transposePadded(a, b, n) {
  // TODO: 32x33 shared tile
}

function runTranspose(kind, a, b, n) {
  // TODO: "naive" | "tiled" | "padded"
}

function blurHTiled(src, dst, w, h) {
  // TODO: row segment + 2-pixel halo in shared memory
}

function runBlurH(src, dst, w, h) {
  // TODO
}

function main() {
  const n = 512;
  const a = gpu.from(Array.from({ length: n * n }, (_, i) => i % 1000));
  for (const kind of ["naive", "tiled", "padded"]) {
    const b = gpu.alloc(n * n);
    const s = runTranspose(kind, a, b, n);
    print(kind, "→", s.percentOfPeakBandwidth + "% of peak,", "limited by", s.limitedBy);
  }
  const d = gpu.alloc(n * n);
  table(runBlurH(a, d, n, n));
}
`,
  tests(t) {
    const rt = t.fn("runTranspose"), rb = t.fn("runBlurH");
    for (const n of [96, 512]) {
      const a = t.gpu.from(Array.from({ length: n * n }, (_, i) => (i * 7) % 1013));
      for (const kind of ["naive", "tiled", "padded"]) {
        const b = t.gpu.alloc(n * n);
        const s = rt(kind, a, b, n);
        let bad = -1;
        for (let y = 0; y < n && bad < 0; y++) for (let x = 0; x < n; x++) if (b.data[x * n + y] !== a.data[y * n + x]) { bad = y * n + x; break; }
        t.check(`${n}×${n} ${kind}: correct`, bad < 0 && !!s, !s ? "return the stats" : `element (${bad % n}, ${Math.floor(bad / n)}) wrong`);
        if (!s || n !== 512) continue;
        if (kind !== "naive") {
          t.check(`512 ${kind}: coalesced (≥99%) and uses shared memory`, s.coalescing >= 0.99 && s.sharedLoads > 0, `coalescing ${(s.coalescing * 100).toFixed(1)}%, ${s.sharedLoads} shared loads`);
        }
        if (kind === "tiled") t.check("512 tiled: has bank conflicts (unpadded, for comparison)", s.bankConflicts > 0, "the unpadded tile should conflict on the column read");
        if (kind === "padded") {
          t.check("512 padded: zero bank conflicts", s.bankConflicts === 0, `${s.bankConflicts} conflicts`);
          t.check("512 padded: ≥ 80% of peak bandwidth", s.percentOfPeakBandwidth >= 80, `${s.percentOfPeakBandwidth}%, limited by ${s.limitedBy}`);
        }
      }
    }
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    for (const [w, h] of [[512, 512], [203, 157]]) {
      const src = t.gpu.from(Array.from({ length: w * h }, (_, i) => (i * 13) % 97)), dst = t.gpu.alloc(w * h);
      const s = rb(src, dst, w, h);
      let bad = -1;
      const K = [1, 4, 6, 4, 1];
      for (let y = 0; y < h && bad < 0; y++) for (let x = 0; x < w; x++) {
        let v = 0; for (let k = -2; k <= 2; k++) v += K[k + 2] * src.data[y * w + clamp(x + k, 0, w - 1)];
        if (Math.abs(dst.data[y * w + x] - v / 16) > 1e-3) { bad = y * w + x; break; }
      }
      t.check(`${w}×${h} blurHTiled: correct`, bad < 0 && !!s, !s ? "return the stats" : `pixel (${bad % w}, ${Math.floor(bad / w)})`);
      if (s && w === 512) {
        t.check("512 blurHTiled: ≥ 95% coalescing", s.coalescing >= 0.95, `${(s.coalescing * 100).toFixed(1)}%`);
        t.check("512 blurHTiled: uses shared memory, zero bank conflicts", s.sharedLoads > 0 && s.bankConflicts === 0, `${s.sharedLoads} shared loads, ${s.bankConflicts} conflicts`);
        t.check("512 blurHTiled: ≥ 80% of peak bandwidth", s.percentOfPeakBandwidth >= 80, `${s.percentOfPeakBandwidth}%, limited by ${s.limitedBy}`);
      }
    }
  },
});
