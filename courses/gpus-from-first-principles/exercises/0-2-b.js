GW.exercise({
  id: "0-2-b",
  title: "A cache simulator",
  file: "cache_sim.js",
  prompt: `
<p>Write a set-associative cache simulator with LRU replacement: the classic first systems lab.</p>
<ul>
<li><code>simulate(addresses, sizeBytes, lineBytes, ways)</code> takes a list of byte addresses (reads only) and returns <code>{ hits, misses }</code>. The cache has <code>sizeBytes / (lineBytes · ways)</code> sets; an address's line is ⌊address / lineBytes⌋, its set is line mod sets. On a miss in a full set, evict the least recently used line in that set.</li>
<li><code>strideMissRate(n, strideBytes, sizeBytes, lineBytes, ways)</code>: the miss rate of reading <code>n</code> addresses 0, s, 2s, … through a cold cache.</li>
<li><code>passes(arrayBytes, lineBytes, sizeBytes, ways, times)</code>: miss rate of reading every line of an array once, <code>times</code> times in a row (sequentially, one address per line). This shows the capacity cliff: with LRU, an array slightly bigger than a set's capacity makes that set miss on <em>every</em> access, not just a few. Work out on paper why 33 KB in a 32 KB, 8-way cache gives 15/33 before you run it.</li>
</ul>`,
  starter: `
function simulate(addresses, sizeBytes, lineBytes, ways) {
  // TODO: sets[] of LRU lists (most recent last)
}
function strideMissRate(n, strideBytes, sizeBytes, lineBytes, ways) {
  // TODO
}
function passes(arrayBytes, lineBytes, sizeBytes, ways, times) {
  // TODO
}

function main() {
  print(JSON.stringify(simulate([0, 4, 64, 0, 128, 4096, 0], 4096, 64, 2)));
  for (const s of [4, 16, 64, 256]) print("stride", s, "miss rate", strideMissRate(4096, s, 32768, 64, 8));
  for (const kb of [16, 32, 33, 64]) print(kb, "KB array, 4 passes, 32 KB cache:", passes(kb * 1024, 64, 32768, 8, 4));
}
`,
  tests(t) {
    const sim = t.fn("simulate"), smr = t.fn("strideMissRate"), ps = t.fn("passes");
    const ref = (addrs, size, line, ways) => {
      const sets = size / (line * ways), S = Array.from({ length: sets }, () => []);
      let hits = 0, misses = 0;
      for (const a of addrs) {
        const l = Math.floor(a / line), set = S[l % sets], k = set.indexOf(l);
        if (k >= 0) { hits++; set.splice(k, 1); set.push(l); } else { misses++; if (set.length === ways) set.shift(); set.push(l); }
      }
      return { hits, misses };
    };
    const eq = (a, b) => a && a.hits === b.hits && a.misses === b.misses;
    t.check("simulate: a small trace", eq(sim([0, 4, 64, 0, 128, 4096, 0], 4096, 64, 2), ref([0, 4, 64, 0, 128, 4096, 0], 4096, 64, 2)), `got ${JSON.stringify(sim([0, 4, 64, 0, 128, 4096, 0], 4096, 64, 2))}`);
    // conflict misses: direct-mapped vs 2-way on addresses that collide
    const conflict = [0, 1024, 0, 1024, 0, 1024];
    t.check("simulate: direct-mapped conflict (ways = 1)", eq(sim(conflict, 1024, 64, 1), { hits: 0, misses: 6 }), `got ${JSON.stringify(sim(conflict, 1024, 64, 1))}`);
    t.check("simulate: the same trace 2-way", eq(sim(conflict, 1024, 64, 2), { hits: 4, misses: 2 }), `got ${JSON.stringify(sim(conflict, 1024, 64, 2))}`);
    let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % 65536);
    const trace = Array.from({ length: 5000 }, rnd);
    t.check("simulate: a random trace (8 KB, 4-way)", eq(sim(trace, 8192, 64, 4), ref(trace, 8192, 64, 4)), `got ${JSON.stringify(sim(trace, 8192, 64, 4))}, expected ${JSON.stringify(ref(trace, 8192, 64, 4))}`);
    for (const [s, want] of [[4, 1 / 16], [16, 1 / 4], [64, 1], [256, 1]]) t.check(`strideMissRate stride ${s} B = ${want}`, t.approx(smr(4096, s, 32768, 64, 8), want), `got ${smr(4096, s, 32768, 64, 8)}`);
    t.check("passes: fits (16 KB in 32 KB): only cold misses", t.approx(ps(16384, 64, 32768, 8, 4), 0.25), `got ${ps(16384, 64, 32768, 8, 4)}`);
    t.check("passes: slightly too big (33 KB in 32 KB, 8-way): the 16 overfull sets thrash, the rest hit (15/33)", t.approx(ps(33 * 1024, 64, 32768, 8, 4), 15 / 33), `got ${ps(33 * 1024, 64, 32768, 8, 4)}`);
    t.check("passes: twice the cache (64 KB): LRU thrashes every set, every access misses", t.approx(ps(65536, 64, 32768, 8, 4), 1), `got ${ps(65536, 64, 32768, 8, 4)}`);
  },
});
