GW.exercise({
  id: "paper-lookback-a",
  title: "Model the scan strategies and one look-back",
  file: "lookback.js",
  prompt: `
<ol>
<li><code>trafficElements(n, strategy)</code>: elements moved through DRAM (reads + writes) for <code>"reduce-then-scan"</code> (3n), <code>"scan-then-propagate"</code> (4n), <code>"single-pass"</code> (2n). Ignore the tiny per-tile arrays.</li>
<li><code>lookback(preds)</code>: <code>preds</code> lists the tiles before yours, <strong>nearest first</strong>, as <code>{ status, value }</code> with status <code>"X"</code>, <code>"A"</code> (value is that tile's aggregate) or <code>"P"</code> (value is its inclusive prefix). Walk them in order: add A values, stop after adding the first P. Return <code>{ prefix, inspected }</code>. If you reach an X first, return <code>null</code> (you'd wait). If there are no predecessors, the prefix is 0.</li>
</ol>`,
  starter: `
function trafficElements(n, strategy) {
  // TODO
}

function lookback(preds) {
  // TODO
}

function main() {
  print(lookback([{ status: "A", value: 5 }, { status: "A", value: 2 }, { status: "P", value: 40 }])); // { prefix: 47, inspected: 3 }
}
`,
  tests(t) {
    const tr = t.fn("trafficElements"), lb = t.fn("lookback");
    for (const [s, k] of [["reduce-then-scan", 3], ["scan-then-propagate", 4], ["single-pass", 2]]) t.check(`trafficElements(1000, "${s}") = ${k * 1000}`, tr(1000, s) === k * 1000, `got ${tr(1000, s)}`);
    const cases = [
      [[{ status: "P", value: 10 }], { prefix: 10, inspected: 1 }],
      [[{ status: "A", value: 5 }, { status: "A", value: 2 }, { status: "P", value: 40 }], { prefix: 47, inspected: 3 }],
      [[{ status: "A", value: 5 }, { status: "X", value: 0 }, { status: "P", value: 1 }], null],
      [[{ status: "A", value: 3 }, { status: "P", value: 7 }, { status: "A", value: 100 }], { prefix: 10, inspected: 2 }],
      [[], { prefix: 0, inspected: 0 }],
    ];
    cases.forEach(([preds, want], k) => {
      const got = lb(preds);
      const ok = want === null ? got === null : got && got.prefix === want.prefix && got.inspected === want.inspected;
      t.check(`lookback case ${k + 1}`, ok, `got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    });
  },
});
