GW.exercise({
  id: "6-1-a",
  title: "Code generation with instruction selection",
  file: "codegen.js",
  prompt: `
<p>Write <code>codegen(expr)</code>, which returns GWX text computing an expression into <code>%out</code>. An expression is a number, a variable name (a string: the value is already in register <code>%</code>+name), or <code>{ op, a, b }</code> with <code>op</code> one of <code>"+"</code>, <code>"-"</code>, <code>"*"</code>, <code>"min"</code>, <code>"max"</code>.</p>
<ul>
<li>Use a fresh temporary register for each intermediate value.</li>
<li><strong>Select <code>fma</code></strong> for <code>a * b + c</code> and <code>c + a * b</code>: one instruction instead of two.</li>
<li>Emit exactly one instruction per remaining operation, writing the last one straight into <code>%out</code>. A bare number or variable needs one <code>mov</code>.</li>
</ul>`,
  starter: `
let tmp = 0;
function fresh() { return "%t" + tmp++; }

function codegen(expr) {
  const lines = [];
  // TODO: return the register holding e's value, emitting instructions into lines
  function gen(e) {
  }
  const r = gen(expr);
  // TODO: make sure the result ends up in %out
  return lines.join("\\n");
}

function main() {
  const e = { op: "+", a: { op: "*", a: "x", b: "y" }, b: 3 };
  const body = codegen(e);
  print(body);
  const prog = "ld.global %x, X[%tid]\\nld.global %y, Y[%tid]\\n" + body + "\\nst.global OUT[%tid], %out";
  const r = GWX.run(prog, { buffers: { X: Array.from({ length: 32 }, (_, i) => i), Y: new Array(32).fill(2), OUT: new Array(32).fill(0) } });
  print(Array.from(r.buffers.OUT).slice(0, 8), r.cycles, "cycles", r.instructions, "instructions");
}
`,
  tests(t) {
    const cg = t.fn("codegen");
    const ev = (e, env) => typeof e === "number" ? e : typeof e === "string" ? env[e] : (({ "+": (a, b) => a + b, "-": (a, b) => a - b, "*": (a, b) => a * b, min: Math.min, max: Math.max })[e.op])(ev(e.a, env), ev(e.b, env));
    const count = (e) => {
      if (typeof e !== "object") return 0;
      if (e.op === "+") {
        if (typeof e.a === "object" && e.a.op === "*") return 1 + count(e.a.a) + count(e.a.b) + count(e.b);
        if (typeof e.b === "object" && e.b.op === "*") return 1 + count(e.b.a) + count(e.b.b) + count(e.a);
      }
      return 1 + count(e.a) + count(e.b);
    };
    const cases = [
      { op: "+", a: { op: "*", a: "x", b: "y" }, b: 3 },
      { op: "+", a: "z", b: { op: "*", a: "x", b: 2 } },
      { op: "-", a: { op: "max", a: "x", b: "y" }, b: { op: "min", a: "y", b: "z" } },
      { op: "+", a: { op: "*", a: { op: "+", a: { op: "*", a: "x", b: "x" }, b: "y" }, b: "z" }, b: { op: "*", a: "y", b: "y" } },
      "x",
      7,
    ];
    const X = Array.from({ length: 32 }, (_, i) => i - 9), Y = Array.from({ length: 32 }, (_, i) => (i % 5) * 1.5), Z = Array.from({ length: 32 }, (_, i) => 3 - i / 4);
    cases.forEach((e, k) => {
      const body = cg(JSON.parse(JSON.stringify(e)));
      const prog = `ld.global %x, X[%tid]\nld.global %y, Y[%tid]\nld.global %z, Z[%tid]\n${body}\nst.global OUT[%tid], %out`;
      let r;
      try { r = t.GWX.run(prog, { buffers: { X, Y, Z, OUT: new Array(32).fill(NaN) } }); } catch (err) { t.check(`case ${k + 1}: runs`, false, err.message); return; }
      const ok = X.every((_, l) => Math.abs(r.buffers.OUT[l] - ev(e, { x: X[l], y: Y[l], z: Z[l] })) < 1e-9);
      t.check(`case ${k + 1}: correct`, ok, `got ${Array.from(r.buffers.OUT).slice(0, 4)}`);
      const want = Math.max(1, count(e)), got = r.instructions - 4;
      t.check(`case ${k + 1}: ${want} instruction${want > 1 ? "s" : ""} (fma selected where possible)`, got === want, `emitted ${got}`);
    });
  },
});
