GW.exercise({
  id: "scenario-7-a",
  title: "An LLM serving scheduler",
  file: "serving.js",
  prompt: `<p>Implement <code>schedule(requests, cfg)</code>: an array of steps, each an array of request ids. Valid, and ≥ 1.8× faster than <code>staticBatches</code>.</p>`,
  starter: `
const CFG = { blocks: 512, blockSize: 16, stepBaseUs: 7000, usPerKvToken: 0.5, maxLen: 768 };

function workload(n, seed) {
  let s = seed >>> 0; const r = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  return Array.from({ length: n }, (_, id) => ({ id, prompt: 64 + Math.floor(r() * 448), output: 16 + Math.floor(r() * 240) }));
}

// Checks a schedule and returns { timeUs, steps }, or throws saying what's wrong.
function evaluate(reqs, steps, cfg) {
  const byId = new Map(reqs.map((q) => [q.id, q])), done = new Map(), first = new Map(), last = new Map();
  let time = 0;
  steps.forEach((ids, k) => {
    if (new Set(ids).size !== ids.length) throw new Error("step " + k + ": a request appears twice");
    let blocks = 0, kv = 0;
    for (const id of ids) {
      const q = byId.get(id); if (!q) throw new Error("step " + k + ": unknown request " + id);
      const g = (done.get(id) || 0) + 1;
      if (g > q.output) throw new Error("step " + k + ": request " + id + " already finished");
      if (first.has(id) && last.get(id) !== k - 1) throw new Error("step " + k + ": request " + id + " was paused (no preemption)");
      if (!first.has(id)) first.set(id, k);
      last.set(id, k); done.set(id, g);
      const len = q.prompt + g; blocks += Math.ceil(len / cfg.blockSize); kv += len;
    }
    if (blocks > cfg.blocks) throw new Error("step " + k + ": out of KV memory (" + blocks + " blocks > " + cfg.blocks + ")");
    time += cfg.stepBaseUs + cfg.usPerKvToken * kv;
  });
  for (const q of reqs) if ((done.get(q.id) || 0) !== q.output) throw new Error("request " + q.id + " got " + (done.get(q.id) || 0) + " of " + q.output + " tokens");
  return { timeUs: time, steps: steps.length };
}

// The team's current approach: fixed groups, each request reserving maxLen tokens.
function staticBatches(reqs, cfg) {
  const per = Math.floor((cfg.blocks * cfg.blockSize) / cfg.maxLen), steps = [];
  for (let i = 0; i < reqs.length; i += per) {
    const b = reqs.slice(i, i + per), L = Math.max(...b.map((q) => q.output));
    for (let k = 0; k < L; k++) steps.push(b.filter((q) => q.output > k).map((q) => q.id));
  }
  return steps;
}

function schedule(reqs, cfg) {
  // TODO: continuous batching with paged admission
  return staticBatches(reqs, cfg);
}

function main() {
  const w = workload(96, 1);
  const a = evaluate(w, staticBatches(w, CFG), CFG);
  print("static:", (a.timeUs / 1e6).toFixed(3), "s in", a.steps, "steps");
  try { const b = evaluate(w, schedule(w, CFG), CFG); print("yours: ", (b.timeUs / 1e6).toFixed(3), "s in", b.steps, "steps,", (a.timeUs / b.timeUs).toFixed(2) + "× faster"); }
  catch (e) { print("invalid schedule:", e.message); }
}
`,
  tests(t) {
    const sched = t.fn("schedule"), evaluate = t.fn("evaluate"), stat = t.fn("staticBatches"), workload = t.fn("workload");
    const CFG = { blocks: 512, blockSize: 16, stepBaseUs: 7000, usPerKvToken: 0.5, maxLen: 768 };
    for (const seed of [3, 11]) {
      const w = workload(128, seed);
      const base = evaluate(w, stat(w, CFG), CFG);
      let r;
      try { r = evaluate(w, sched(w.map((q) => ({ ...q })), { ...CFG }), CFG); }
      catch (e) { t.check(`workload ${seed}: valid schedule`, false, e.message); continue; }
      t.check(`workload ${seed}: valid schedule`, true);
      const sp = base.timeUs / r.timeUs;
      t.check(`workload ${seed}: ≥ 1.8× faster than static batching`, sp >= 1.8, `${sp.toFixed(2)}× (${(r.timeUs / 1e6).toFixed(3)} s vs ${(base.timeUs / 1e6).toFixed(3)} s)${sp >= 2.3 ? " — stretch met" : ""}`);
    }
  },
});
