GW.exercise({
  id: "2-4-a",
  title: "An LRU cache, and orders that suit it",
  file: "lru.js",
  prompt: `
<ol>
<li><code>simulateLRU(sectors, capacity)</code>: <code>sectors</code> is a sequence of sector ids accessed in order; the cache holds <code>capacity</code> sectors and evicts the least recently used. Return <code>{ hits, misses }</code>.</li>
<li><code>rowOrder(n)</code> returns the cells of an <code>n × n</code> grid as <code>[x, y]</code> pairs, row by row.</li>
<li><code>tileOrder(n, b)</code> returns the same cells tile by tile: tiles of <code>b × b</code>, tiles in row order, cells within a tile in row order. <code>n</code> is a multiple of <code>b</code>.</li>
</ol>
<p>The checks feed both orders through a cache, where each cell reads itself and its 4 neighbours (a stencil), and require the tile order to hit more when the cache is small.</p>`,
  starter: `
function simulateLRU(sectors, capacity) {
  // TODO: a Map keeps insertion order, which makes LRU easy
}

function rowOrder(n) {
  // TODO
}

function tileOrder(n, b) {
  // TODO
}

function main() {
  print(simulateLRU([1, 2, 3, 1, 4, 2, 5, 1], 3)); // work out the hits by hand first
  print(tileOrder(4, 2).slice(0, 6));
}
`,
  tests(t) {
    const lru = t.fn("simulateLRU"), ro = t.fn("rowOrder"), to = t.fn("tileOrder");
    const ref = (seq, cap) => {
      const m = new Map(); let hits = 0, misses = 0;
      for (const s of seq) {
        if (m.has(s)) { hits++; m.delete(s); m.set(s, 1); }
        else { misses++; m.set(s, 1); if (m.size > cap) m.delete(m.keys().next().value); }
      }
      return { hits, misses };
    };
    const cases = [[[1, 2, 3, 1, 4, 2, 5, 1], 3], [[1, 2, 3, 4, 1, 2, 3, 4], 3], [[1, 2, 3, 4, 1, 2, 3, 4], 4], [Array.from({ length: 200 }, (_, i) => (i * 7) % 23), 10]];
    for (const [seq, cap] of cases) {
      const got = lru(seq, cap), want = ref(seq, cap);
      t.check(`LRU on ${seq.length} accesses, capacity ${cap}: ${want.hits} hits`, got && got.hits === want.hits && got.misses === want.misses, got ? `got ${got.hits} hits, ${got.misses} misses` : "return { hits, misses }");
    }
    const n = 32, b = 4;
    const r = ro(n), tl = to(n, b);
    const okR = Array.isArray(r) && r.length === n * n && r[0][0] === 0 && r[1][0] === 1 && r[n][1] === 1;
    t.check("rowOrder visits every cell row by row", okR, "first cells should be [0,0], [1,0], …");
    const seen = new Set((tl || []).map(([x, y]) => y * n + x));
    const okT = Array.isArray(tl) && tl.length === n * n && seen.size === n * n && tl[0][0] === 0 && tl[1][0] === 1 && tl[b][0] === 0 && tl[b][1] === 1 && tl[b * b][0] === b;
    t.check("tileOrder visits every cell once, tile by tile", okT, "expected [0,0], [1,0], …, then [0,1] after b cells, and the next tile after b² cells");
    if (okR && okT) {
      const stencil = (order) => order.flatMap(([x, y]) => [[x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]])
        .filter(([x, y]) => x >= 0 && y >= 0 && x < n && y < n).map(([x, y]) => y * n + x);
      const cap = 24;
      const hr = ref(stencil(r), cap), ht = ref(stencil(tl), cap);
      t.check(`stencil with a ${cap}-entry cache: tile order hits more than row order`, ht.hits > hr.hits, `row ${hr.hits} hits, tile ${ht.hits} hits`);
    }
  },
});
