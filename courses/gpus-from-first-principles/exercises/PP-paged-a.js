GW.exercise({
  id: "PP-paged-a",
  title: "A paged KV cache",
  file: "paged.js",
  prompt: `<p>Implement the cache functions and <code>runGather</code> described above.</p>`,
  starter: `
function createCache(numBlocks, blockSize) {
  // TODO: physical pool, free list, reference counts, per-sequence block tables and lengths
}
function addSeq(c, id) {}
function append(c, id, value) {}
function fork(c, src, dst) {}
function read(c, id) {}
function freeSeq(c, id) {}
function usedBlocks(c) {}

const K = gpu.compile(\`
function gather(pool, table, out, nTokens, blockSize) {
  // TODO
}
\`);
function runGather(pool, table, out, nTokens, blockSize) {
  return gpu.launch(K.gather, { grid: Math.ceil(nTokens / 256), block: 256 }, pool, table, out, nTokens, blockSize);
}

function main() {
  const c = createCache(8, 4);
  addSeq(c, "a"); for (let v = 1; v <= 6; v++) append(c, "a", v);
  fork(c, "a", "b"); append(c, "b", 99);
  print(read(c, "a"), read(c, "b"), usedBlocks(c));
}
`,
  tests(t) {
    const cc = t.fn("createCache"), add = t.fn("addSeq"), ap = t.fn("append"), fk = t.fn("fork"), rd = t.fn("read"), fr = t.fn("freeSeq"), ub = t.fn("usedBlocks"), rg = t.fn("runGather");
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    const c = cc(10, 4);
    add(c, "a"); for (let v = 1; v <= 10; v++) ap(c, "a", v);
    t.check("append 10 tokens with block 4: 3 blocks, read back in order", same(rd(c, "a"), range(1, 10)) && ub(c) === 3, `read ${JSON.stringify(rd(c, "a"))}, used ${ub(c)}`);
    fk(c, "a", "b");
    t.check("fork shares every block (still 3 used)", ub(c) === 3 && same(rd(c, "b"), range(1, 10)), `used ${ub(c)}`);
    ap(c, "b", 11);
    t.check("append to the fork copies the shared, partly full block", ub(c) === 4 && same(rd(c, "a"), range(1, 10)) && same(rd(c, "b"), range(1, 11)), `used ${ub(c)}, a ${JSON.stringify(rd(c, "a"))}, b ${JSON.stringify(rd(c, "b"))}`);
    ap(c, "a", 12);
    t.check("a's last block is no longer shared: append in place", ub(c) === 4 && same(rd(c, "a"), [...range(1, 10), 12]), `used ${ub(c)}, a ${JSON.stringify(rd(c, "a"))}`);
    fr(c, "a");
    t.check("freeing a keeps the blocks b still shares", ub(c) === 3 && same(rd(c, "b"), range(1, 11)), `used ${ub(c)}`);
    fr(c, "b");
    t.check("freeing b returns everything", ub(c) === 0, `used ${ub(c)}`);
    const d = cc(3, 4);
    add(d, "x"); for (let v = 1; v <= 8; v++) ap(d, "x", v);
    fk(d, "x", "y");
    t.check("fork of a full last block: append allocates a fresh block", ap(d, "y", 9) === true && ub(d) === 3 && same(rd(d, "x"), range(1, 8)) && same(rd(d, "y"), range(1, 9)), `used ${ub(d)}`);
    t.check("out of blocks: append returns false and changes nothing", ap(d, "x", 9) === false && same(rd(d, "x"), range(1, 8)) && ub(d) === 3, `x ${JSON.stringify(rd(d, "x"))}, used ${ub(d)}`);
    fr(d, "y");
    t.check("after freeing y, x can grow into its block", ap(d, "x", 9) === true && same(rd(d, "x"), range(1, 9)) && ub(d) === 3, `x ${JSON.stringify(rd(d, "x"))}, used ${ub(d)}`);
    // the GPU gather
    const B = 16, nTok = 1000, nBlk = Math.ceil(nTok / B), phys = 128;
    const order = Array.from({ length: phys }, (_, i) => (i * 37) % phys).slice(0, nBlk);
    const pool = t.gpu.from(Array.from({ length: phys * B }, (_, i) => i * 0.5)), table = t.gpu.from(order, "u32"), out = t.gpu.alloc(nTok);
    const s = rg(pool, table, out, nTok, B);
    let ok = true; for (let i = 0; i < nTok; i++) if (out.data[i] !== pool.data[order[Math.floor(i / B)] * B + (i % B)]) { ok = false; break; }
    t.check("runGather: tokens in logical order", ok, "wrong values");
    t.check("runGather: coalescing ≥ 0.9", s && s.coalescing >= 0.9, s ? `coalescing ${s.coalescing}` : "return the stats");
  },
});
