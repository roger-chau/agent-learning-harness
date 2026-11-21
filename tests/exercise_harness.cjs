// Runs an exercise's checks against given code, the same way the browser worker does.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const GPUSim = require("../learnharness/static/sim/gpusim.js");
const { Device } = GPUSim;

function loadExercise(file) {
  const GW = { exercises: {}, exercise(def) { this.exercises[def.id] = def; } };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), { GW });
  return Object.values(GW.exercises)[0];
}

async function runChecks(ex, code) {
  const gpu = new Device();
  const out = [];
  const print = (...a) => out.push(a.join(" "));
  const results = [];
  let fns;
  try {
    fns = gpu.compile(code, { print, gpu, GPUSim, table: () => {}, show: () => {}, console: { log: print } });
  } catch (e) {
    return { passed: false, results: [{ name: "compile", pass: false, detail: e.message }] };
  }
  const t = {
    gpu, GPUSim, print, table: () => {}, show: () => {},
    fn(name) { if (typeof fns[name] !== "function") throw new Error(`Define a function named ${name}(...)`); return fns[name]; },
    has(name) { return typeof fns[name] === "function"; },
    check(name, ok, detail = "") { results.push({ name, pass: !!ok, detail: ok ? "" : String(detail) }); return !!ok; },
    approx(a, b, rel = 1e-6, abs = 1e-9) { return Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b)); },
  };
  try { await ex.tests(t); } catch (e) { results.push({ name: "error", pass: false, detail: e.message }); }
  return { passed: results.length > 0 && results.every((r) => r.pass), results };
}

module.exports = { loadExercise, runChecks };

if (require.main === module) {
  // usage: node exercise_harness.cjs <exercise.js> <solution.js>
  const ex = loadExercise(process.argv[2]);
  runChecks(ex, fs.readFileSync(process.argv[3], "utf8")).then((r) => {
    for (const x of r.results) console.log(`${x.pass ? "PASS" : "FAIL"} ${x.name} ${x.detail}`);
    console.log(r.passed ? "ALL PASSED" : "FAILED");
    process.exit(r.passed ? 0 : 1);
  });
}
