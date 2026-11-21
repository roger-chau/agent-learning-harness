GW.exercise({
  id: "6-4-a",
  title: "A list scheduler",
  file: "scheduler.js",
  prompt: `
<p>Write <code>schedule(text)</code> for straight-line GWX code (no branches). Return the same instructions (keep any <code>.shared</code> lines first) in a new order that respects all dependences: true (wait the producer's latency: 4 for ALU/FMA, 24 for <code>ld.shared</code>, 400 for <code>ld.global</code>), anti, output, and memory (keep a store in order with every other access to the same buffer).</p>
<p>The tests run your schedule on one warp: it must compute exactly the same results, and reach the cycle targets, which a critical-path list scheduler meets.</p>`,
  starter: `
const SPECIAL = new Set(["%tid", "%lane", "%warp", "%nwarps"]);

function schedule(text) {
  const { instrs } = GWX.assemble(text);   // each has op, space (for ld/st), dst, src, mem ({ buf }), line
  const lines = text.split("\\n");
  // TODO: dependence graph, priorities, list scheduling
  return text;
}

const T1 = "mov %s, 0\\nld.global %x0, X[%tid + 0]\\nadd %s, %s, %x0\\nld.global %x1, X[%tid + 32]\\nadd %s, %s, %x1\\nld.global %x2, X[%tid + 64]\\nadd %s, %s, %x2\\nld.global %x3, X[%tid + 96]\\nadd %s, %s, %x3\\nld.global %x4, X[%tid + 128]\\nadd %s, %s, %x4\\nld.global %x5, X[%tid + 160]\\nadd %s, %s, %x5\\nst.global OUT[%tid], %s";

function main() {
  const bufs = () => ({ X: Array.from({ length: 1024 }, (_, i) => i % 9), OUT: new Array(1024).fill(0) });
  const a = GWX.run(T1, { buffers: bufs() }), s = schedule(T1), b = GWX.run(s, { buffers: bufs() });
  print(s);
  print("cycles", a.cycles, "->", b.cycles);
}
`,
  tests(t) {
    const schedule = t.fn("schedule");
    const CASES = [["global loads and a chain", "mov %s, 0\nld.global %x0, X[%tid + 0]\nadd %s, %s, %x0\nld.global %x1, X[%tid + 32]\nadd %s, %s, %x1\nld.global %x2, X[%tid + 64]\nadd %s, %s, %x2\nld.global %x3, X[%tid + 96]\nadd %s, %s, %x3\nld.global %x4, X[%tid + 128]\nadd %s, %s, %x4\nld.global %x5, X[%tid + 160]\nadd %s, %s, %x5\nst.global OUT[%tid], %s", 450], ["a register-tiled step", ".shared As 512\n.shared Bs 512\nmov %c00, 0\nmov %c01, 0\nmov %c02, 0\nmov %c03, 0\nmov %c10, 0\nmov %c11, 0\nmov %c12, 0\nmov %c13, 0\nmov %c20, 0\nmov %c21, 0\nmov %c22, 0\nmov %c23, 0\nmov %c30, 0\nmov %c31, 0\nmov %c32, 0\nmov %c33, 0\nld.shared %a0, As[%lane + 0]\nld.shared %b0, Bs[%lane + 8]\nld.shared %a1, As[%lane + 16]\nld.shared %b1, Bs[%lane + 24]\nld.shared %a2, As[%lane + 32]\nld.shared %b2, Bs[%lane + 40]\nld.shared %a3, As[%lane + 48]\nld.shared %b3, Bs[%lane + 56]\nfma %c00, %a0, %b0, %c00\nfma %c01, %a0, %b1, %c01\nfma %c02, %a0, %b2, %c02\nfma %c03, %a0, %b3, %c03\nfma %c10, %a1, %b0, %c10\nfma %c11, %a1, %b1, %c11\nfma %c12, %a1, %b2, %c12\nfma %c13, %a1, %b3, %c13\nfma %c20, %a2, %b0, %c20\nfma %c21, %a2, %b1, %c21\nfma %c22, %a2, %b2, %c22\nfma %c23, %a2, %b3, %c23\nfma %c30, %a3, %b0, %c30\nfma %c31, %a3, %b1, %c31\nfma %c32, %a3, %b2, %c32\nfma %c33, %a3, %b3, %c33\nld.shared %a0, As[%lane + 64]\nld.shared %b0, Bs[%lane + 72]\nld.shared %a1, As[%lane + 80]\nld.shared %b1, Bs[%lane + 88]\nld.shared %a2, As[%lane + 96]\nld.shared %b2, Bs[%lane + 104]\nld.shared %a3, As[%lane + 112]\nld.shared %b3, Bs[%lane + 120]\nfma %c00, %a0, %b0, %c00\nfma %c01, %a0, %b1, %c01\nfma %c02, %a0, %b2, %c02\nfma %c03, %a0, %b3, %c03\nfma %c10, %a1, %b0, %c10\nfma %c11, %a1, %b1, %c11\nfma %c12, %a1, %b2, %c12\nfma %c13, %a1, %b3, %c13\nfma %c20, %a2, %b0, %c20\nfma %c21, %a2, %b1, %c21\nfma %c22, %a2, %b2, %c22\nfma %c23, %a2, %b3, %c23\nfma %c30, %a3, %b0, %c30\nfma %c31, %a3, %b1, %c31\nfma %c32, %a3, %b2, %c32\nfma %c33, %a3, %b3, %c33\nld.shared %a0, As[%lane + 128]\nld.shared %b0, Bs[%lane + 136]\nld.shared %a1, As[%lane + 144]\nld.shared %b1, Bs[%lane + 152]\nld.shared %a2, As[%lane + 160]\nld.shared %b2, Bs[%lane + 168]\nld.shared %a3, As[%lane + 176]\nld.shared %b3, Bs[%lane + 184]\nfma %c00, %a0, %b0, %c00\nfma %c01, %a0, %b1, %c01\nfma %c02, %a0, %b2, %c02\nfma %c03, %a0, %b3, %c03\nfma %c10, %a1, %b0, %c10\nfma %c11, %a1, %b1, %c11\nfma %c12, %a1, %b2, %c12\nfma %c13, %a1, %b3, %c13\nfma %c20, %a2, %b0, %c20\nfma %c21, %a2, %b1, %c21\nfma %c22, %a2, %b2, %c22\nfma %c23, %a2, %b3, %c23\nfma %c30, %a3, %b0, %c30\nfma %c31, %a3, %b1, %c31\nfma %c32, %a3, %b2, %c32\nfma %c33, %a3, %b3, %c33\nst.global OUT[%tid + 0], %c00\nst.global OUT[%tid + 32], %c01\nst.global OUT[%tid + 64], %c02\nst.global OUT[%tid + 96], %c03\nst.global OUT[%tid + 128], %c10\nst.global OUT[%tid + 160], %c11\nst.global OUT[%tid + 192], %c12\nst.global OUT[%tid + 224], %c13\nst.global OUT[%tid + 256], %c20\nst.global OUT[%tid + 288], %c21\nst.global OUT[%tid + 320], %c22\nst.global OUT[%tid + 352], %c23\nst.global OUT[%tid + 384], %c30\nst.global OUT[%tid + 416], %c31\nst.global OUT[%tid + 448], %c32\nst.global OUT[%tid + 480], %c33", 146], ["stores and loads to the same buffer", "shl %o, %tid, 2\nld.global %p, X[%o]\nmul %q, %p, %p\nst.global Y[%o], %q\nld.global %r, Y[%o + 1]\nadd %s, %r, %q\nst.global OUT[%tid], %s\nld.global %u, X[%o + 2]\nmax %v, %u, %s\nst.global OUT[%tid + 32], %v", 860]];
    const bufs = () => ({ X: Array.from({ length: 1024 }, (_, i) => (i % 9) - 3), Y: Array.from({ length: 1024 }, (_, i) => i % 4), OUT: new Array(1024).fill(0) });
    const sh = { As: Array.from({ length: 512 }, (_, i) => i % 7), Bs: Array.from({ length: 512 }, (_, i) => (i % 3) - 1) };
    for (const [name, T, target] of CASES) {
      const a = t.GWX.run(T, { buffers: bufs(), shared: sh });
      const s = schedule(T);
      let b;
      try { b = t.GWX.run(s, { buffers: bufs(), shared: sh }); } catch (e) { t.check(name + ": runs", false, e.message); continue; }
      const same = ["OUT", "Y"].every((k) => Array.from(a.buffers[k]).every((v, i) => v === b.buffers[k][i]));
      const sameSet = t.GWX.assemble(s).instrs.map((x) => x.text).sort().join("|") === t.GWX.assemble(T).instrs.map((x) => x.text).sort().join("|");
      t.check(name + ": same instructions, same results", same && sameSet, same ? "instructions were added, dropped or changed" : "results differ: a dependence was broken");
      t.check(name + ": ≤ " + target + " cycles (was " + a.cycles + ")", b.cycles <= target, "got " + b.cycles);
    }
  },
});
