/* Runs learner code off the main thread. Messages in: {mode: "run"|"test", code, exerciseUrl, exerciseId}. */
/* global importScripts, GPUSim */
importScripts("/static/sim/gpusim.js");

self.GW = { exercises: {}, exercise(def) { this.exercises[def.id] = def; } };

const out = (text, kind = "out") => self.postMessage({ type: "out", kind, text: String(text) });

function fmt(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && v.data && v.toArray) {
    const a = v.toArray();
    return `Buffer(${a.length}) [${a.slice(0, 16).map(fmtNum).join(", ")}${a.length > 16 ? ", …" : ""}]`;
  }
  if (typeof v === "number") return fmtNum(v);
  try { return JSON.stringify(v, (k, x) => (typeof x === "number" ? +fmtNum(x) : x), 1).replace(/\n\s*/g, " "); }
  catch (e) { return String(v); }
}
function fmtNum(x) { return Number.isInteger(x) ? String(x) : String(+x.toPrecision(6)); }

const STAT_ROWS = [
  ["threads", "threads"], ["warps", "warps"], ["blocks", "blocks"],
  ["memInstructions", "warp memory instructions"], ["transactions", "32-byte transactions"],
  ["bytesRequested", "bytes requested"], ["bytesMoved", "bytes moved"],
  ["coalescing", "coalescing efficiency"], ["branches", "warp-level branches"],
  ["divergentBranches", "divergent branches"],
  ["l2HitRate", "L2 hit rate"], ["dramBytes", "DRAM bytes"],
  ["sharedLoads", "shared loads (warp)"], ["sharedStores", "shared stores (warp)"], ["bankConflicts", "bank conflicts"], ["barriers", "barriers (warp)"],
  ["occupancy", "occupancy"], ["occupancyLimiter", "occupancy limited by"],
  ["cycles", "estimated cycles"], ["timeUs", "estimated time (µs)"],
  ["achievedBandwidthGBs", "achieved bandwidth (GB/s)"], ["percentOfPeakBandwidth", "% of peak bandwidth"], ["limitedBy", "limited by"],
];

function table(obj) {
  if (obj && "transactions" in obj && "warps" in obj) {
    const lines = STAT_ROWS.filter(([k]) => k in obj).map(([k, label]) => {
      let v = obj[k];
      if (k === "coalescing" || k === "l2HitRate" || k === "occupancy") v = `${(v * 100).toFixed(1)}%`;
      if ((k.startsWith("shared") || k === "bankConflicts" || k === "barriers") && !obj.sharedLoads && !obj.sharedStores) return null;
      return `  ${label.padEnd(28)} ${fmt(v)}`;
    }).filter(Boolean);
    out(lines.join("\n"), "table");
    return;
  }
  if (obj && typeof obj === "object") {
    const lines = Object.entries(obj).map(([k, v]) => `  ${String(k).padEnd(28)} ${fmt(v)}`);
    out(lines.join("\n"), "table");
    return;
  }
  out(fmt(obj));
}

self.onmessage = async (e) => {
  const { mode, code, exerciseUrl, exerciseId } = e.data;
  const gpu = new GPUSim.Device();
  const print = (...a) => out(a.map(fmt).join(" "));
  const show = (buf, w, h, opts = {}) => {
    const data = buf && buf.data ? buf.data : buf;
    const channels = opts.channels || (data.length >= w * h * 3 ? 3 : 1);
    const rgba = GPUSim.toRGBA(data, w, h, channels, opts.min ?? null, opts.max ?? null);
    self.postMessage({ type: "image", w, h, rgba, label: opts.label || "" }, [rgba.buffer]);
  };
  try {
    if (exerciseUrl) importScripts(exerciseUrl);
    const fns = gpu.compile(code, { print, gpu, table, show, console: { log: print } });

    if (mode === "run") {
      if (typeof fns.main === "function") {
        await fns.main();
      } else {
        out("No main() defined. Press Test to check your solution, or add a main() to try things out.", "hint");
      }
      self.postMessage({ type: "done" });
      return;
    }

    const ex = self.GW.exercises[exerciseId];
    if (!ex) throw new Error(`exercise '${exerciseId}' not found`);
    const results = [];
    const t = {
      gpu,
      print,
      table,
      show,
      fn(name) {
        const f = fns[name];
        if (typeof f !== "function") throw new Error(`Define a function named ${name}(...)`);
        return f;
      },
      has(name) { return typeof fns[name] === "function"; },
      check(name, ok, detail = "") { results.push({ name, pass: !!ok, detail: ok ? "" : String(detail) }); return !!ok; },
      approx(a, b, rel = 1e-6, abs = 1e-9) { return Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b)); },
    };
    try {
      await ex.tests(t);
    } catch (err) {
      results.push({ name: "your code raised an error", pass: false, detail: err.message });
    }
    const passed = results.length > 0 && results.every((r) => r.pass);
    self.postMessage({ type: "result", results, passed });
  } catch (err) {
    self.postMessage({ type: "error", message: err.message || String(err) });
  }
};
