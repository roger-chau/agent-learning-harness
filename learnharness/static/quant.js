// Interactive components for the quant track: a timed mental-maths drill and a
// market-making game. They register into GWComponents (components.js) and use its
// lifecycle helpers, so leaving the page stops their timers.
(function () {
  "use strict";
  const G = window.GWComponents;
  if (!G) return;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
  const round = (x, d = 6) => Math.round(x * 10 ** d) / 10 ** d;
  const fmtNum = (x) => String(round(x, 6));

  // ---------------------------------------------------------------- mental-maths drill
  const GEN = {
    add: () => { const a = ri(2, 100), b = ri(2, 100); return { q: `${a} + ${b}`, a: a + b, t: "add" }; },
    sub: () => { const a = ri(2, 100), b = ri(2, 100); return { q: `${a + b} − ${a}`, a: b, t: "subtract" }; },
    mul: () => { const a = ri(2, 12), b = ri(2, 100); return { q: `${a} × ${b}`, a: a * b, t: "multiply" }; },
    div: () => { const a = ri(2, 12), b = ri(2, 100); return { q: `${a * b} ÷ ${a}`, a: b, t: "divide" }; },
    pct: () => { const p = pick([5, 10, 12.5, 15, 20, 25, 30, 40, 60, 75]), n = pick([40, 60, 80, 120, 160, 240, 320, 360, 480, 640, 800]); return { q: `${p}% of ${n}`, a: p * n / 100, t: "percent of" }; },
    incr: () => { const p = pick([5, 10, 15, 20, 25, 50]), n = pick([40, 60, 80, 120, 200, 240, 400]), up = Math.random() < 0.6; return { q: `${n} ${up ? "increased" : "decreased"} by ${p}%`, a: n * (1 + (up ? p : -p) / 100), t: "percent change" }; },
    frac: () => { const d = pick([2, 4, 5, 8, 16, 20, 25, 40]); let n = ri(1, d - 1); return { q: `${n}/${d} as a decimal`, a: n / d, t: "fraction → decimal" }; },
    dec: () => { const a = pick([0.25, 0.35, 0.4, 0.45, 0.6, 0.75, 1.2, 1.5, 2.5, 0.125]), b = pick([12, 16, 24, 36, 40, 48, 60, 64, 80, 96]); return { q: `${a} × ${b}`, a: a * b, t: "decimal ×" }; },
    sq: () => { const a = ri(11, 99); return { q: `${a}²`, a: a * a, t: "square" }; },
    dos: () => { const m = pick([20, 30, 40, 50, 60, 70, 80, 90, 100]), d = ri(1, 9); return { q: `${m - d} × ${m + d}`, a: m * m - d * d, t: "near-square ×" }; },
    big: () => { const a = ri(12, 99), b = ri(12, 99); return { q: `${a} × ${b}`, a: a * b, t: "2-digit ×" }; },
    ev: () => { const p = pick([0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75]), w = pick([10, 20, 40, 50, 80, 100]), l = pick([5, 10, 20, 25, 40]); return { q: `EV: win ${w} with p = ${p}, else lose ${l}`, a: p * w - (1 - p) * l, t: "expected value" }; },
  };
  const MODES = {
    arith: { label: "Arithmetic (Zetamac-style)", gens: ["add", "sub", "mul", "div"] },
    trading: { label: "Trading maths", gens: ["pct", "incr", "frac", "dec", "sq", "dos", "big", "ev"] },
    mixed: { label: "Mixed", gens: ["add", "sub", "mul", "div", "pct", "frac", "dec", "dos", "big", "ev"] },
  };

  G.registry["mental-drill"] = function (el) {
    const mode0 = el.dataset.mode || "arith", dur0 = +(el.dataset.seconds || 120);
    el.classList.add("sim", "drill");
    el.innerHTML = `
      <div class="sim-head"><span class="sim-kind">Drill</span><span class="sim-title">Timed mental maths</span></div>
      <div class="drill-body">
        <div class="drill-setup">
          <label>Mode <select class="field" data-k="mode">${Object.entries(MODES).map(([k, m]) => `<option value="${k}" ${k === mode0 ? "selected" : ""}>${m.label}</option>`).join("")}</select></label>
          <label>Time <select class="field" data-k="dur">${[60, 120, 300, 480].map((s) => `<option value="${s}" ${s === dur0 ? "selected" : ""}>${s / 60} min</option>`).join("")}</select></label>
          <button class="btn btn-primary btn-sm" type="button" data-k="start">Start</button>
        </div>
        <div class="drill-play" hidden>
          <div class="drill-top"><span data-k="clock"></span><span data-k="score"></span></div>
          <div class="drill-q" data-k="q"></div>
          <input class="field drill-in" data-k="in" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="answer">
          <div class="muted small">Correct answers advance automatically. Enter on an empty box skips.</div>
        </div>
        <div class="drill-out" data-k="out"></div>
      </div>`;
    const $ = (k) => el.querySelector(`[data-k="${k}"]`);
    const play = el.querySelector(".drill-play"), setup = el.querySelector(".drill-setup");
    let timer = null, state = null;
    const key = () => `gw-drill-${$("mode").value}-${$("dur").value}`;
    const history = () => {
      const h = store.get(key(), []);
      if (!h.length) return `<p class="muted small">No attempts yet in this mode and length.</p>`;
      const best = Math.max(...h.map((x) => x.score));
      return `<p class="small"><b>Best ${best}</b> · last ${Math.min(5, h.length)}: ${h.slice(-5).map((x) => x.score).join(", ")}</p>`;
    };
    $("out").innerHTML = history();
    $("mode").addEventListener("change", () => { $("out").innerHTML = history(); });
    $("dur").addEventListener("change", () => { $("out").innerHTML = history(); });
    const next = () => {
      const g = GEN[pick(MODES[state.mode].gens)]();
      state.cur = { ...g, shown: performance.now() };
      $("q").textContent = g.q; $("in").value = ""; $("in").focus();
    };
    const finish = () => {
      if (timer) G.cancelEvery(timer); timer = null;
      play.hidden = true; setup.hidden = false;
      const h = store.get(key(), []); h.push({ score: state.score, at: Date.now() }); store.set(key(), h.slice(-50));
      const byType = {};
      state.log.forEach((r) => { (byType[r.t] = byType[r.t] || []).push(r); });
      const rows = Object.entries(byType).map(([t, rs]) => ({ t, n: rs.length, ok: rs.filter((r) => r.ok).length, ms: rs.reduce((s, r) => s + r.ms, 0) / rs.length }))
        .sort((a, b) => b.ms - a.ms);
      const rate = state.score / (state.dur / 60);
      $("out").innerHTML = `<div class="drill-result"><b>${state.score}</b> correct in ${state.dur / 60} min · ${rate.toFixed(1)} per minute · ${state.skips} skipped</div>
        ${rows.length ? `<table class="lab-targets"><thead><tr><th>Type</th><th>Asked</th><th>Correct</th><th>Avg time</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.t)}</td><td>${r.n}</td><td>${r.ok}</td><td>${(r.ms / 1000).toFixed(1)} s</td></tr>`).join("")}</tbody></table>
        <p class="small">Slowest first: practise <b>${esc(rows[0].t)}</b> with the tricks in this chapter before your next attempt.</p>` : ""}
        ${history()}`;
    };
    $("start").addEventListener("click", () => {
      state = { mode: $("mode").value, dur: +$("dur").value, score: 0, skips: 0, log: [], end: performance.now() + 1000 * $("dur").value };
      setup.hidden = true; play.hidden = false; $("out").innerHTML = "";
      const tick = () => {
        const left = Math.max(0, (state.end - performance.now()) / 1000);
        $("clock").textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`;
        $("score").textContent = `Score ${state.score}`;
        if (left <= 0) finish();
      };
      tick(); timer = G.every(tick, 200); next();
    });
    $("in").addEventListener("input", () => {
      if (!state || !state.cur) return;
      const v = parseFloat($("in").value.replace(/,/g, ""));
      if (!Number.isNaN(v) && Math.abs(v - state.cur.a) < 1e-6) {
        state.score++; state.log.push({ t: state.cur.t, ok: true, ms: performance.now() - state.cur.shown }); next();
      }
    });
    $("in").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && state && state.cur && !$("in").value.trim()) {
        state.skips++; state.log.push({ t: state.cur.t, ok: false, ms: performance.now() - state.cur.shown });
        $("out").innerHTML = `<p class="muted small">Skipped: ${esc(state.cur.q)} = ${fmtNum(state.cur.a)}</p>`; next();
      }
    });
  };

  // ---------------------------------------------------------------- market-making game
  // A hidden value V = sum of three dice-like draws. Each round you quote bid/ask around your
  // estimate. Counterparties: an informed trader who knows V (trades when your quote is wrong by
  // more than a threshold) and noise traders (trade randomly). Clues are revealed between rounds.
  G.registry["market-maker"] = function (el) {
    el.classList.add("sim", "mm");
    el.innerHTML = `
      <div class="sim-head"><span class="sim-kind">Game</span><span class="sim-title">Make a market against an informed trader</span></div>
      <div class="mm-body">
        <p class="small">A hidden value V is the sum of three independent draws, each uniform on 1–20 (E[V] = 31.5). Each round you post a bid and an ask for one contract. The other side is a mix of <b>noise traders</b> (random buy/sell) and an <b>informed trader</b> who knows V and hits whichever side is mispriced. One draw is revealed after rounds 2 and 4. After round 6, V is revealed and your position settles at V.</p>
        <div class="mm-row"><label>Bid <input class="field" data-k="bid" inputmode="decimal" size="6"></label>
          <label>Ask <input class="field" data-k="ask" inputmode="decimal" size="6"></label>
          <button class="btn btn-primary btn-sm" type="button" data-k="go">Quote</button>
          <button class="btn btn-ghost btn-sm" type="button" data-k="new">New game</button></div>
        <div class="mm-state" data-k="state"></div>
        <div class="mm-log" data-k="log"></div>
      </div>`;
    const $ = (k) => el.querySelector(`[data-k="${k}"]`);
    let g;
    const ROUNDS = 6, INFORMED = 0.45, EDGE = 1.0;
    const fresh = () => {
      const d = [ri(1, 20), ri(1, 20), ri(1, 20)];
      g = { d, V: d[0] + d[1] + d[2], round: 1, pos: 0, cash: 0, revealed: 0, log: [], fills: { informed: 0, noise: 0 } };
      $("bid").value = ""; $("ask").value = ""; render();
    };
    const known = () => g.d.slice(0, g.revealed);
    const fair = () => known().reduce((s, x) => s + x, 0) + (3 - g.revealed) * 10.5;
    const render = () => {
      const k = known();
      $("state").innerHTML = g.round <= ROUNDS
        ? `<p><b>Round ${g.round} of ${ROUNDS}</b> · revealed draws: ${k.length ? k.join(", ") : "none"} · position ${g.pos >= 0 ? "+" : ""}${g.pos} · cash ${g.cash.toFixed(2)}</p>
           <p class="muted small">Your fair value given what's revealed: ${k.length ? `${k.join(" + ")} + ${3 - k.length} × 10.5 = ` : ""}${fair()}. Quote around it; a tighter spread trades more but the informed trader exploits mispricing.</p>`
        : "";
      $("log").innerHTML = g.log.map((x) => `<div class="small">${x}</div>`).join("");
    };
    $("go").addEventListener("click", () => {
      if (g.round > ROUNDS) return;
      const b = parseFloat($("bid").value), a = parseFloat($("ask").value);
      if (!(b < a)) { $("log").insertAdjacentHTML("afterbegin", `<div class="small"><b>Bid must be below ask.</b></div>`); return; }
      let who, side;
      if (Math.random() < INFORMED && (g.V > a + EDGE || g.V < b - EDGE)) { who = "informed"; side = g.V > a ? "buy" : "sell"; }
      else if (Math.random() < 0.8) { who = "noise"; side = Math.random() < 0.5 ? "buy" : "sell"; }
      let msg = `Round ${g.round}: quoted ${b} / ${a} (spread ${(a - b).toFixed(2)}). `;
      if (!who) msg += "No trade.";
      else if (side === "buy") { g.pos -= 1; g.cash += a; g.fills[who]++; msg += `Someone <b>bought</b> at ${a} (you're now short).`; }
      else { g.pos += 1; g.cash -= b; g.fills[who]++; msg += `Someone <b>sold</b> at ${b} (you're now long).`; }
      g.log.unshift(msg);
      if (g.round === 2 || g.round === 4) { g.revealed++; g.log.unshift(`<i>Revealed draw: ${g.d[g.revealed - 1]}.</i>`); }
      g.round++;
      if (g.round > ROUNDS) {
        const pnl = g.cash + g.pos * g.V;
        const best = store.get("gw-mm-best", null);
        if (best === null || pnl > best) store.set("gw-mm-best", pnl);
        const hist = store.get("gw-mm-hist", []); hist.push(pnl); store.set("gw-mm-hist", hist.slice(-100));
        const avg = hist.reduce((s, x) => s + x, 0) / hist.length;
        g.log.unshift(`<div class="drill-result"><b>V = ${g.V}</b> (${g.d.join(" + ")}). Final position ${g.pos} settles at V. <b>P&amp;L ${pnl.toFixed(2)}</b>. Your fills: ${g.fills.noise} from noise traders, ${g.fills.informed} from the informed trader. Average over your last ${hist.length} games: ${avg.toFixed(2)}.</div>
          <div class="small">Read it like a trader: fills from the informed trader are adverse selection; they're the reason a market maker's spread can't be zero. If your average is negative, widen when uncertain (early rounds) and tighten as draws are revealed.</div>`);
      }
      render();
    });
    $("new").addEventListener("click", fresh);
    fresh();
  };
})();
