GW.exercise({
  id: "6-3-a",
  title: "Liveness and linear-scan allocation",
  file: "regalloc.js",
  prompt: `
<p>Straight-line GWX code (no branches), where each register is written exactly once. Special registers (<code>%tid</code>, <code>%lane</code>, <code>%warp</code>, <code>%nwarps</code>) don't need allocating.</p>
<ol>
<li><code>intervals(text)</code>: <code>{ name: [d, u] }</code> for each register: <code>d</code> = index of its defining instruction, <code>u</code> = index of its last use, or <code>d + 1</code> if it's never used.</li>
<li><code>maxLive(text)</code>: the largest number of registers <code>r</code> with <code>d ≤ i &lt; u</code> at any instruction index <code>i</code>.</li>
<li><code>allocate(text, k)</code>: rename registers to <code>%r0</code> … <code>%r{k−1}</code> by linear scan (an interval's register is free again from its <code>u</code>), returning the new program text, or <code>null</code> if <code>k</code> registers aren't enough.</li>
<li><code>warpsFor(regs, registerFile)</code>: warps that fit: min(64, ⌊registerFile / (32 · regs)⌋).</li>
</ol>
<p>Instructions from <code>GWX.assemble(text).instrs</code> have <code>dst</code> and <code>src</code> lists of operands (<code>{ k: "reg", name }</code>, including address registers) and <code>line</code>, the 1-based source line, if you want to rewrite lines.</p>`,
  starter: `
const SPECIAL = new Set(["%tid", "%lane", "%warp", "%nwarps"]);

function intervals(text) {
  const { instrs } = GWX.assemble(text);
  // TODO
}
function maxLive(text) {
  // TODO
}
function allocate(text, k) {
  // TODO
}
function warpsFor(regs, registerFile) {
  // TODO
}

const SRC = \`
ld.global %a, X[%tid]
ld.global %b, Y[%tid]
add %c, %a, %b
mul %d, %c, %c
st.global OUT[%tid], %d
\`;

function main() {
  print(JSON.stringify(intervals(SRC)), maxLive(SRC));
  print(allocate(SRC, 2));
}
`,
  tests(t) {
    const iv = t.fn("intervals"), ml = t.fn("maxLive"), al = t.fn("allocate"), wf = t.fn("warpsFor");
    const S1 = `ld.global %a, X[%tid]\nld.global %b, Y[%tid]\nadd %c, %a, %b\nmul %d, %c, %c\nst.global OUT[%tid], %d`;
    t.check("intervals of the chapter's example", JSON.stringify(iv(S1)) === JSON.stringify({ "%a": [0, 2], "%b": [1, 2], "%c": [2, 3], "%d": [3, 4] }), `got ${JSON.stringify(iv(S1))}`);
    // a wider program: 8 loads, a pairwise tree, plus an address register
    const S2 = ["shl %o, %tid, 3", ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `ld.global %x${i}, X[%o + ${i}]`),
      "add %s0, %x0, %x1", "add %s1, %x2, %x3", "add %s2, %x4, %x5", "add %s3, %x6, %x7", "mul %u, %s0, %s1", "mul %v, %s2, %s3", "sub %w, %u, %v", "st.global OUT[%tid], %w"].join("\n");
    const S3 = ["ld.global %a, X[%tid]", "mul %b, %a, %a", "mul %c, %b, %a", "mul %d, %c, %b", "add %e, %d, %a", "max %f, %e, %c", "st.global OUT[%tid], %f", "mov %dead, 5"].join("\n");
    for (const [name, S, want] of [["chapter example", S1, 2], ["8-load tree", S2, 8], ["chain", S3, 3]]) {
      const m = ml(S);
      t.check(`${name}: maxLive = ${want}`, m === want, `got ${m}`);
      const X = Array.from({ length: 512 }, (_, i) => ((i * 7) % 11) - 4), Y = Array.from({ length: 512 }, (_, i) => (i % 5) / 2);
      const run = (p) => t.GWX.run(p, { buffers: { X, Y, OUT: new Array(32).fill(0) } });
      const ref = run(S);
      const out = al(S, want);
      if (typeof out !== "string") { t.check(`${name}: allocate(maxLive) returns a program`, false, `got ${out}`); continue; }
      let r; try { r = run(out); } catch (e) { t.check(`${name}: allocated program runs`, false, e.message); continue; }
      t.check(`${name}: allocated program computes the same results`, Array.from(r.buffers.OUT).every((v, i) => v === ref.buffers.OUT[i]), "results differ");
      t.check(`${name}: uses ${want} registers`, r.registers === want, `uses ${r.registers}: ${t.GWX.assemble(out).registers.join(" ")}`);
      t.check(`${name}: allocate(${want - 1}) is null`, al(S, want - 1) === null, "should not fit");
    }
    t.check("warpsFor(32, 65536) = 64", wf(32, 65536) === 64, `got ${wf(32, 65536)}`);
    t.check("warpsFor(96, 65536) = 21", wf(96, 65536) === 21, `got ${wf(96, 65536)}`);
    t.check("warpsFor(255, 65536) = 8", wf(255, 65536) === 8, `got ${wf(255, 65536)}`);
  },
});
