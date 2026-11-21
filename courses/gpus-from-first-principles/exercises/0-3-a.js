GW.exercise({
  id: "0-3-a",
  title: "Simulate a latency-hiding core",
  file: "latency_hiding.js",
  prompt: `
<p>Build the model from the chapter, then check it against the formula.</p>
<ol>
<li><code>simulate(n, c, l, cycles)</code> runs a cycle-by-cycle model and returns the number of cycles in which the unit issued an instruction. The rules:
  <ul>
  <li>There are <code>n</code> threads, all ready at cycle 0; thread 0 goes first. Each one needs <code>c</code> issue cycles of compute, then waits <code>l</code> cycles, then repeats.</li>
  <li>Every cycle the unit issues <strong>at most one</strong> instruction. The scheduler is <strong>greedy</strong>: if the thread that issued last cycle is still ready, it issues again. Otherwise it picks the next ready thread <strong>round-robin</strong>, starting just after the thread that issued last.</li>
  <li>If a thread issues its last compute cycle at cycle <code>t</code>, it becomes ready again at cycle <code>t + 1 + l</code>.</li>
  </ul></li>
<li><code>utilization(n, c, l)</code> returns the formula from the chapter.</li>
<li><code>threadsToSaturate(c, l)</code> returns the smallest <code>n</code> with utilization 1.</li>
</ol>
<p>Small check: <code>simulate(1, 1, 3, 8)</code> issues at cycles 0 and 4, so it returns 2.</p>`,
  starter: `
function simulate(n, c, l, cycles) {
  // Track, for each thread, how many compute cycles it has left
  // and the cycle at which it is ready again.
  // TODO
}

function utilization(n, c, l) {
  // TODO
}

function threadsToSaturate(c, l) {
  // TODO
}

function main() {
  print("simulate(1,1,3,8) =", simulate(1, 1, 3, 8)); // 2
  for (let n = 1; n <= 10; n++) {
    const sim = simulate(n, 2, 16, 18000) / 18000;
    print(n, "threads: sim", sim.toFixed(3), " formula", utilization(n, 2, 16).toFixed(3));
  }
}
`,
  tests(t) {
    const sim = t.fn("simulate"), util = t.fn("utilization"), sat = t.fn("threadsToSaturate");
    const ref = (n, c, l, T) => {
      const left = new Array(n).fill(c), ready = new Array(n).fill(0);
      let last = 0, busy = 0;
      for (let tt = 0; tt < T; tt++) {
        for (let k = 0; k < n; k++) {
          const i = (last + k) % n; // k = 0 tries the last issuer first (greedy)
          if (ready[i] <= tt) {
            busy++; last = i;
            if (--left[i] === 0) { left[i] = c; ready[i] = tt + 1 + l; }
            break;
          }
        }
      }
      return busy;
    };
    t.check("simulate(1, 1, 3, 8) = 2", sim(1, 1, 3, 8) === 2, `got ${sim(1, 1, 3, 8)}`);
    for (const [n, c, l, T] of [[3, 2, 10, 50], [5, 1, 7, 64], [16, 3, 40, 500], [2, 4, 4, 33]]) {
      const want = ref(n, c, l, T), got = sim(n, c, l, T);
      t.check(`simulate(${n}, ${c}, ${l}, ${T}) = ${want}`, got === want, `got ${got}`);
    }
    for (const [n, c, l] of [[1, 2, 16], [4, 2, 16], [9, 2, 16], [20, 1, 30], [3, 5, 10]]) {
      const want = Math.min(1, (n * c) / (c + l));
      t.check(`utilization(${n}, ${c}, ${l})`, t.approx(util(n, c, l), want, 1e-9), `expected ${want.toFixed(4)}, got ${util(n, c, l)}`);
      const T = 20000, measured = sim(n, c, l, T) / T;
      t.check(`simulation agrees with the formula for (${n}, ${c}, ${l})`, Math.abs(measured - want) < 0.01, `measured ${measured.toFixed(4)}`);
    }
    for (const [c, l, want] of [[2, 16, 9], [1, 400, 401], [4, 400, 101], [5, 5, 2], [3, 0, 1]]) {
      t.check(`threadsToSaturate(${c}, ${l}) = ${want}`, sat(c, l) === want, `got ${sat(c, l)}`);
    }
  },
});
