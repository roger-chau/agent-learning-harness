/* In-page terminal: a code editor + console that runs code in a Web Worker. */
(() => {
  "use strict";
  const TIMEOUT_MS = 15000;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val);
    } catch (e) { return null; }
    return null;
  }

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
        <textarea class="term-code" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Code editor"></textarea>
      </div>
      <div class="term-console" role="log" aria-live="polite"><div class="term-line hint">Ready. Ctrl+Enter runs main().${opts.exerciseId ? " Test runs the checks and records your result." : ""}</div></div>`;

    const ta = el.querySelector("textarea");
    const gutter = el.querySelector(".term-gutter");
    const con = el.querySelector(".term-console");
    const starter = (opts.starter || "").replace(/^\n/, "");
    ta.value = (opts.storageKey && store(opts.storageKey)) || starter;

    const syncGutter = () => {
      const n = ta.value.split("\n").length;
      gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join("\n");
      ta.style.height = "auto";
      ta.style.height = Math.max(ta.scrollHeight, 120) + "px";
    };
    syncGutter();
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
      const finish = () => { clearTimeout(timer); busy = false; buttons().forEach((b) => (b.disabled = false)); };
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

  window.GWTerminal = { create };
})();
