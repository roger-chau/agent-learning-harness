GW.exercise({
  id: "6-2-a",
  title: "Profile an inner loop from its listing",
  file: "loop_profile.js",
  prompt: `
<p>Write <code>loopProfile(text)</code> for a GWX program with one loop: a label, and a later branch back to it (the last backward branch). The loop body runs from the label's instruction to that branch, inclusive. Return per iteration:</p>
<ul>
<li><code>body</code>: instructions in the body;</li>
<li><code>fma</code>, <code>loads</code> (any <code>ld</code>, a vector load counts as 1), <code>stores</code>;</li>
<li><code>overhead</code>: everything else (index math, compares, branches);</li>
<li><code>fmaShare</code>: <code>fma / body</code>.</li>
</ul>
<p><code>GWX.assemble(text)</code> gives <code>{ instrs, labels }</code>; each instruction has <code>op</code> (<code>"fma"</code>, <code>"ld"</code>, <code>"st"</code>, <code>"bra"</code>, ...) and branches have a <code>target</code>.</p>`,
  starter: `
function loopProfile(text) {
  const { instrs, labels } = GWX.assemble(text);
  // TODO
}

const SRC = \`
  mov %i, 0
loop:
  ld.global %x, X[%i]
  fma %acc, %x, %x, %acc
  add %i, %i, 1
  setp.lt %p, %i, $n
  @%p bra loop
  st.global OUT[%tid], %acc
\`;

function main() {
  print(JSON.stringify(loopProfile(SRC)));
}
`,
  tests(t) {
    const lp = t.fn("loopProfile");
    const acc = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) acc.push(`%c${i}${j}`);
    const fmas = (a, b) => acc.map((c, k) => `fma ${c}, %${a}${k >> 2}, %${b}${k & 3}, ${c}`).join("\n");
    const L1 = `mov %i, 0\nloop:\nld.global %x, X[%i]\nfma %acc, %x, %x, %acc\nadd %i, %i, 1\nsetp.lt %p, %i, 8\n@%p bra loop\nst.global OUT[%tid], %acc`;
    const L2 = `.shared As 512\n.shared Bs 1024\nmov %k, 0\nloop:\nshl %ka, %k, 4\nadd %ia, %ka, %r4\n${[0, 1, 2, 3].map((i) => `ld.shared %a${i}, As[%ia + ${i}]`).join("\n")}\nshl %kb, %k, 5\nadd %ib, %kb, %c4\n${[0, 1, 2, 3].map((i) => `ld.shared %b${i}, Bs[%ib + ${i}]`).join("\n")}\n${fmas("a", "b")}\nadd %k, %k, 1\nsetp.lt %p, %k, 32\n@%p bra loop\nst.global C[%o], %c00`;
    const L3 = `.shared As 512\n.shared Bs 1024\nmov %k, 0\nst.global C[0], %k\nloop:\nld.shared.v4 {%x0, %x1, %x2, %x3}, As[%pa + 16]\nld.shared.v4 {%y0, %y1, %y2, %y3}, Bs[%pb + 32]\n${fmas("a", "b")}\nadd %pa, %pa, 32\nadd %pb, %pb, 64\nadd %k, %k, 2\nsetp.lt %p, %k, 32\n@!%p bra tail\nld.shared.v4 {%a0, %a1, %a2, %a3}, As[%pa]\nld.shared.v4 {%b0, %b1, %b2, %b3}, Bs[%pb]\n${fmas("x", "y")}\nbra loop\ntail:\nst.global C[%o], %c00`;
    const cases = [[L1, { body: 5, fma: 1, loads: 1, stores: 0, overhead: 3 }], [L2, { body: 31, fma: 16, loads: 8, stores: 0, overhead: 7 }], [L3, { body: 42, fma: 32, loads: 4, stores: 0, overhead: 6 }]];
    cases.forEach(([src, want], k) => {
      const r = lp(src) || {};
      for (const key of Object.keys(want)) t.check(`loop ${k + 1}: ${key} = ${want[key]}`, r[key] === want[key], `got ${r[key]}`);
      t.check(`loop ${k + 1}: fmaShare`, t.approx(r.fmaShare, want.fma / want.body), `got ${r.fmaShare}`);
    });
  },
});
