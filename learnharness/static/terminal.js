/* In-page terminal: a code editor + console that runs code in a Web Worker. */
(() => {
  "use strict";
  const liveTerminals = new Set();
  const TIMEOUT_MS = 15000;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val);
    } catch (e) { return null; }
    return null;
  }

  // ---- Syntax colouring: JavaScript, simulator built-ins, and GWX assembly inside template strings.
  const KW = new Set("const let var function return if else for while do break continue new of in typeof instanceof switch case default throw try catch finally class extends async await yield true false null undefined this".split(" "));
  const BUILTIN = new Set("threadIdx blockIdx blockDim gridDim warpSize __syncthreads __syncwarp __shfl_sync __shfl_down_sync __shfl_up_sync __shfl_xor_sync __ballot_sync __any_sync __all_sync __mma_sync __popc __threadfence shared fma ldg4 stg4 f16 atomicAdd atomicSub atomicMax atomicMin atomicExch atomicOr atomicAnd atomicCAS gpu GWX GPUSim print table show Math".split(" "));
  const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\[\s\S]|[^`\\])*`?|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(\b0x[0-9a-fA-F]+\b|\b\d+\.?\d*(?:e[-+]?\d+)?\b)|([A-Za-z_$][\w$]*)(\s*\()?|([{}()[\];,.]|[-+*/%=<>!&|^~?:]+)/g;
  function highlightTemplate(text) {
    // template literals often hold kernel source or GWX assembly: colour them too, with a string tint
    const inner = text.slice(1, text.endsWith("`") && text.length > 1 ? -1 : undefined);
    const looksAsm = /(^|\n)\s*(ld\.|st\.|fma |add |mov |setp\.|@%|bra |\.shared )/.test(inner);
    const body = looksAsm ? highlightAsm(inner) : highlightJs(inner, true);
    return `<span class="tk-str">\`</span>${body}${text.endsWith("`") && text.length > 1 ? `<span class="tk-str">\`</span>` : ""}`;
  }
  function highlightAsm(src) {
    return src.split("\n").map((ln) => {
      const m = /^(\s*)(\/\/.*)?$/.exec(ln);
      if (m) return esc(m[1]) + (m[2] ? `<span class="tk-com">${esc(m[2])}</span>` : "");
      return esc(ln)
        .replace(/(\/\/.*)$/, '<span class="tk-com">$1</span>')
        .replace(/^(\s*)([A-Za-z_]\w*:)/, '$1<span class="tk-label">$2</span>')
        .replace(/^(\s*(?:@!?%\w+\s+)?)([a-z][\w.]*)/, '$1<span class="tk-kw">$2</span>')
        .replace(/(%[A-Za-z_]\w*)/g, '<span class="tk-reg">$1</span>')
        .replace(/(\$[A-Za-z_]\w*)/g, '<span class="tk-fn">$1</span>')
        .replace(/(^|[\s,\[+-])(\d+\.?\d*)/g, '$1<span class="tk-num">$2</span>');
    }).join("\n");
  }
  function highlightJs(src, nested) {
    // A fresh regex per call: this function recurses (template strings are highlighted with a
    // nested call), and sharing one global regex's lastIndex made the outer loop rescan forever.
    const re = new RegExp(TOKEN.source, TOKEN.flags);
    let out = "", last = 0, m;
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      last = re.lastIndex;
      if (m[1]) out += `<span class="tk-com">${esc(m[1])}</span>`;
      else if (m[2]) out += m[2][0] === "`" && !nested ? highlightTemplate(m[2]) : `<span class="tk-str">${esc(m[2])}</span>`;
      else if (m[3]) out += `<span class="tk-num">${esc(m[3])}</span>`;
      else if (m[4]) {
        const w = m[4], call = m[5] || "";
        const cls = KW.has(w) ? "tk-kw" : BUILTIN.has(w) ? "tk-bi" : call ? "tk-fn" : "";
        out += (cls ? `<span class="${cls}">${esc(w)}</span>` : esc(w)) + esc(call);
      } else out += `<span class="tk-op">${esc(m[6])}</span>`;
    }
    return out + esc(src.slice(last));
  }
  const highlight = (src) => highlightJs(src, false);

  /**
   * opts: { title, starter, storageKey, exerciseUrl, exerciseId, onResult(passed, results) }
   * Without exerciseId it's a playground (Run only).
   */
  function create(opts) {
    const el = document.createElement("div");
    el.className = "term";
    const testBtn = opts.exerciseId ? `<button class="term-btn primary" data-act="test" type="button">Test &amp; submit</button>` : "";
    el.innerHTML = `
      <div class="term-head">
        <span class="term-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="term-title">${esc(opts.title || "playground.js")}</span>
        <span class="term-actions">
          <button class="term-btn" data-act="reset" type="button" title="Restore the starter code">Reset</button>
          <button class="term-btn" data-act="run" type="button" title="Run main() (Ctrl+Enter)">Run ▸</button>
          ${testBtn}
        </span>
      </div>
      <div class="term-editor">
        <pre class="term-gutter" aria-hidden="true"></pre>
        <div class="term-stack">
          <pre class="term-hl" aria-hidden="true"><code></code></pre>
          <textarea class="term-code" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Code editor"></textarea>
        </div>
      </div>
      <div class="term-console" role="log" aria-live="polite"><div class="term-line hint">Ready. Ctrl+Enter runs main().${opts.exerciseId ? " Test runs the checks and records your result." : ""}</div></div>`;

    const ta = el.querySelector("textarea");
    const gutter = el.querySelector(".term-gutter");
    const con = el.querySelector(".term-console");
    const starter = (opts.starter || "").replace(/^\n/, "");
    ta.value = (opts.storageKey && store(opts.storageKey)) || starter;

    const hl = el.querySelector(".term-hl code");
    const syncGutter = () => {
      const n = ta.value.split("\n").length;
      gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join("\n");
      hl.innerHTML = highlight(ta.value) + "\n";
      ta.style.height = "auto";
      ta.style.height = Math.max(ta.scrollHeight, 120) + "px";
    };
    syncGutter();
    ta.addEventListener("scroll", () => { hl.style.transform = `translateX(${-ta.scrollLeft}px)`; });
    ta.addEventListener("input", () => { syncGutter(); if (opts.storageKey) store(opts.storageKey, ta.value); });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        const s = ta.selectionStart, en = ta.selectionEnd;
        ta.setRangeText("  ", s, en, "end");
        ta.dispatchEvent(new Event("input"));
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        go("run");
      } else if (e.key === "Enter") {
        // keep indentation
        const s = ta.selectionStart;
        const lineStart = ta.value.lastIndexOf("\n", s - 1) + 1;
        const indent = (/^[ \t]*/.exec(ta.value.slice(lineStart, s)) || [""])[0];
        const extra = /[{([]\s*$/.test(ta.value.slice(lineStart, s)) ? "  " : "";
        e.preventDefault();
        ta.setRangeText("\n" + indent + extra, s, ta.selectionEnd, "end");
        ta.dispatchEvent(new Event("input"));
      }
    });

    const line = (text, kind = "out") => {
      const d = document.createElement("div");
      d.className = `term-line ${kind}`;
      d.textContent = text;
      con.appendChild(d);
      con.scrollTop = con.scrollHeight;
    };

    const image = (m) => {
      const fig = document.createElement("figure");
      fig.className = "term-image";
      const cv = document.createElement("canvas");
      cv.width = m.w; cv.height = m.h;
      cv.getContext("2d").putImageData(new ImageData(m.rgba, m.w, m.h), 0, 0);
      cv.style.width = Math.min(m.w * 2, 520) + "px";
      fig.appendChild(cv);
      if (m.label) { const c = document.createElement("figcaption"); c.textContent = m.label; fig.appendChild(c); }
      con.appendChild(fig);
      con.scrollTop = con.scrollHeight;
    };

    let worker = null;
    let busy = false;
    const kill = () => { if (worker) { worker.terminate(); worker = null; } };
    liveTerminals.add(kill);
    const buttons = () => el.querySelectorAll(".term-btn");

    function go(mode) {
      if (busy) return;
      busy = true;
      buttons().forEach((b) => (b.disabled = true));
      con.innerHTML = "";
      line(mode === "test" ? "$ running checks…" : "$ running main()…", "cmd");
      if (worker) worker.terminate();
      worker = new Worker("/static/sim/worker.js");
      const started = performance.now();
      const timer = setTimeout(() => {
        worker.terminate(); worker = null;
        line(`Stopped after ${TIMEOUT_MS / 1000}s. Is there an infinite loop, or a very large launch?`, "err");
        finish();
      }, TIMEOUT_MS);
      // A finished run's worker is terminated: idle workers hold the simulator's memory.
      const finish = () => { clearTimeout(timer); kill(); busy = false; buttons().forEach((b) => (b.disabled = false)); };
      worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === "out") line(m.text, m.kind);
        else if (m.type === "image") image(m);
        else if (m.type === "error") { line(`Error: ${m.message}`, "err"); finish(); }
        else if (m.type === "done") { line(`done in ${Math.round(performance.now() - started)} ms`, "dim"); finish(); }
        else if (m.type === "result") {
          for (const r of m.results) line(`${r.pass ? "✓" : "✗"} ${r.name}${r.detail ? `  (${r.detail})` : ""}`, r.pass ? "pass" : "fail");
          const n = m.results.filter((r) => r.pass).length;
          line(m.passed ? `All ${n} checks passed.` : `${n}/${m.results.length} checks passed.`, m.passed ? "pass strong" : "fail strong");
          finish();
          if (opts.onResult) opts.onResult(m.passed, m.results);
        }
      };
      worker.onerror = (ev) => { line(`Error: ${ev.message}`, "err"); finish(); };
      worker.postMessage({ mode, code: ta.value, exerciseUrl: opts.exerciseUrl, exerciseId: opts.exerciseId });
    }

    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      if (b.dataset.act === "reset") {
        if (ta.value !== starter && !confirm("Replace your code with the starter code?")) return;
        ta.value = starter; syncGutter(); if (opts.storageKey) store(opts.storageKey, null);
      } else go(b.dataset.act);
    });
    return el;
  }

  // Called by the router when leaving a page: stop any run still in progress.
  function stopAll() { liveTerminals.forEach((k) => k()); liveTerminals.clear(); }
  window.GWTerminal = { create, stopAll };
})();
