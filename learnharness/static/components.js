/* Interactive chapter components. A chapter mounts one with <div data-gw="name" ...>. */
(() => {
  "use strict";
  const C = {};
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmt = (x, d = 1) => (Math.abs(x) >= 100 || Number.isInteger(x) ? Math.round(x).toLocaleString() : x.toFixed(d));
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function shell(el, { title, controls, readouts, transport }) {
    el.classList.add("sim");
    el.innerHTML = `
      <div class="sim-head"><span class="sim-kind">${transport ? "Animation" : "Simulation"}</span><span class="sim-title">${title}</span></div>
      <div class="sim-stage"><canvas></canvas></div>
      ${transport ? `<div class="sim-transport">
        <button type="button" class="term-btn" data-t="play">▶ Play</button>
        <button type="button" class="term-btn" data-t="step">Step</button>
        <button type="button" class="term-btn" data-t="reset">Reset</button>
        <span class="sim-clock mono"></span></div>` : ""}
      <div class="sim-controls">${controls.map((c) => `
        <label class="sim-ctl"><span class="sim-lab">${c.label}</span>
          <input type="range" min="${c.min}" max="${c.max}" step="${c.step || 1}" value="${c.value}" data-k="${c.key}">
          <output class="mono" data-o="${c.key}"></output></label>`).join("")}</div>
      <div class="sim-readout">${readouts.map((r) => `<div class="stat"><div class="k">${r.label}</div><div class="v" data-r="${r.key}">–</div></div>`).join("")}</div>`;
    const canvas = el.querySelector("canvas");
    const vals = {};
    el.querySelectorAll("input[type=range]").forEach((i) => (vals[i.dataset.k] = +i.value));
    const unit = Object.fromEntries(controls.map((c) => [c.key, c.unit || ""]));
    const showVals = () => el.querySelectorAll("output[data-o]").forEach((o) => (o.textContent = `${fmt(vals[o.dataset.o])}${unit[o.dataset.o]}`));
    showVals();
    const setReadout = (k, v) => { const n = el.querySelector(`[data-r="${k}"]`); if (n) n.textContent = v; };
    function size(fixedH) {
      const w = canvas.parentElement.clientWidth;
      const h = fixedH ? Math.round(fixedH) : Math.round(Math.max(170, Math.min(320, w * 0.42)));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { ctx, w, h };
    }
    return { canvas, vals, showVals, setReadout, size };
  }

  function onInput(el, s, fn) {
    el.addEventListener("input", (e) => {
      if (e.target.dataset.k) { s.vals[e.target.dataset.k] = +e.target.value; s.showVals(); fn(); }
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }

  // Keep animations cheap: only run while visible.
  function whenVisible(el, start, stop) {
    if (!("IntersectionObserver" in window)) { start(); return; }
    new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? start() : stop())), { threshold: 0.05 }).observe(el);
  }

  // ---------------------------------------------------------------------------
  // 0.1 Little's law: requests flowing through a pipe of fixed latency.
  // ---------------------------------------------------------------------------
  C["littles-law"] = (el) => {
    const s = shell(el, {
      title: "Little's law: what's in flight",
      controls: [
        { key: "lat", label: "Latency", min: 50, max: 1000, step: 10, value: 500, unit: " ns" },
        { key: "bw", label: "Throughput", min: 10, max: 2000, step: 10, value: 512, unit: " GB/s" },
        { key: "req", label: "Request size", min: 32, max: 256, step: 32, value: 128, unit: " B" },
      ],
      readouts: [
        { key: "rate", label: "Requests per ns" },
        { key: "flight", label: "Requests in flight" },
        { key: "bytes", label: "Bytes in flight" },
        { key: "scale", label: "Each dot" },
      ],
    });
    let dots = [], last = 0, acc = 0, raf = 0, geo = s.size();
    const travel = 2.6; // seconds for a dot to cross the pipe at max latency
    function derived() {
      const rate = s.vals.bw / s.vals.req; // GB/s / B = requests per ns
      const inflight = rate * s.vals.lat;
      const per = Math.max(1, Math.ceil(inflight / 160));
      return { rate, inflight, per };
    }
    function readouts() {
      const d = derived();
      s.setReadout("rate", fmt(d.rate, 2));
      s.setReadout("flight", fmt(d.inflight));
      s.setReadout("bytes", `${fmt(s.vals.bw * s.vals.lat / 1000, 1)} KB`);
      s.setReadout("scale", d.per === 1 ? "1 request" : `${d.per} requests`);
    }
    function frame(t) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
      const { ctx, w, h } = geo;
      const d = derived();
      const pipeW = (w - 80) * (s.vals.lat / 1000);
      const cross = travel * (s.vals.lat / 1000);
      // spawn so that steady state has inflight/per dots in the pipe
      acc += dt * (d.inflight / d.per) / cross;
      while (acc >= 1) { acc -= 1; dots.push({ x: 0, lane: Math.random() }); }
      dots.forEach((p) => (p.x += dt / cross));
      dots = dots.filter((p) => p.x < 1);
      // draw
      ctx.clearRect(0, 0, w, h);
      const y0 = h * 0.28, ph = h * 0.44, x0 = 40;
      ctx.fillStyle = css("--surface-3"); roundRect(ctx, x0, y0, pipeW, ph, 10); ctx.fill();
      ctx.strokeStyle = css("--rule-strong"); ctx.lineWidth = 1; roundRect(ctx, x0, y0, pipeW, ph, 10); ctx.stroke();
      ctx.fillStyle = css("--primary");
      for (const p of dots) {
        ctx.beginPath();
        ctx.arc(x0 + 6 + p.x * (pipeW - 12), y0 + 8 + p.lane * (ph - 16), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = css("--muted"); ctx.font = `11px ${css("--font-mono")}`;
      ctx.fillText("issue →", 2, y0 - 10);
      ctx.textAlign = "right"; ctx.fillText("→ data returns", x0 + pipeW + 2, y0 + ph + 20); ctx.textAlign = "left";
      ctx.fillStyle = css("--ink-2");
      ctx.fillText(`${s.vals.lat} ns`, x0 + pipeW / 2 - 18, y0 + ph + 20);
    }
    const start = () => { if (!raf && !reduced()) { last = 0; raf = requestAnimationFrame(frame); } else if (reduced()) frame(0); };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    onInput(el, s, () => { readouts(); dots = []; });
    window.addEventListener("resize", () => (geo = s.size()));
    readouts();
    whenVisible(el, start, stop);
  };

  // ---------------------------------------------------------------------------
  // 0.2 Memory hierarchy: average memory access time and useful work.
  // ---------------------------------------------------------------------------
  C["memory-hierarchy"] = (el) => {
    const L1 = 4, L2 = 14;
    const s = shell(el, {
      title: "One load plus some work, on a CPU core",
      controls: [
        { key: "h1", label: "L1 hit rate", min: 50, max: 100, value: 90, unit: "%" },
        { key: "h2", label: "L2 hit rate", min: 0, max: 100, value: 60, unit: "%" },
        { key: "dram", label: "DRAM latency", min: 100, max: 600, step: 10, value: 300, unit: " cyc" },
        { key: "work", label: "Work per load", min: 1, max: 40, value: 4, unit: " cyc" },
      ],
      readouts: [
        { key: "amat", label: "Avg. load (AMAT)" },
        { key: "iter", label: "Cycles per iteration" },
        { key: "useful", label: "Time doing work" },
      ],
    });
    function draw() {
      const { ctx, w, h } = s.size(150);
      const h1 = s.vals.h1 / 100, h2 = s.vals.h2 / 100;
      const parts = [
        ["work", s.vals.work, css("--primary")],
        ["L1", L1, css("--mint-line")],
        ["L2", (1 - h1) * L2, css("--indigo")],
        ["DRAM", (1 - h1) * (1 - h2) * s.vals.dram, css("--rose-line")],
      ];
      const amat = L1 + (1 - h1) * (L2 + (1 - h2) * s.vals.dram);
      const total = s.vals.work + amat;
      s.setReadout("amat", `${fmt(amat, 1)} cyc`);
      s.setReadout("iter", `${fmt(total, 1)} cyc`);
      s.setReadout("useful", `${fmt((100 * s.vals.work) / total, 1)}%`);
      ctx.clearRect(0, 0, w, h);
      const x0 = 16, bw = w - 32, y = 44, bh = 56;
      let x = x0;
      ctx.font = `12px ${css("--font-ui")}`;
      for (const [name, v, col] of parts) {
        const pw = (v / total) * bw;
        ctx.fillStyle = col; roundRect(ctx, x, y, Math.max(pw - 2, 0), bh, 6); ctx.fill();
        if (pw > 44) {
          ctx.fillStyle = css("--on-primary") && name === "work" ? css("--on-primary") : css("--ink");
          ctx.fillText(name, x + 8, y + bh / 2 + 4);
        }
        x += pw;
      }
      ctx.fillStyle = css("--muted"); ctx.font = `11px ${css("--font-mono")}`;
      ctx.fillText("0", x0, y + bh + 18);
      ctx.textAlign = "right"; ctx.fillText(`${fmt(total, 1)} cycles per iteration`, x0 + bw, y + bh + 18); ctx.textAlign = "left";
      ctx.fillStyle = css("--ink-2"); ctx.font = `12px ${css("--font-ui")}`;
      ctx.fillText("Expected time of one loop iteration: the work, then the load's average cost", x0, y - 14);
    }
    onInput(el, s, draw);
    window.addEventListener("resize", draw);
    draw();
  };

  // ---------------------------------------------------------------------------
  // 0.3 Latency hiding: a single issue slot shared by N threads.
  // ---------------------------------------------------------------------------
  C["latency-hiding"] = (el) => {
    const s = shell(el, {
      title: "One execution unit, many threads",
      transport: true,
      controls: [
        { key: "n", label: "Threads", min: 1, max: 16, value: 4, unit: "" },
        { key: "c", label: "Compute per load", min: 1, max: 8, value: 2, unit: " cyc" },
        { key: "l", label: "Memory latency", min: 4, max: 40, value: 16, unit: " cyc" },
      ],
      readouts: [
        { key: "util", label: "Unit busy (measured)" },
        { key: "theory", label: "N·C / (C+L)" },
        { key: "need", label: "Threads to saturate" },
      ],
    });
    const T = 72;
    let trace = [], shown = 0, timer = 0, playing = false;
    function simulate() {
      const { n, c, l } = s.vals;
      const th = Array.from({ length: n }, () => ({ left: c, readyAt: 0 }));
      trace = [];
      let last = 0; // greedy: keep issuing from the last thread while it's ready
      for (let t = 0; t < T; t++) {
        const col = new Array(n).fill("wait");
        let issued = -1;
        for (let k = 0; k < n; k++) {
          const i = (last + k) % n;
          if (th[i].readyAt <= t) { if (issued < 0) issued = i; else col[i] = "ready"; }
        }
        if (issued >= 0) {
          col[issued] = "run";
          last = issued;
          if (--th[issued].left === 0) { th[issued].left = c; th[issued].readyAt = t + 1 + l; }
        }
        trace.push({ col, busy: issued >= 0 });
      }
      // Measure utilization over a long run (whole periods), separately from the 72 cycles drawn.
      const L = 20000, th2 = Array.from({ length: n }, () => ({ left: c, readyAt: 0 }));
      let last2 = 0, busy2 = 0;
      for (let t = 0; t < L; t++) {
        for (let k = 0; k < n; k++) {
          const i = (last2 + k) % n;
          if (th2[i].readyAt <= t) {
            busy2++; last2 = i;
            if (--th2[i].left === 0) { th2[i].left = c; th2[i].readyAt = t + 1 + l; }
            break;
          }
        }
      }
      const util = busy2 / L;
      s.setReadout("util", `${Math.round(util * 100)}%`);
      s.setReadout("theory", `${Math.round(Math.min(1, (n * c) / (c + l)) * 100)}%`);
      s.setReadout("need", `${Math.ceil((c + l) / c)}`);
    }
    function draw() {
      const n = s.vals.n;
      const { ctx, w, h } = s.size(Math.max(150, (n + 1) * 18 + 44));
      ctx.clearRect(0, 0, w, h);
      const left = 66, top = 8, rows = n + 1;
      const cw = (w - left - 8) / T;
      const rh = Math.min(18, (h - top - 26) / rows);
      ctx.font = `10px ${css("--font-mono")}`;
      const colors = { run: css("--primary"), ready: css("--saffron-line"), wait: css("--rose-soft") };
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = css("--muted");
        ctx.fillText(`thread ${i}`, 4, top + i * rh + rh * 0.7);
        for (let t = 0; t < shown; t++) {
          ctx.fillStyle = colors[trace[t].col[i]];
          ctx.fillRect(left + t * cw, top + i * rh + 1, Math.max(cw - 1, 1), rh - 2);
        }
      }
      const uy = top + n * rh + 6;
      ctx.fillStyle = css("--ink-2"); ctx.fillText("unit", 4, uy + rh * 0.7);
      for (let t = 0; t < shown; t++) {
        ctx.fillStyle = trace[t].busy ? css("--accent-ink") : css("--surface-3");
        ctx.fillRect(left + t * cw, uy + 1, Math.max(cw - 1, 1), rh - 2);
      }
      ctx.fillStyle = css("--muted");
      ctx.fillText("issuing", left, h - 6);
      ctx.fillStyle = colors.run; ctx.fillRect(left + 52, h - 14, 10, 8);
      ctx.fillStyle = css("--muted"); ctx.fillText("ready, not picked", left + 74, h - 6);
      ctx.fillStyle = colors.ready; ctx.fillRect(left + 190, h - 14, 10, 8);
      ctx.fillStyle = css("--muted"); ctx.fillText("waiting on memory", left + 212, h - 6);
      ctx.fillStyle = colors.wait; ctx.fillRect(left + 338, h - 14, 10, 8);
      el.querySelector(".sim-clock").textContent = `cycle ${shown}/${T}`;
    }
    const stopPlay = () => { playing = false; clearInterval(timer); el.querySelector('[data-t="play"]').textContent = "▶ Play"; };
    const play = () => {
      if (shown >= T) shown = 0;
      playing = true; el.querySelector('[data-t="play"]').textContent = "❚❚ Pause";
      timer = setInterval(() => { shown++; draw(); if (shown >= T) stopPlay(); }, 45);
    };
    el.querySelector(".sim-transport").addEventListener("click", (e) => {
      const b = e.target.closest("[data-t]"); if (!b) return;
      if (b.dataset.t === "play") (playing ? stopPlay : play)();
      if (b.dataset.t === "step") { stopPlay(); shown = Math.min(T, shown + 1); draw(); }
      if (b.dataset.t === "reset") { stopPlay(); shown = 0; draw(); }
    });
    onInput(el, s, () => { simulate(); shown = T; draw(); });
    window.addEventListener("resize", draw);
    simulate(); shown = T; draw();
  };

  // ---------------------------------------------------------------------------
  // 0.4 Blocks onto SMs in waves.
  // ---------------------------------------------------------------------------
  C["gpu-waves"] = (el) => {
    const s = shell(el, {
      title: "Scheduling a grid of blocks onto SMs",
      transport: true,
      controls: [
        { key: "blocks", label: "Blocks in grid", min: 1, max: 96, value: 40, unit: "" },
        { key: "sms", label: "SMs", min: 1, max: 16, value: 8, unit: "" },
        { key: "per", label: "Blocks resident per SM", min: 1, max: 4, value: 2, unit: "" },
      ],
      readouts: [
        { key: "slots", label: "Blocks at once" },
        { key: "waves", label: "Waves" },
        { key: "tail", label: "Last wave busy" },
      ],
    });
    let wave = 0, timer = 0, playing = false;
    const derived = () => {
      const slots = s.vals.sms * s.vals.per;
      const waves = Math.ceil(s.vals.blocks / slots);
      const lastCount = s.vals.blocks - (waves - 1) * slots;
      return { slots, waves, lastCount };
    };
    function draw() {
      const rowsNeeded = Math.ceil(s.vals.sms / Math.min(s.vals.sms, 8));
      const { ctx, w, h } = s.size(rowsNeeded * 78 + 40);
      const d = derived();
      s.setReadout("slots", d.slots);
      s.setReadout("waves", d.waves);
      s.setReadout("tail", `${Math.round((100 * d.lastCount) / d.slots)}%`);
      ctx.clearRect(0, 0, w, h);
      const sms = s.vals.sms, per = s.vals.per;
      const cols = Math.min(sms, 8), rowsSm = Math.ceil(sms / cols);
      const gap = 8, smW = (w - 16 - gap * (cols - 1)) / cols, smH = 70;
      ctx.font = `10px ${css("--font-mono")}`;
      for (let i = 0; i < sms; i++) {
        const x = 8 + (i % cols) * (smW + gap), y = 8 + Math.floor(i / cols) * (smH + gap);
        ctx.fillStyle = css("--surface-3"); roundRect(ctx, x, y, smW, smH, 8); ctx.fill();
        ctx.strokeStyle = css("--rule-strong"); roundRect(ctx, x, y, smW, smH, 8); ctx.stroke();
        ctx.fillStyle = css("--muted"); ctx.fillText(`SM ${i}`, x + 6, y + 13);
        for (let k = 0; k < per; k++) {
          const b = wave * d.slots + k * sms + i; // round-robin across SMs
          const sw = (smW - 12 - (per - 1) * 4) / per;
          const bx = x + 6 + k * (sw + 4), by = y + 20, bh = smH - 26;
          if (wave < d.waves && b < s.vals.blocks) {
            ctx.fillStyle = css("--indigo-soft"); roundRect(ctx, bx, by, sw, bh, 5); ctx.fill();
            ctx.strokeStyle = css("--indigo"); roundRect(ctx, bx, by, sw, bh, 5); ctx.stroke();
            ctx.fillStyle = css("--ink"); ctx.textAlign = "center";
            ctx.fillText(`b${b}`, bx + sw / 2, by + bh / 2 + 4); ctx.textAlign = "left";
          } else {
            ctx.strokeStyle = css("--rule"); ctx.setLineDash([3, 3]); roundRect(ctx, bx, by, sw, bh, 5); ctx.stroke(); ctx.setLineDash([]);
          }
        }
      }
      ctx.fillStyle = css("--ink-2"); ctx.font = `12px ${css("--font-ui")}`;
      ctx.fillText(wave < d.waves ? `Wave ${wave + 1} of ${d.waves}` : "Grid finished", 8, h - 10);
      el.querySelector(".sim-clock").textContent = `wave ${Math.min(wave + 1, d.waves)}/${d.waves}`;
    }
    const stopPlay = () => { playing = false; clearInterval(timer); el.querySelector('[data-t="play"]').textContent = "▶ Play"; };
    const play = () => {
      const d = derived();
      if (wave >= d.waves - 1) wave = 0;
      playing = true; el.querySelector('[data-t="play"]').textContent = "❚❚ Pause";
      draw();
      timer = setInterval(() => { if (wave >= derived().waves - 1) { stopPlay(); return; } wave++; draw(); }, 900);
    };
    el.querySelector(".sim-transport").addEventListener("click", (e) => {
      const b = e.target.closest("[data-t]"); if (!b) return;
      if (b.dataset.t === "play") (playing ? stopPlay : play)();
      if (b.dataset.t === "step") { stopPlay(); wave = Math.min(derived().waves - 1, wave + 1); draw(); }
      if (b.dataset.t === "reset") { stopPlay(); wave = 0; draw(); }
    });
    onInput(el, s, () => { stopPlay(); wave = 0; draw(); });
    window.addEventListener("resize", draw);
    draw();
  };

  // ---------------------------------------------------------------------------
  // Playground: a terminal preloaded with code from a <script type="text/plain">.
  // ---------------------------------------------------------------------------
  C["playground"] = (el) => {
    const src = el.querySelector("script[type='text/plain']");
    const code = src ? src.textContent : "";
    const term = window.GWTerminal.create({
      title: el.dataset.title || "playground.js",
      starter: code,
      storageKey: el.dataset.key ? `gw-play-${el.dataset.key}` : null,
    });
    el.replaceChildren(term);
  };

  // ---------------------------------------------------------------------------
  // Part 1: a warp executing a program, one warp instruction per step.
  // ---------------------------------------------------------------------------
  const W32 = 32;
  // Deterministic per-lane data so every reader sees the same masks.
  const laneVals = Array.from({ length: W32 }, (_, l) => ((l * 7 + 3) % 11) - 4); // mix of signs
  const tripCounts = Array.from({ length: W32 }, (_, l) => 1 + ((l * 5) % 4));      // 1..4
  const ALL = Array(W32).fill(true);
  const PRESETS = {
    uniform: {
      title: "A warp with no branches",
      code: ["i = blockIdx.x * blockDim.x + threadIdx.x", "a = x[i]", "b = y[i]", "c = a + b", "out[i] = c"],
      steps: () => [0, 1, 2, 3, 4].map((line) => ({ line, mask: ALL })),
    },
    divergent: {
      title: "if / else inside a warp",
      code: ["v = x[i]", "if (v > 0) {", "  v = v * 2", "  v = v + 1", "} else {", "  v = -v", "}", "out[i] = v      // reconverged"],
      steps: () => {
        const T = laneVals.map((v) => v > 0), F = T.map((t) => !t);
        return [{ line: 0, mask: ALL }, { line: 1, mask: ALL }, { line: 2, mask: T }, { line: 3, mask: T }, { line: 5, mask: F }, { line: 7, mask: ALL }];
      },
    },
    predicated: {
      title: "The same logic, predicated (no branch)",
      code: ["v = x[i]", "p = v > 0", "t = v * 2 + 1     // every lane", "e = -v            // every lane", "v = p ? t : e     // select", "out[i] = v"],
      steps: () => [0, 1, 2, 3, 4, 5].map((line) => ({ line, mask: ALL })),
    },
    loop: {
      title: "A loop whose trip count differs per lane",
      code: ["acc = 0", "for (j = 0; j < n[i]; j++)", "  acc += j", "out[i] = acc"],
      steps: () => {
        const st = [{ line: 0, mask: ALL }];
        const max = Math.max(...tripCounts);
        for (let k = 0; k <= max; k++) {
          const alive = tripCounts.map((n) => n >= k);
          st.push({ line: 1, mask: alive.map((a, l) => a) });
          if (k < max) st.push({ line: 2, mask: tripCounts.map((n) => n > k) });
        }
        st.push({ line: 3, mask: ALL });
        return st.filter((x) => x.mask.some(Boolean));
      },
    },
  };

  C["warp-exec"] = (el) => {
    const preset = PRESETS[el.dataset.preset] || PRESETS.uniform;
    const steps = preset.steps();
    el.classList.add("sim");
    el.innerHTML = `
      <div class="sim-head"><span class="sim-kind">Animation</span><span class="sim-title">${preset.title}</span></div>
      <div class="warp-exec">
        <pre class="we-code">${preset.code.map((c, i) => `<div class="we-line" data-l="${i}"><span>${i + 1}</span>${c.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`).join("")}</pre>
        <div class="we-lanes-wrap"><div class="we-cap mono">32 lanes of one warp</div><div class="we-lanes">${Array.from({ length: W32 }, (_, l) => `<i data-lane="${l}">${l}</i>`).join("")}</div>
          <div class="we-legend"><span><i class="on"></i>active</span><span><i></i>masked off</span></div></div>
      </div>
      <div class="sim-transport">
        <button type="button" class="term-btn" data-t="play">▶ Play</button>
        <button type="button" class="term-btn" data-t="step">Step</button>
        <button type="button" class="term-btn" data-t="reset">Reset</button>
        <span class="sim-clock mono"></span></div>
      <div class="sim-readout">
        <div class="stat"><div class="k">Warp instructions issued</div><div class="v" data-r="issued">0</div></div>
        <div class="stat"><div class="k">Lane-slots doing work</div><div class="v" data-r="work">0</div></div>
        <div class="stat"><div class="k">SIMD efficiency</div><div class="v" data-r="eff">–</div></div>
      </div>`;
    let k = 0, timer = 0;
    const lanes = el.querySelectorAll(".we-lanes i"), lines = el.querySelectorAll(".we-line");
    function render() {
      const cur = k > 0 ? steps[k - 1] : null;
      lines.forEach((ln, i) => ln.classList.toggle("cur", !!cur && cur.line === i));
      lanes.forEach((ln, i) => ln.classList.toggle("on", !!cur && cur.mask[i]));
      const done = steps.slice(0, k);
      const work = done.reduce((a, s) => a + s.mask.filter(Boolean).length, 0);
      el.querySelector('[data-r="issued"]').textContent = k;
      el.querySelector('[data-r="work"]').textContent = `${work} / ${k * W32}`;
      el.querySelector('[data-r="eff"]').textContent = k ? `${Math.round((100 * work) / (k * W32))}%` : "–";
      el.querySelector(".sim-clock").textContent = `step ${k}/${steps.length}`;
    }
    const stop = () => { clearInterval(timer); timer = 0; el.querySelector('[data-t="play"]').textContent = "▶ Play"; };
    el.querySelector(".sim-transport").addEventListener("click", (e) => {
      const b = e.target.closest("[data-t]"); if (!b) return;
      if (b.dataset.t === "play") {
        if (timer) return stop();
        if (k >= steps.length) k = 0;
        b.textContent = "❚❚ Pause";
        timer = setInterval(() => { k++; render(); if (k >= steps.length) stop(); }, 750);
      }
      if (b.dataset.t === "step") { stop(); k = Math.min(steps.length, k + 1); render(); }
      if (b.dataset.t === "reset") { stop(); k = 0; render(); }
    });
    render();
  };

  // ---------------------------------------------------------------------------
  // 1.2 Index explorer: how (blockIdx, threadIdx) map onto a 2D image.
  // ---------------------------------------------------------------------------
  C["index-explorer"] = (el) => {
    const IW = 22, IH = 12;
    el.classList.add("sim");
    el.innerHTML = `
      <div class="sim-head"><span class="sim-kind">Simulation</span><span class="sim-title">A ${IW}×${IH} image covered by a 2D grid of 2D blocks</span></div>
      <div class="ix-grid" role="grid" aria-label="Image pixels coloured by block"></div>
      <div class="ix-info mono">Click a pixel.</div>
      <div class="sim-controls">
        <label class="sim-ctl"><span class="sim-lab">blockDim.x</span><input type="range" min="1" max="16" value="8" data-k="bx"><output class="mono" data-o="bx"></output></label>
        <label class="sim-ctl"><span class="sim-lab">blockDim.y</span><input type="range" min="1" max="8" value="4" data-k="by"><output class="mono" data-o="by"></output></label>
      </div>
      <div class="sim-readout">
        <div class="stat"><div class="k">gridDim</div><div class="v" data-r="grid"></div></div>
        <div class="stat"><div class="k">Threads launched</div><div class="v" data-r="threads"></div></div>
        <div class="stat"><div class="k">Threads with no pixel</div><div class="v" data-r="idle"></div></div>
      </div>`;
    const grid = el.querySelector(".ix-grid"), info = el.querySelector(".ix-info");
    const v = { bx: 8, by: 4 };
    let sel = null;
    function render() {
      el.querySelectorAll("output[data-o]").forEach((o) => (o.textContent = v[o.dataset.o]));
      const gx = Math.ceil(IW / v.bx), gy = Math.ceil(IH / v.by);
      const W = gx * v.bx, H = gy * v.by;
      el.querySelector('[data-r="grid"]').textContent = `(${gx}, ${gy})`;
      el.querySelector('[data-r="threads"]').textContent = W * H;
      el.querySelector('[data-r="idle"]').textContent = W * H - IW * IH;
      grid.style.gridTemplateColumns = `repeat(${W}, 1fr)`;
      let html = "";
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const bxi = Math.floor(x / v.bx), byi = Math.floor(y / v.by);
        const tone = (bxi + byi * gx) % 5;
        const out = x >= IW || y >= IH;
        const isSel = sel && sel[0] === x && sel[1] === y;
        html += `<i class="b${tone}${out ? " out" : ""}${isSel ? " sel" : ""}" data-x="${x}" data-y="${y}"></i>`;
      }
      grid.innerHTML = html;
      if (sel) describe(sel[0], sel[1]);
    }
    function describe(x, y) {
      const b = { x: Math.floor(x / v.bx), y: Math.floor(y / v.by) }, t = { x: x % v.bx, y: y % v.by };
      const out = x >= IW || y >= IH;
      info.innerHTML = `blockIdx (${b.x}, ${b.y}) · threadIdx (${t.x}, ${t.y}) → x = ${b.x}·${v.bx} + ${t.x} = <b>${x}</b>, y = ${b.y}·${v.by} + ${t.y} = <b>${y}</b>` +
        (out ? ` · <span class="bad">outside the image: the guard must skip it</span>` : ` · linear index y·width + x = ${y}·${IW} + ${x} = <b>${y * IW + x}</b>`);
    }
    grid.addEventListener("click", (e) => { const c = e.target.closest("i"); if (!c) return; sel = [+c.dataset.x, +c.dataset.y]; render(); });
    el.addEventListener("input", (e) => { if (e.target.dataset.k) { v[e.target.dataset.k] = +e.target.value; sel = null; info.textContent = "Click a pixel."; render(); } });
    render();
  };

  // ---------------------------------------------------------------------------
  // 1.3 Warp map: which threads of a 2D block share a warp.
  // ---------------------------------------------------------------------------
  C["warp-map"] = (el) => {
    el.classList.add("sim");
    el.innerHTML = `
      <div class="sim-head"><span class="sim-kind">Simulation</span><span class="sim-title">Threads of one block, coloured by warp</span></div>
      <div class="ix-grid wm"></div>
      <div class="sim-controls">
        <label class="sim-ctl"><span class="sim-lab">blockDim.x</span><input type="range" min="1" max="32" value="16" data-k="x"><output class="mono" data-o="x"></output></label>
        <label class="sim-ctl"><span class="sim-lab">blockDim.y</span><input type="range" min="1" max="16" value="8" data-k="y"><output class="mono" data-o="y"></output></label>
      </div>
      <div class="sim-readout">
        <div class="stat"><div class="k">Threads per block</div><div class="v" data-r="t"></div></div>
        <div class="stat"><div class="k">Warps per block</div><div class="v" data-r="w"></div></div>
        <div class="stat"><div class="k">Idle lanes</div><div class="v" data-r="idle"></div></div>
        <div class="stat"><div class="k">Rows per warp</div><div class="v" data-r="rows"></div></div>
      </div>`;
    const v = { x: 16, y: 8 };
    const grid = el.querySelector(".ix-grid");
    function render() {
      el.querySelectorAll("output[data-o]").forEach((o) => (o.textContent = v[o.dataset.o]));
      const n = v.x * v.y, warps = Math.ceil(n / 32);
      el.querySelector('[data-r="t"]').textContent = n;
      el.querySelector('[data-r="w"]').textContent = warps;
      el.querySelector('[data-r="idle"]').textContent = warps * 32 - n;
      el.querySelector('[data-r="rows"]').textContent = v.x >= 32 ? (v.x % 32 ? "warps straddle rows" : `${v.x / 32} warp(s) per row`) : (32 % v.x ? "warps straddle rows" : `${32 / v.x}`);
      grid.style.gridTemplateColumns = `repeat(${v.x}, 1fr)`;
      let html = "";
      for (let y = 0; y < v.y; y++) for (let x = 0; x < v.x; x++) {
        const tid = x + y * v.x, w = Math.floor(tid / 32);
        html += `<i class="b${w % 5}" title="threadIdx (${x}, ${y}) · linear ${tid} · warp ${w}, lane ${tid % 32}">${tid % 32 === 0 ? `w${w}` : ""}</i>`;
      }
      grid.innerHTML = html;
    }
    el.addEventListener("input", (e) => { if (e.target.dataset.k) { v[e.target.dataset.k] = +e.target.value; render(); } });
    render();
  };

  function mount(root) {
    root.querySelectorAll("[data-gw]").forEach((el) => {
      const fn = C[el.dataset.gw];
      if (fn && !el.dataset.mounted) {
        el.dataset.mounted = "1";
        try { fn(el); } catch (e) { el.textContent = `Component failed: ${e.message}`; }
      }
    });
  }

  window.GWComponents = { mount, registry: C };
})();
