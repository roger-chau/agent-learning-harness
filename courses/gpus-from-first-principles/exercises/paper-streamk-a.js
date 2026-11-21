GW.exercise({
  id: "paper-streamk-a",
  title: "Scheduling arithmetic",
  file: "streamk_math.js",
  prompt: `
<ol>
<li><code>dpTime(tiles, sms, ipt)</code>: data-parallel time in iterations (one tile per SM at a time, <code>ipt</code> iterations per tile).</li>
<li><code>skTime(tiles, sms, ipt)</code>: Stream-K time in iterations with <code>sms</code> persistent blocks and equal shares (ignore fix-up).</li>
<li><code>splitTiles(tiles, ipt, g)</code>: how many tiles are covered by more than one of <code>g</code> blocks, when block b gets iterations [⌊b·total/g⌋, ⌊(b+1)·total/g⌋).</li>
<li><code>hybrid(tiles, sms, ipt)</code>: data-parallel for all full waves, Stream-K over the remaining tiles. Return <code>{ dpTiles, skTiles, time }</code>.</li>
</ol>`,
  starter: `
function dpTime(tiles, sms, ipt) {
  // TODO
}
function skTime(tiles, sms, ipt) {
  // TODO
}
function splitTiles(tiles, ipt, g) {
  // TODO
}
function hybrid(tiles, sms, ipt) {
  // TODO
}

function main() {
  print(dpTime(25, 16, 20), skTime(25, 16, 20), splitTiles(25, 20, 16), JSON.stringify(hybrid(25, 16, 20)));
}
`,
  tests(t) {
    const dp = t.fn("dpTime"), sk = t.fn("skTime"), st = t.fn("splitTiles"), hy = t.fn("hybrid");
    t.check("dpTime(25, 16, 20) = 40", dp(25, 16, 20) === 40, `got ${dp(25, 16, 20)}`);
    t.check("dpTime(32, 16, 20) = 40", dp(32, 16, 20) === 40, `got ${dp(32, 16, 20)}`);
    t.check("skTime(25, 16, 20) = 32", sk(25, 16, 20) === 32, `got ${sk(25, 16, 20)}`);
    t.check("skTime(9, 16, 12) = 7", sk(9, 16, 12) === 7, `got ${sk(9, 16, 12)}`);
    t.check("splitTiles(32, 20, 16) = 0", st(32, 20, 16) === 0, `got ${st(32, 20, 16)}`);
    t.check("splitTiles(25, 20, 16) = 15", st(25, 20, 16) === 15, `got ${st(25, 20, 16)}`);
    t.check("splitTiles(9, 12, 16) = 9", st(9, 12, 16) === 9, `got ${st(9, 12, 16)}`);
    const h = hy(25, 16, 20) || {};
    t.check("hybrid(25, 16, 20) = 16 DP tiles + 9 SK tiles, time 20 + 12 = 32", h.dpTiles === 16 && h.skTiles === 9 && h.time === 32, `got ${JSON.stringify(h)}`);
    const h2 = hy(40, 16, 10) || {};
    t.check("hybrid(40, 16, 10): 32 + 8, time 20 + 5 = 25", h2.dpTiles === 32 && h2.skTiles === 8 && h2.time === 25, `got ${JSON.stringify(h2)}`);
  },
});
