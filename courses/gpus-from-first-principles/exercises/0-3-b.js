GW.exercise({
  id: "0-3-b",
  title: "Simulate the scheduler",
  file: "scheduler_sim.js",
  prompt: `
<p>Check Worked Example 1's formula by building the machine it describes. Each of <code>N</code> threads repeats: <code>C</code> cycles that need the unit (one instruction per cycle), then <code>L</code> cycles of waiting. All threads start ready at cycle 0.</p>
<ol>
<li><code>simulate(N, C, L, cycles, policy)</code> runs the unit for <code>cycles</code> cycles and returns the fraction of cycles in which it issued. <code>policy</code> is <code>"greedy"</code> (keep issuing from the current thread until it starts waiting, then switch to the lowest-numbered ready thread) or <code>"rr"</code> (each cycle, issue from the next ready thread after the one that issued last, round-robin; before anything has issued, "last" is thread N − 1, so thread 0 goes first).</li>
<li><code>formula(N, C, L)</code>: min(1, NC / (C + L)).</li>
</ol>
<p>Then compare the policies. Worked Example 1 proves greedy meets the formula. Does round-robin? If not, find out <em>why</em> by printing which threads are waiting each cycle for N = 9, C = 2, L = 16. That's the reason real warp schedulers aren't strict round-robin.</p>`,
  starter: `
function simulate(N, C, L, cycles, policy) {
  // per thread: remaining work in this period, and the cycle when its wait ends
  // TODO
}
function formula(N, C, L) {
  // TODO
}

function main() {
  for (const N of [1, 4, 9, 16]) print(N, "threads:", simulate(N, 2, 16, 100000, "greedy").toFixed(4), simulate(N, 2, 16, 100000, "rr").toFixed(4), "formula", formula(N, 2, 16).toFixed(4));
}
`,
  tests(t) {
    const sim = t.fn("simulate"), f = t.fn("formula");
    t.check("formula(4, 2, 16) = 8/18", t.approx(f(4, 2, 16), 8 / 18), `got ${f(4, 2, 16)}`);
    t.check("formula caps at 1", f(20, 2, 16) === 1, `got ${f(20, 2, 16)}`);
    t.check("one thread, C=2, L=16, 18 cycles: 2 of 18 busy", t.approx(sim(1, 2, 16, 18, "greedy"), 2 / 18), `got ${sim(1, 2, 16, 18, "greedy")}`);
    const cases = [[1, 2, 16], [4, 2, 16], [9, 2, 16], [16, 2, 16], [10, 5, 45], [3, 7, 100], [60, 4, 400]];
    for (const [N, C, L] of cases) {
      const u = sim(N, C, L, 200000, "greedy"), w = f(N, C, L);
      t.check(`greedy meets the formula: N=${N}, C=${C}, L=${L} → ${w.toFixed(3)}`, typeof u === "number" && Math.abs(u - w) < 0.01, `got ${u}`);
    }
    // round-robin, as specified, computed independently
    const rrRef = (N, C, L, cycles) => {
      const work = new Array(N).fill(C), readyAt = new Array(N).fill(0); let busy = 0, last = N - 1;
      for (let t = 0; t < cycles; t++) {
        let pick = -1;
        for (let k = 1; k <= N; k++) { const i = (last + k) % N; if (readyAt[i] <= t) { pick = i; break; } }
        if (pick < 0) continue;
        busy++; last = pick;
        if (--work[pick] === 0) { work[pick] = C; readyAt[pick] = t + 1 + L; }
      }
      return busy / cycles;
    };
    for (const [N, C, L] of cases) {
      const u = sim(N, C, L, 200000, "rr"), w = rrRef(N, C, L, 200000);
      t.check(`round-robin: N=${N}, C=${C}, L=${L} → ${w.toFixed(3)} (formula ${f(N, C, L).toFixed(3)})`, typeof u === "number" && Math.abs(u - w) < 0.005, `got ${u}`);
    }
  },
});
