GW.exercise({
  id: "6-5-a",
  title: "Unroll by hand, fuse by hand",
  file: "transforms.js",
  prompt: `
<ol>
<li><code>UNROLLED</code>: rewrite the GWX loop <code>LOOP</code> (each lane sums the squares of 64 values from shared memory) unrolled by 4 with separate accumulators. It must give the same results and run in <strong>≤ 800 cycles</strong> on one warp (the original takes about 2,400).</li>
<li><code>runFused(x, y, n, a, b)</code>: one kernel computing <code>y = max(a·x + b, 0)²</code>, which <code>runUnfused</code> does with three kernels and two temporary arrays. Return the array of launch stats. It must move at most 40% of the unfused version's DRAM bytes.</li>
</ol>`,
  starter: `
const LOOP = \`
.shared V 2048
  mov %i, 0
  mov %s, 0
  mov %a, %tid
loop:
  ld.shared %x, V[%a]
  fma %s, %x, %x, %s
  add %a, %a, 32
  add %i, %i, 1
  setp.lt %p, %i, 64
  @%p bra loop
  st.global OUT[%tid], %s
\`;

const UNROLLED = \`
// TODO
\`;
function getUnrolled() { return UNROLLED; }

const K = gpu.compile(\`
function scale(x, t, n, a, b) { const i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) t[i] = a * x[i] + b; }
function relu(t, u, n) { const i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) u[i] = Math.max(t[i], 0); }
function square(u, y, n) { const i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) y[i] = u[i] * u[i]; }
// your fused kernel here
\`);

function runUnfused(x, y, n, a, b) {
  const t = gpu.alloc(n), u = gpu.alloc(n), g = Math.ceil(n / 256);
  return [gpu.launch(K.scale, { grid: g, block: 256 }, x, t, n, a, b), gpu.launch(K.relu, { grid: g, block: 256 }, t, u, n), gpu.launch(K.square, { grid: g, block: 256 }, u, y, n)];
}
function runFused(x, y, n, a, b) {
  // TODO
  return runUnfused(x, y, n, a, b);
}

function main() {
  const V = Array.from({ length: 2048 }, (_, i) => (i % 5) - 2);
  for (const p of [LOOP, UNROLLED]) {
    try { const r = GWX.run(p, { shared: { V }, buffers: { OUT: new Array(32).fill(0) } }); print(r.cycles, "cycles", JSON.stringify(r.stalls)); }
    catch (e) { print(e.message); }
  }
  const n = 1 << 14, x = gpu.from(Array.from({ length: n }, (_, i) => Math.sin(i))), y = gpu.alloc(n);
  for (const f of [runUnfused, runFused]) { const st = f(x, y, n, 2, -0.5); print(f.name, st.length, "launches,", st.reduce((s, q) => s + q.dramBytes, 0), "DRAM bytes"); }
}
`,
  tests(t) {
    const V = Array.from({ length: 2048 }, (_, i) => ((i * 7) % 9) - 4);
    const ref = t.GWX.run(GWXLOOP(), { shared: { V }, buffers: { OUT: new Array(32).fill(0) } });
    function GWXLOOP() { return ".shared V 2048\nmov %i, 0\nmov %s, 0\nmov %a, %tid\nloop:\nld.shared %x, V[%a]\nfma %s, %x, %x, %s\nadd %a, %a, 32\nadd %i, %i, 1\nsetp.lt %p, %i, 64\n@%p bra loop\nst.global OUT[%tid], %s"; }
    const getU = t.fn("getUnrolled");
    let r;
    try { r = t.GWX.run(getU(), { shared: { V }, buffers: { OUT: new Array(32).fill(0) } }); } catch (e) { t.check("UNROLLED runs", false, e.message); }
    if (r) {
      t.check("UNROLLED: same results", Array.from(r.buffers.OUT).every((v, i) => v === ref.buffers.OUT[i]), `got ${Array.from(r.buffers.OUT).slice(0, 4)}, expected ${Array.from(ref.buffers.OUT).slice(0, 4)}`);
      t.check(`UNROLLED: ≤ 800 cycles (original ${ref.cycles})`, r.cycles <= 800, `got ${r.cycles}`);
    }
    const n = 1 << 14, x = t.gpu.from(Array.from({ length: n }, (_, i) => Math.cos(i * 0.3))), y1 = t.gpu.alloc(n), y2 = t.gpu.from(new Array(n).fill(9));
    const un = t.fn("runUnfused")(x, y1, n, 1.5, -0.25), fu = t.fn("runFused")(x, y2, n, 1.5, -0.25);
    let e = 0; for (let i = 0; i < n; i++) e = Math.max(e, Math.abs(y2.data[i] - Math.max(1.5 * x.data[i] - 0.25, 0) ** 2));
    t.check("runFused: correct", e < 1e-5, `max error ${e}`);
    const bytes = (st) => (Array.isArray(st) ? st.reduce((s, q) => s + (q.dramBytes || 0), 0) : Infinity);
    t.check("runFused: ≤ 40% of the unfused DRAM bytes", Array.isArray(fu) && fu.length > 0 && bytes(fu) <= 0.4 * bytes(un), `fused ${bytes(fu)} vs unfused ${bytes(un)}`);
  },
});
