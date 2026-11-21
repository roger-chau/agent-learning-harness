GW.exercise({
  id: "C5-a",
  title: "Beat the compiler",
  file: "microkernel.js",
  prompt: `<p>Write <code>FAST</code>: GWX with the same results as <code>BASELINE</code>, ≤ 48 registers, in ≤ 1,900 cycles on 2 warps.</p>`,
  starter: `
const BASELINE = \`
.shared As 512   // As[k*16 + row]: 32 k-steps x 16 rows (A transposed)
.shared Bs 1024  // Bs[k*32 + col]: 32 k-steps x 32 cols
  and %c, %lane, 7
  shr %r, %lane, 3
  shl %c4, %c, 2
  shl %r4, %r, 2
  mov %c00, 0
  mov %c01, 0
  mov %c02, 0
  mov %c03, 0
  mov %c10, 0
  mov %c11, 0
  mov %c12, 0
  mov %c13, 0
  mov %c20, 0
  mov %c21, 0
  mov %c22, 0
  mov %c23, 0
  mov %c30, 0
  mov %c31, 0
  mov %c32, 0
  mov %c33, 0
  mov %k, 0
loop:
  shl %ka, %k, 4
  add %ia, %ka, %r4
  ld.shared %a0, As[%ia + 0]
  ld.shared %a1, As[%ia + 1]
  ld.shared %a2, As[%ia + 2]
  ld.shared %a3, As[%ia + 3]
  shl %kb, %k, 5
  add %ib, %kb, %c4
  ld.shared %b0, Bs[%ib + 0]
  ld.shared %b1, Bs[%ib + 1]
  ld.shared %b2, Bs[%ib + 2]
  ld.shared %b3, Bs[%ib + 3]
  fma %c00, %a0, %b0, %c00
  fma %c01, %a0, %b1, %c01
  fma %c02, %a0, %b2, %c02
  fma %c03, %a0, %b3, %c03
  fma %c10, %a1, %b0, %c10
  fma %c11, %a1, %b1, %c11
  fma %c12, %a1, %b2, %c12
  fma %c13, %a1, %b3, %c13
  fma %c20, %a2, %b0, %c20
  fma %c21, %a2, %b1, %c21
  fma %c22, %a2, %b2, %c22
  fma %c23, %a2, %b3, %c23
  fma %c30, %a3, %b0, %c30
  fma %c31, %a3, %b1, %c31
  fma %c32, %a3, %b2, %c32
  fma %c33, %a3, %b3, %c33
  add %k, %k, 1
  setp.lt %p, %k, 32
  @%p bra loop
  // C is (4 warps x 16 rows) x 32 cols, row-major
  shl %w16, %warp, 4
  add %row, %w16, %r4
  shl %o, %row, 5
  add %o, %o, %c4
  st.global C[%o + 0], %c00
  st.global C[%o + 1], %c01
  st.global C[%o + 2], %c02
  st.global C[%o + 3], %c03
  st.global C[%o + 32], %c10
  st.global C[%o + 33], %c11
  st.global C[%o + 34], %c12
  st.global C[%o + 35], %c13
  st.global C[%o + 64], %c20
  st.global C[%o + 65], %c21
  st.global C[%o + 66], %c22
  st.global C[%o + 67], %c23
  st.global C[%o + 96], %c30
  st.global C[%o + 97], %c31
  st.global C[%o + 98], %c32
  st.global C[%o + 99], %c33
\`;

const FAST = BASELINE; // TODO: your hand-optimised version

function getBaseline() { return BASELINE; }
function getFast() { return FAST; }

const As = Array.from({ length: 512 }, (_, i) => ((i * 7) % 11) / 8), Bs = Array.from({ length: 1024 }, (_, i) => ((i * 5) % 13) / 8 - 0.5);
function runIt(src) {
  return GWX.run(src, { warps: 2, registerFile: 2 * 32 * 48, shared: { As, Bs }, buffers: { C: new Array(32 * 32).fill(0) } });
}

function main() {
  for (const [name, src] of [["baseline", BASELINE], ["fast", FAST]]) {
    const r = runIt(src);
    print(name, r.cycles, "cycles,", r.instructions, "instructions,", r.registers, "registers, stalls", JSON.stringify(r.stalls), JSON.stringify(r.byClass));
  }
}
`,
  tests(t) {
    const As = Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.7)), Bs = Array.from({ length: 1024 }, (_, i) => Math.cos(i * 0.3));
    const run = (src) => t.GWX.run(src, { warps: 2, registerFile: 2 * 32 * 48, shared: { As, Bs }, buffers: { C: new Array(32 * 32).fill(0) } });
    const base = run(t.fn("getBaseline")());
    let r;
    try { r = run(t.fn("getFast")()); } catch (e) { t.check("FAST runs within the register budget", false, e.message); return; }
    t.check("FAST: same results as the baseline", Array.from(r.buffers.C).every((v, i) => Math.abs(v - base.buffers.C[i]) <= 1e-12 * Math.max(1, Math.abs(v))), "results differ");
    t.check(`FAST: ≤ 1,900 cycles (baseline ${base.cycles})`, r.cycles <= 1900, `${r.cycles} cycles, ${r.instructions} instructions, ${r.registers} registers${r.cycles <= 1550 ? " (stretch met)" : ""}`);
  },
});
