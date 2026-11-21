GW.exercise({
  id: "paper-flash-a",
  title: "IO-aware arithmetic",
  file: "flash_io.js",
  prompt: `
<ol>
<li><code>blockSizes(M, d)</code>: Algorithm 1's <code>{ Bc: ⌈M / 4d⌉, Br: min(⌈M / 4d⌉, d) }</code>, with M the on-chip memory in elements.</li>
<li><code>hbmStandard(N, d)</code> and <code>hbmFlash(N, d, M)</code>: the asymptotic HBM accesses with constant 1: <code>N·d + N²</code> and <code>N²·d² / M</code>.</li>
<li><code>flashAdvantage(N, d, M)</code>: their ratio, standard / flash.</li>
<li><code>backwardMemory(N, d, b)</code>: bytes to keep for the backward pass if you store P (N² values) versus FlashAttention's per-row statistics (2N values: max and sum), each with b-byte values: <code>{ storeP, stats }</code>.</li>
</ol>`,
  starter: `
function blockSizes(M, d) {
  // TODO
}
function hbmStandard(N, d) {
  // TODO
}
function hbmFlash(N, d, M) {
  // TODO
}
function flashAdvantage(N, d, M) {
  // TODO
}
function backwardMemory(N, d, b) {
  // TODO
}

function main() {
  const M = 100 * 1024 / 2; // ~100 KB of SRAM, FP16 elements
  print(JSON.stringify(blockSizes(M, 64)), flashAdvantage(4096, 64, M).toFixed(1) + "×");
  print(JSON.stringify(backwardMemory(16384, 128, 2)));
}
`,
  tests(t) {
    const bs = t.fn("blockSizes"), hs = t.fn("hbmStandard"), hf = t.fn("hbmFlash"), fa = t.fn("flashAdvantage"), bm = t.fn("backwardMemory");
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    t.check("blockSizes(51200, 64) = {Bc: 200, Br: 64}", eq(bs(51200, 64), { Bc: 200, Br: 64 }), `got ${JSON.stringify(bs(51200, 64))}`);
    t.check("blockSizes(8192, 128) = {Bc: 16, Br: 16}", eq(bs(8192, 128), { Bc: 16, Br: 16 }), `got ${JSON.stringify(bs(8192, 128))}`);
    t.check("blockSizes rounds up", eq(bs(1000, 64), { Bc: 4, Br: 4 }), `got ${JSON.stringify(bs(1000, 64))}`);
    t.check("hbmStandard(1024, 64)", hs(1024, 64) === 1024 * 64 + 1024 * 1024, `got ${hs(1024, 64)}`);
    t.check("hbmFlash(1024, 64, 51200)", t.approx(hf(1024, 64, 51200), (1024 * 1024 * 64 * 64) / 51200), `got ${hf(1024, 64, 51200)}`);
    t.check("flashAdvantage(4096, 64, 51200) ≈ 12.7", t.approx(fa(4096, 64, 51200), (4096 * 64 + 4096 * 4096) / ((4096 * 4096 * 64 * 64) / 51200)), `got ${fa(4096, 64, 51200)}`);
    const b = bm(16384, 128, 2) || {};
    t.check("backwardMemory(16384, 128, 2)", b.storeP === 16384 * 16384 * 2 && b.stats === 2 * 16384 * 2, `got ${JSON.stringify(b)}`);
  },
});
