GW.exercise({
  id: "scenario-6-a",
  title: "Occupancy or ILP",
  file: "norm.js",
  prompt: `<p>Set <code>NORM</code> (GWX) and <code>WARPS</code>: same results as the compiler's version, ≤ 12,000 cycles for 128 rows on a 16,384-register SM.</p>`,
  starter: `
// The compiler's output.
const COMPILED = \`
  mov %row, %warp
loop:
  mul %base, %row, 256
  add %base, %base, %lane
  ld.global %x0, X[%base]
  mov %s, %x0
  ld.global %x1, X[%base + 32]
  add %s, %s, %x1
  ld.global %x2, X[%base + 64]
  add %s, %s, %x2
  ld.global %x3, X[%base + 96]
  add %s, %s, %x3
  ld.global %x4, X[%base + 128]
  add %s, %s, %x4
  ld.global %x5, X[%base + 160]
  add %s, %s, %x5
  ld.global %x6, X[%base + 192]
  add %s, %s, %x6
  ld.global %x7, X[%base + 224]
  add %s, %s, %x7
  mul %m, %s, 0.125
  sub %d0, %x0, %m
  sub %d1, %x1, %m
  sub %d2, %x2, %m
  sub %d3, %x3, %m
  sub %d4, %x4, %m
  sub %d5, %x5, %m
  sub %d6, %x6, %m
  sub %d7, %x7, %m
  mul %v, %d0, %d0
  fma %v, %d1, %d1, %v
  fma %v, %d2, %d2, %v
  fma %v, %d3, %d3, %v
  fma %v, %d4, %d4, %v
  fma %v, %d5, %d5, %v
  fma %v, %d6, %d6, %v
  fma %v, %d7, %d7, %v
  mul %v, %v, 0.125
  add %v, %v, 0.00001
  rsqrt %r, %v
  mul %y0, %d0, %r
  mul %y1, %d1, %r
  mul %y2, %d2, %r
  mul %y3, %d3, %r
  mul %y4, %d4, %r
  mul %y5, %d5, %r
  mul %y6, %d6, %r
  mul %y7, %d7, %r
  st.global Y[%base + 0], %y0
  st.global Y[%base + 32], %y1
  st.global Y[%base + 64], %y2
  st.global Y[%base + 96], %y3
  st.global Y[%base + 128], %y4
  st.global Y[%base + 160], %y5
  st.global Y[%base + 192], %y6
  st.global Y[%base + 224], %y7
  add %row, %row, %nwarps
  setp.lt %p, %row, $rows
  @%p bra loop
\`;

const NORM = COMPILED;   // TODO: your version
const WARPS = 17;        // TODO: as many as fit, or fewer if that's faster

function getNorm() { return NORM; }
function getWarps() { return WARPS; }

function runNorm(src, warps, rows) {
  const X = Array.from({ length: rows * 256 }, (_, i) => Math.sin(i * 0.37) * 3 + (i % 7));
  return GWX.run(src, { warps, registerFile: 16384, params: { rows }, buffers: { X, Y: new Array(rows * 256).fill(0) } });
}

function main() {
  const regs = GWX.assemble(COMPILED).registers.length;
  print("compiled:", regs, "registers ->", Math.floor(16384 / (32 * regs)), "warps fit");
  for (const w of [1, 4, 17]) { const r = runNorm(COMPILED, w, 128); print("  warps", w, r.cycles, "cycles", JSON.stringify(r.stalls)); }
  const r = runNorm(NORM, WARPS, 128);
  print("yours:", GWX.assemble(NORM).registers.length, "registers,", WARPS, "warps,", r.cycles, "cycles", JSON.stringify(r.stalls));
}
`,
  tests(t) {
    const src = t.fn("getNorm")(), warps = t.fn("getWarps")();
    const ref = (X, rows) => {
      const Y = new Float64Array(rows * 256);
      for (let r = 0; r < rows; r++) for (let l = 0; l < 32; l++) {
        const xs = [0, 1, 2, 3, 4, 5, 6, 7].map((j) => X[r * 256 + 32 * j + l]);
        const m = xs.reduce((a, b) => a + b, 0) / 8, v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / 8, k = 1 / Math.sqrt(v + 1e-5);
        xs.forEach((x, j) => (Y[r * 256 + 32 * j + l] = (x - m) * k));
      }
      return Y;
    };
    for (const rows of [96, 128]) {
      const X = Array.from({ length: rows * 256 }, (_, i) => Math.cos(i * 0.21) * 2 + (i % 5));
      let r;
      try { r = t.GWX.run(src, { warps, registerFile: 16384, params: { rows }, buffers: { X, Y: new Array(rows * 256).fill(0) } }); }
      catch (e) { t.check(`rows = ${rows}: runs`, false, e.message); continue; }
      const want = ref(X, rows);
      let e = 0; for (let i = 0; i < want.length; i++) e = Math.max(e, Math.abs(r.buffers.Y[i] - want[i]));
      t.check(`rows = ${rows}: correct`, e < 1e-9, `max error ${e}`);
      if (rows === 128) t.check("rows = 128: ≤ 12,000 cycles", r.cycles <= 12000, `${r.cycles} cycles with ${r.registers} registers × ${warps} warps${r.cycles <= 8500 ? " (stretch met)" : ""}`);
    }
  },
});
