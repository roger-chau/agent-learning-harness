/* GWX: a small PTX-like assembly language and a cycle-level model of one GW-1 SM.
 *
 * Programs are text, one instruction per line:
 *
 *   .shared S 1024                 // shared array of 1024 values
 *   mov     %i, 0
 * loop:                            // label
 *   ld.global %x, A[%i + 0]        // memory operand: BUFFER[%reg + imm] (element index)
 *   fma     %acc, %x, %x, %acc
 *   add     %i, %i, 1
 *   setp.lt %p, %i, $n             // $name: a launch parameter
 *   @%p bra loop                   // predicated branch (@!%p negates)
 *   st.global OUT[%tid], %acc
 *
 * Registers are virtual (%anything) and hold one value per lane (32 lanes per warp).
 * Read-only specials: %tid (warp * 32 + lane), %lane, %warp, %nwarps.
 * Branches must be uniform across a warp. The timing model is in-order issue with a register
 * scoreboard, one warp instruction per cycle per SM, loose round-robin across warps.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GWX = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const W = 32;
  const DEFAULTS = Object.freeze({
    aluLatency: 4,        // add, mul, fma, mov, setp, ...
    sharedLatency: 24,    // ld.shared
    globalLatency: 400,   // ld.global
    branchBubble: 2,      // cycles before a warp can issue after a branch
    sharedBanks: 32,
    registerFile: 65536,  // 32-bit registers per SM
    maxWarps: 64,
    maxCycles: 5_000_000,
  });

  const ALU = {
    mov: (a) => a, add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b,
    div: (a, b) => a / b, min: (a, b) => Math.min(a, b), max: (a, b) => Math.max(a, b), neg: (a) => -a, abs: (a) => Math.abs(a),
    fma: (a, b, c) => a * b + c, mad: (a, b, c) => a * b + c,
    shl: (a, b) => (a << b) >>> 0, shr: (a, b) => a >>> b, and: (a, b) => (a & b) >>> 0, or: (a, b) => (a | b) >>> 0,
    xor: (a, b) => (a ^ b) >>> 0, rem: (a, b) => a % b, floor: (a) => Math.floor(a),
    sqrt: (a) => Math.sqrt(a), rsqrt: (a) => 1 / Math.sqrt(a),
  };
  const ARITY = { mov: 1, neg: 1, abs: 1, floor: 1, sqrt: 1, rsqrt: 1, fma: 3, mad: 3 };
  const CMP = { lt: (a, b) => a < b, le: (a, b) => a <= b, gt: (a, b) => a > b, ge: (a, b) => a >= b, eq: (a, b) => a === b, ne: (a, b) => a !== b };
  const SPECIAL = new Set(["%tid", "%lane", "%warp", "%nwarps"]);

  class AsmError extends Error {
    constructor(line, msg) { super(`line ${line}: ${msg}`); this.line = line; }
  }

  function parseOperand(tok, line) {
    tok = tok.trim();
    if (/^%[A-Za-z_][\w]*$/.test(tok)) return { k: "reg", name: tok };
    if (/^\$[A-Za-z_]\w*$/.test(tok)) return { k: "param", name: tok.slice(1) };
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(tok)) return { k: "imm", v: +tok };
    throw new AsmError(line, `bad operand '${tok}'`);
  }

  function parseMem(tok, line) {
    const m = /^([A-Za-z_]\w*)\s*\[\s*([^\]]*)\]$/.exec(tok.trim());
    if (!m) throw new AsmError(line, `bad memory operand '${tok}' (expected NAME[%reg + imm])`);
    const inner = m[2].replace(/\s+/g, "");
    let base = null, off = 0;
    if (inner !== "") {
      const parts = inner.match(/[-+]?[^-+]+/g);
      for (const p of parts) {
        const sgn = p.startsWith("-") ? -1 : 1, body = p.replace(/^[-+]/, "");
        if (body.startsWith("%")) {
          if (base || sgn < 0) throw new AsmError(line, `address may contain one register, added: '${tok}'`);
          base = parseOperand(body, line);
        } else if (body.startsWith("$")) {
          off = { param: body.slice(1), sgn, rest: off };
        } else if (/^\d+$/.test(body)) {
          if (typeof off === "number") off += sgn * +body; else off = { ...off, imm: (off.imm || 0) + sgn * +body };
        } else throw new AsmError(line, `bad address term '${p}'`);
      }
    }
    return { buf: m[1], base, off };
  }

  function splitArgs(s) {
    const out = []; let depth = 0, cur = "";
    for (const ch of s) {
      if (ch === "[" || ch === "{") depth++;
      if (ch === "]" || ch === "}") depth--;
      if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map((x) => x.trim());
  }
  const regList = (tok, line) => {
    const m = /^\{(.*)\}$/.exec(tok.trim());
    if (!m) throw new AsmError(line, `expected {%a, %b, %c, %d}, got '${tok}'`);
    const regs = m[1].split(",").map((x) => parseOperand(x, line));
    if (regs.length !== 4 || regs.some((r) => r.k !== "reg")) throw new AsmError(line, "vector operands need exactly 4 registers");
    return regs;
  };

  /** Parse program text into instructions. */
  function assemble(text) {
    const instrs = [], labels = {}, shared = {};
    const lines = String(text).split("\n");
    lines.forEach((raw, idx) => {
      const line = idx + 1;
      let s = raw.replace(/\/\/.*$/, "").replace(/#.*$/, "").trim();
      if (!s) return;
      let lm;
      while ((lm = /^([A-Za-z_]\w*):\s*/.exec(s))) {
        if (labels[lm[1]] !== undefined) throw new AsmError(line, `label '${lm[1]}' defined twice`);
        labels[lm[1]] = instrs.length; s = s.slice(lm[0].length);
      }
      if (!s) return;
      if (s.startsWith(".shared")) {
        const m = /^\.shared\s+([A-Za-z_]\w*)\s+(\d+)$/.exec(s);
        if (!m) throw new AsmError(line, "expected: .shared NAME SIZE");
        shared[m[1]] = +m[2]; return;
      }
      let pred = null;
      const pm = /^@(!?)(%[A-Za-z_]\w*)\s+/.exec(s);
      if (pm) { pred = { reg: pm[2], neg: pm[1] === "!" }; s = s.slice(pm[0].length); }
      const sp = s.search(/\s/);
      const opfull = sp < 0 ? s : s.slice(0, sp), rest = sp < 0 ? "" : s.slice(sp + 1);
      const parts = opfull.split("."), op = parts[0];
      const args = splitArgs(rest);
      const ins = { op, opfull, line, pred, text: raw.trim() };
      if (op === "ld" || op === "st") {
        const space = parts[1], vec = parts.includes("v4");
        if (space !== "global" && space !== "shared") throw new AsmError(line, `${op} needs .global or .shared`);
        if (args.length !== 2) throw new AsmError(line, `${opfull} takes 2 operands`);
        ins.space = space; ins.vec = vec;
        if (op === "ld") { ins.dst = vec ? regList(args[0], line) : [parseOperand(args[0], line)]; ins.mem = parseMem(args[1], line); ins.src = []; }
        else { ins.mem = parseMem(args[0], line); ins.src = vec ? regList(args[1], line) : [parseOperand(args[1], line)]; ins.dst = []; }
        if (ins.dst.some((d) => d.k !== "reg" || SPECIAL.has(d.name))) throw new AsmError(line, "load destination must be a writable register");
      } else if (op === "setp") {
        const cmp = parts[1];
        if (!CMP[cmp]) throw new AsmError(line, `setp needs a comparison: .${Object.keys(CMP).join(" .")}`);
        if (args.length !== 3) throw new AsmError(line, "setp takes 3 operands");
        ins.cmp = cmp; ins.dst = [parseOperand(args[0], line)]; ins.src = args.slice(1).map((a) => parseOperand(a, line));
      } else if (op === "bra") {
        if (args.length !== 1) throw new AsmError(line, "bra takes a label");
        ins.target = args[0]; ins.dst = []; ins.src = [];
      } else if (op === "bar" || op === "exit") {
        ins.dst = []; ins.src = [];
      } else if (ALU[op]) {
        const n = ARITY[op] || 2;
        if (args.length !== n + 1) throw new AsmError(line, `${op} takes ${n + 1} operands`);
        ins.dst = [parseOperand(args[0], line)]; ins.src = args.slice(1).map((a) => parseOperand(a, line));
        if (ins.dst[0].k !== "reg" || SPECIAL.has(ins.dst[0].name)) throw new AsmError(line, "destination must be a writable register");
      } else throw new AsmError(line, `unknown instruction '${opfull}'`);
      if (pred && op !== "bra") throw new AsmError(line, "only branches can be predicated in GWX");
      if (pred) ins.src = ins.src.concat([{ k: "reg", name: pred.reg }]);
      if (ins.mem && ins.mem.base) ins.src = ins.src.concat([ins.mem.base]);
      instrs.push(ins);
    });
    for (const ins of instrs) if (ins.op === "bra" && labels[ins.target] === undefined) throw new AsmError(ins.line, `unknown label '${ins.target}'`);
    const regs = new Set(), preds = new Set();
    for (const ins of instrs) for (const r of [...ins.dst, ...ins.src]) if (r.k === "reg" && !SPECIAL.has(r.name)) {
      if ((ins.op === "setp" && ins.dst.includes(r)) || (ins.pred && r.name === ins.pred.reg)) preds.add(r.name); else regs.add(r.name);
    }
    for (const p of preds) regs.delete(p);
    return { instrs, labels, shared, registers: [...regs], predicates: [...preds] };
  }

  const classOf = (ins) => ins.op === "ld" || ins.op === "st" ? `${ins.op}.${ins.space}` : ins.op === "fma" || ins.op === "mad" ? "fma" : ins.op === "bra" ? "branch" : ins.op === "bar" ? "barrier" : ins.op === "exit" ? "exit" : "alu";

  /**
   * Run a program on one SM.
   * opts: { warps, buffers: { NAME: Float64Array | number[] }, shared: { NAME: initial values }, params: { name: number },
   *         trace (max issue events to record as [cycle, warp, pc, class]), ...latency overrides }
   * Returns stats; global buffers are updated in place (arrays are converted to Float64Array copies
   * if needed: read results from the returned `buffers`).
   */
  function run(program, opts = {}) {
    const prog = typeof program === "string" ? assemble(program) : program;
    const cfg = { ...DEFAULTS, ...opts };
    const warps = cfg.warps || 1;
    if (warps < 1 || warps > cfg.maxWarps) throw new RangeError(`warps must be 1..${cfg.maxWarps}`);
    const regsPerThread = prog.registers.length;
    if (regsPerThread * W * warps > cfg.registerFile) {
      throw new RangeError(`register file exceeded: ${regsPerThread} registers × 32 lanes × ${warps} warps = ${regsPerThread * W * warps} > ${cfg.registerFile}`);
    }
    const params = cfg.params || {};
    const buffers = {};
    for (const [k, v] of Object.entries(cfg.buffers || {})) buffers[k] = v instanceof Float64Array ? v : Float64Array.from(v);
    const shared = {};
    for (const [k, n] of Object.entries(prog.shared)) {
      shared[k] = new Float64Array(n);
      if (cfg.shared && cfg.shared[k]) shared[k].set(Array.from(cfg.shared[k]).slice(0, n));
    }
    const { instrs, labels } = prog;

    const warpsState = [];
    for (let w = 0; w < warps; w++) {
      warpsState.push({ id: w, pc: 0, regs: new Map(), ready: new Map(), done: false, atBarrier: false, holdUntil: 0 });
    }
    const getReg = (ws, name) => {
      if (name === "%tid") return Float64Array.from({ length: W }, (_, l) => ws.id * W + l);
      if (name === "%lane") return Float64Array.from({ length: W }, (_, l) => l);
      if (name === "%warp") return new Float64Array(W).fill(ws.id);
      if (name === "%nwarps") return new Float64Array(W).fill(warps);
      let r = ws.regs.get(name);
      if (!r) { r = new Float64Array(W); ws.regs.set(name, r); }
      return r;
    };
    const val = (ws, o, line) => {
      if (o.k === "imm") return new Float64Array(W).fill(o.v);
      if (o.k === "param") { if (!(o.name in params)) throw new AsmError(line, `no launch parameter '$${o.name}'`); return new Float64Array(W).fill(params[o.name]); }
      return getReg(ws, o.name);
    };
    const offset = (off, line) => {
      if (typeof off === "number") return off;
      if (!(off.param in params)) throw new AsmError(line, `no launch parameter '$${off.param}'`);
      return off.sgn * params[off.param] + offset(off.rest, line) + (off.imm || 0);
    };
    const addrs = (ws, ins) => {
      const base = ins.mem.base ? val(ws, ins.mem.base, ins.line) : null, off = offset(ins.mem.off, ins.line);
      return Float64Array.from({ length: W }, (_, l) => (base ? base[l] : 0) + off);
    };
    const target = (ins) => {
      const b = ins.space === "shared" ? shared[ins.mem.buf] : buffers[ins.mem.buf];
      if (!b) throw new AsmError(ins.line, ins.space === "shared" ? `no .shared array '${ins.mem.buf}'` : `no global buffer '${ins.mem.buf}' given to run()`);
      return b;
    };

    const stats = { trace: [], cycles: 0, instructions: 0, byClass: {}, stallCycles: 0, stalls: { dependency: 0, barrier: 0, branch: 0 }, bankConflicts: 0, registers: regsPerThread, warps };
    let cycle = 0, rr = 0, sharedBusyUntil = 0;
    const live = () => warpsState.some((w) => !w.done);

    const srcReady = (ws, ins) => {
      let t = 0;
      for (const o of [...ins.src, ...ins.dst]) if (o.k === "reg" && !SPECIAL.has(o.name)) t = Math.max(t, ws.ready.get(o.name) || 0);
      return t;
    };

    while (live()) {
      if (cycle > cfg.maxCycles) throw new Error(`GWX: exceeded ${cfg.maxCycles} cycles (infinite loop?)`);
      // barrier release
      const running = warpsState.filter((w) => !w.done);
      if (running.length && running.every((w) => w.atBarrier)) for (const w of running) { w.atBarrier = false; w.pc++; }
      let issued = false, why = "dependency";
      for (let k = 0; k < warps; k++) {
        const ws = warpsState[(rr + k) % warps];
        if (ws.done) continue;
        if (ws.atBarrier) { why = why === "dependency" ? "barrier" : why; continue; }
        if (ws.holdUntil > cycle) { why = "branch"; continue; }
        if (ws.pc >= instrs.length) { ws.done = true; continue; }
        const ins = instrs[ws.pc];
        if (srcReady(ws, ins) > cycle) continue;
        if ((ins.op === "ld" || ins.op === "st") && ins.space === "shared" && sharedBusyUntil > cycle) continue;
        // issue
        issued = true; rr = (ws.id + 1) % warps;
        stats.instructions++;
        const cls = classOf(ins);
        if (cfg.trace && stats.trace.length < cfg.trace) stats.trace.push([cycle, ws.id, ws.pc, cls]);
        stats.byClass[cls] = (stats.byClass[cls] || 0) + 1;
        execute(ws, ins);
        break;
      }
      if (!issued && live()) { stats.stallCycles++; stats.stalls[why]++; }
      cycle++;
    }
    stats.cycles = cycle;
    stats.ipc = +(stats.instructions / Math.max(1, cycle)).toFixed(4);
    stats.buffers = buffers;
    stats.shared = shared;
    return stats;

    function execute(ws, ins) {
      const L = ins.line;
      switch (ins.op) {
        case "exit": ws.done = true; return;
        case "bar": ws.atBarrier = true; return; // pc advances on release
        case "bra": {
          let take = true;
          if (ins.pred) {
            const p = getReg(ws, ins.pred.reg);
            const t0 = !!p[0] !== ins.pred.neg;
            for (let l = 1; l < W; l++) if ((!!p[l] !== ins.pred.neg) !== t0) throw new AsmError(L, "divergent branch: GWX branches must be uniform across the warp");
            take = t0;
          }
          ws.pc = take ? labels[ins.target] : ws.pc + 1;
          ws.holdUntil = cycle + 1 + cfg.branchBubble;
          return;
        }
        case "setp": {
          const a = val(ws, ins.src[0], L), b = val(ws, ins.src[1], L), d = getReg(ws, ins.dst[0].name), f = CMP[ins.cmp];
          for (let l = 0; l < W; l++) d[l] = f(a[l], b[l]) ? 1 : 0;
          ws.ready.set(ins.dst[0].name, cycle + cfg.aluLatency);
          ws.pc++; return;
        }
        case "ld": case "st": {
          const buf = target(ins), ad = addrs(ws, ins), n = ins.vec ? 4 : 1;
          for (let l = 0; l < W; l++) {
            if (!Number.isInteger(ad[l]) || ad[l] < 0 || ad[l] + n > buf.length) throw new AsmError(L, `address ${ad[l]} out of bounds for ${ins.mem.buf}[${buf.length}] (lane ${l})`);
            if (ins.vec && ad[l] % 4) throw new AsmError(L, `vector access needs an address that's a multiple of 4 (lane ${l}: ${ad[l]})`);
          }
          let extra = 0;
          if (ins.space === "shared") {
            // bank conflicts: distinct words in one bank are serialised
            let degree = 1;
            for (let q = 0; q < n; q++) {
              const byBank = new Map();
              for (let l = 0; l < W; l++) { const w = ad[l] + q, b = w % cfg.sharedBanks; if (!byBank.has(b)) byBank.set(b, new Set()); byBank.get(b).add(w); }
              for (const s of byBank.values()) degree = Math.max(degree, s.size);
            }
            extra = degree - 1 + (n - 1);
            stats.bankConflicts += degree - 1;
            sharedBusyUntil = cycle + 1 + extra;
          }
          if (ins.op === "ld") {
            ins.dst.forEach((d, q) => { const r = getReg(ws, d.name); for (let l = 0; l < W; l++) r[l] = buf[ad[l] + q]; });
            const lat = (ins.space === "shared" ? cfg.sharedLatency : cfg.globalLatency) + extra;
            for (const d of ins.dst) ws.ready.set(d.name, cycle + lat);
          } else {
            const vals = ins.src.slice(0, n).map((o) => val(ws, o, L));
            for (let l = 0; l < W; l++) for (let q = 0; q < n; q++) buf[ad[l] + q] = vals[q][l];
          }
          ws.pc++; return;
        }
        default: {
          const f = ALU[ins.op], a = ins.src.map((o) => val(ws, o, L)), d = getReg(ws, ins.dst[0].name);
          const tmp = new Float64Array(W);
          for (let l = 0; l < W; l++) tmp[l] = f(a[0][l], a[1] && a[1][l], a[2] && a[2][l]);
          d.set(tmp);
          ws.ready.set(ins.dst[0].name, cycle + cfg.aluLatency);
          ws.pc++;
        }
      }
    }
  }

  /** Format an assembled program back to text (one instruction per line). */
  function listing(prog) {
    const p = typeof prog === "string" ? assemble(prog) : prog;
    const at = {};
    for (const [k, v] of Object.entries(p.labels)) (at[v] ||= []).push(k);
    const out = Object.entries(p.shared).map(([k, n]) => `.shared ${k} ${n}`);
    p.instrs.forEach((ins, i) => { for (const l of at[i] || []) out.push(`${l}:`); out.push(`  ${ins.text}`); });
    for (const l of at[p.instrs.length] || []) out.push(`${l}:`);
    return out.join("\n");
  }

  return { assemble, run, listing, DEFAULTS, AsmError, classOf };
});
