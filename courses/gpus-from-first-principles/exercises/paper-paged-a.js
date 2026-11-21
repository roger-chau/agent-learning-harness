GW.exercise({
  id: "paper-paged-a",
  title: "Sizing and wasting a KV cache",
  file: "kvsize.js",
  prompt: `
<ol>
<li><code>kvBytesPerToken(layers, hidden, bytes)</code>: a key and a value vector of size <code>hidden</code> per layer, <code>bytes</code> per value.</li>
<li><code>contiguousWaste(lengths, maxLen)</code>: each request reserves <code>maxLen</code> tokens; the fraction of reserved memory not used by its final length.</li>
<li><code>pagedWaste(lengths, block)</code>: each request holds ⌈length / block⌉ blocks; the fraction of allocated memory not used.</li>
<li><code>maxRequests(memBytes, perToken, length, block)</code>: how many requests of a given final length fit when paged (whole blocks).</li>
</ol>`,
  starter: `
function kvBytesPerToken(layers, hidden, bytes) {
  // TODO
}
function contiguousWaste(lengths, maxLen) {
  // TODO
}
function pagedWaste(lengths, block) {
  // TODO
}
function maxRequests(memBytes, perToken, length, block) {
  // TODO
}

function main() {
  print("13B-class model (40 layers, hidden 5120, FP16):", kvBytesPerToken(40, 5120, 2) / 1024, "KB per token");
  const lengths = [120, 640, 37, 2048, 410, 999, 64, 1500];
  print("waste: contiguous", contiguousWaste(lengths, 2048), " paged", pagedWaste(lengths, 16));
}
`,
  tests(t) {
    const kb = t.fn("kvBytesPerToken"), cw = t.fn("contiguousWaste"), pw = t.fn("pagedWaste"), mr = t.fn("maxRequests");
    t.check("kvBytesPerToken(40, 5120, 2) = 819,200", kb(40, 5120, 2) === 819200, `got ${kb(40, 5120, 2)}`);
    t.check("kvBytesPerToken(32, 4096, 2) = 524,288", kb(32, 4096, 2) === 524288, `got ${kb(32, 4096, 2)}`);
    const L = [120, 640, 37, 2048, 410, 999, 64, 1500], used = L.reduce((a, b) => a + b, 0);
    t.check("contiguousWaste", t.approx(cw(L, 2048), 1 - used / (8 * 2048)), `got ${cw(L, 2048)}`);
    const alloc = L.reduce((a, b) => a + Math.ceil(b / 16) * 16, 0);
    t.check("pagedWaste", t.approx(pw(L, 16), 1 - used / alloc), `got ${pw(L, 16)}`);
    t.check("paging wastes under 4% here", pw(L, 16) < 0.04, `got ${pw(L, 16)}`);
    t.check("maxRequests(10 GB, 800 KB, 1000 tokens, 16) = 12", mr(10e9, 819200, 1000, 16) === 12, `got ${mr(10e9, 819200, 1000, 16)}`);
    t.check("maxRequests counts whole blocks", mr(16 * 819200 * 3, 819200, 17, 16) === 1, `got ${mr(16 * 819200 * 3, 819200, 17, 16)}`);
  },
});
