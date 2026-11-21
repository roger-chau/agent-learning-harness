GW.exercise({
  id: "7-3-a",
  title: "Overlap copies and compute",
  file: "streams.js",
  prompt: `
<ol>
<li><code>pipeline(x, y, n, chunks, nStreams)</code>: process <code>n</code> floats in <code>chunks</code> equal chunks, each copied in (4 bytes per value), processed with <code>K.work</code>, and copied out, spreading chunks round-robin over <code>nStreams</code> streams. Call <code>gpu.resetStreams()</code> first and return <code>gpu.streamTime()</code>.</li>
<li><code>bestPipeline(x, y, n)</code>: your choice of chunks and streams. It must finish in ≤ 80% of the time of <code>pipeline(x, y, n, 1, 1)</code>, with correct results.</li>
<li><code>ringAllReduceUs(g, bytes, GBs, latencyUs)</code>: the chapter's ring all-reduce estimate, in µs.</li>
</ol>`,
  starter: `
const K = gpu.compile(\`
function work(x, y, off, n) {
  const i = off + blockIdx.x * blockDim.x + threadIdx.x;
  if (i < off + n) { let v = x[i]; for (let k = 0; k < 24; k++) v = fma(v, 0.999, 0.001); y[i] = v; }
}
\`);

function pipeline(x, y, n, chunks, nStreams) {
  gpu.resetStreams();
  // TODO: for each chunk: memcpy h2d, launch K.work on that chunk (offset and length), memcpy d2h
  return gpu.streamTime();
}
function bestPipeline(x, y, n) {
  return pipeline(x, y, n, 1, 1); // TODO
}
function ringAllReduceUs(g, bytes, GBs, latencyUs) {
  // TODO
}

function main() {
  const n = 1 << 16, x = gpu.from(Array.from({ length: n }, (_, i) => i % 10)), y = gpu.alloc(n);
  for (const [c, s] of [[1, 1], [4, 1], [4, 2], [8, 3]]) print(c, "chunks,", s, "streams:", pipeline(x, y, n, c, s).toFixed(2), "µs");
  for (const op of gpu.streamTrace().slice(0, 9)) print(JSON.stringify(op));
}
`,
  tests(t) {
    const pl = t.fn("pipeline"), bp = t.fn("bestPipeline"), ar = t.fn("ringAllReduceUs");
    const n = 1 << 16, x = t.gpu.from(Array.from({ length: n }, (_, i) => (i % 13) / 3)), y = t.gpu.alloc(n);
    const want = (v) => { for (let k = 0; k < 24; k++) v = v * 0.999 + 0.001; return v; };
    const serial = pl(x, y, n, 1, 1);
    t.check("pipeline(…, 1, 1) is the serial copy–compute–copy time", serial > 25 && serial < 26, `got ${serial} µs`);
    const tr = t.gpu.streamTrace();
    t.check("serial: one h2d, one kernel, one d2h", tr.length === 3 && tr[0].engine === "h2d" && tr[1].engine === "compute" && tr[2].engine === "d2h", JSON.stringify(tr));
    const four = pl(x, y, n, 4, 2), tr4 = t.gpu.streamTrace();
    t.check("pipeline(…, 4, 2): 4 chunks of copies and kernels", tr4.filter((o) => o.engine === "h2d").length === 4 && tr4.filter((o) => o.engine === "compute").length === 4, `${tr4.length} operations`);
    t.check("pipeline(…, 4, 2) overlaps (faster than serial)", four < serial, `${four} vs ${serial}`);
    y.data.fill(0);
    const best = bp(x, y, n);
    let ok = true; for (let i = 0; i < n; i++) if (Math.abs(y.data[i] - want(x.data[i])) > 1e-4) { ok = false; break; }
    t.check("bestPipeline: every element processed correctly", ok, "some chunk was skipped or processed at the wrong offset");
    t.check("bestPipeline: ≤ 80% of the serial time", best <= 0.8 * serial, `${best} µs vs serial ${serial} µs`);
    t.check("ringAllReduceUs(8, 1 GB, 100 GB/s, 5 µs) = 17,570", t.approx(ar(8, 1e9, 100, 5), 2 * 7 / 8 * 1e9 / 100e3 + 2 * 7 * 5), `got ${ar(8, 1e9, 100, 5)}`);
  },
});
