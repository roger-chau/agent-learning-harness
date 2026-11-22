/* Groundwork frontend: catalogue, course overview, chapter reader (exercises, quiz), Ask panel. */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const main = $("#main");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const LOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  const CLOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  const PENCIL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>';
  const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';

  // Exercise registry for scripts loaded into the page.
  window.GW = { exercises: {}, exercise(def) { this.exercises[def.id] = def; } };

  async function api(path, opts = {}) {
    const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).detail || msg; } catch (e) {}
      const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // ---------- Theme ----------
  $("#theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("gw-theme", next); } catch (e) {}
    // Canvas components read colours at draw time; nudge them.
    window.dispatchEvent(new Event("resize"));
  });

  // ---------- Markdown + math (Ask panel) ----------
  function renderMarkdown(src) {
    const math = [];
    const text = src.replace(/\$\$([\s\S]+?)\$\$/g, (m) => { math.push(m); return `@@MATH${math.length - 1}@@`; })
      .replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$/g, (m, pre, body) => { math.push(`$${body}$`); return `${pre}@@MATH${math.length - 1}@@`; });
    let html = window.marked ? window.marked.parse(text, { gfm: true }) : `<p>${esc(text)}</p>`;
    html = html.replace(/@@MATH(\d+)@@/g, (_, i) => esc(math[+i]));
    return window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
  }
  function typeset(el) {
    el.querySelectorAll("a[href^='http']").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(el, {
          delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }, { left: "\\[", right: "\\]", display: true }],
          throwOnError: false,
          ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
          ignoredClasses: ["term", "sim"],
        });
      } catch (e) {}
    }
  }

  // ---------- Shared pieces ----------
  const block = (n, name, tag, tone = "") =>
    `<div class="block ${tone}"><span class="n">${pad(n)}</span><span class="name">${esc(name)}</span><span class="tag">${esc(tag)}</span></div>`;

  function setNav(key) {
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === key));
  }

  const TRACK_TONE = { "GPU & compilers": "t-indigo", Companion: "t-mint", "Side track": "t-saffron", "Work track": "t-teal", Bridge: "t-rose" };

  // ---------- Catalogue ----------
  async function renderHome() {
    setNav("courses");
    main.innerHTML = `
      <section class="hero">
        <div class="container hero-grid">
          <div>
            <p class="eyebrow">Deep, hands-on courses</p>
            <h1 class="display"><span class="nowrap">Learn it from</span><br><span class="serif">first principles</span><span class="dot">.</span></h1>
            <p class="lede">Each course starts from the smallest true idea and builds the whole machine, one block at a time. Every idea has a picture, every chapter has a simulation you can drive, and you only move on once you've written code that works and passed the quiz.</p>
            <div class="btn-row">
              <a class="btn btn-primary" href="#/c/gpus-from-first-principles">Start the GPU course ${ARROW}</a>
              <a class="btn btn-ghost" href="#/about">How it works</a>
            </div>
          </div>
          <div class="stack-card lifted" aria-label="How every chapter is built">
            <div class="stack">
              ${block(1, "The real problem", "why it exists")}
              ${block(2, "The smallest idea", "one block", "t-indigo")}
              ${block(3, "Add one block", "compose", "t-indigo")}
              ${block(4, "The whole machine", "how parts interact", "t-indigo")}
              ${block(5, "Reality", "where it breaks", "t-saffron")}
            </div>
          </div>
        </div>
      </section>
      <section class="section" id="courses">
        <div class="container">
          <div class="section-head">
            <p class="eyebrow">The catalogue</p>
            <h2 class="h2">Courses</h2>
            <p>Each course is a complete path, not a collection of articles. Its long-running projects grow across Parts and end in a capstone.</p>
          </div>
          <div class="card-grid" id="catalog"><div class="empty-card">Loading…</div></div>
        </div>
      </section>`;
    try {
      const cat = await api("/api/catalog");
      $("#catalog").innerHTML = cat.map(courseCard).join("");
    } catch (err) {
      $("#catalog").innerHTML = `<div class="error-note">Couldn't load the catalogue: ${esc(err.message)}</div>`;
    }
  }

  function courseCard(c) {
    const available = c.status === "available";
    const tone = TRACK_TONE[c.track] || "t-indigo";
    if (!available) {
      return `<div class="course-card planned">
        <span class="pill indigo">${esc(c.track)}</span>
        <h3>${esc(c.title)}</h3>
        <p class="goal">${esc(c.summary)}</p>
        <span class="card-cta muted">Coming soon</span>
      </div>`;
    }
    const s = c.stats, p = c.progress;
    const pct = p.ready ? Math.round((100 * p.complete) / p.ready) : 0;
    return `<a class="course-card" href="#/c/${esc(c.slug)}">
      <div class="stack">
        ${block(1, "Why throughput machines", "Part 0")}
        ${block(2, "SIMT and warps", "Part 1", "t-indigo")}
        ${block(3, "Memory is the whole game", "Part 2", "t-indigo")}
        ${block(4, "GEMM to tensor cores", "Parts 4–6", "t-indigo")}
        ${block(5, "Fused attention", "capstone", "t-saffron")}
      </div>
      <span class="pill">${p.complete ? `${pct}% complete` : "Available now"}</span>
      <h3>${esc(c.title)}</h3>
      <p class="goal">${esc(c.summary)}</p>
      <div class="stats">
        <div class="stat"><div class="k">Parts</div><div class="v">${s.parts}</div></div>
        <div class="stat"><div class="k">Chapters</div><div class="v">${s.chapters}</div></div>
        <div class="stat"><div class="k">Projects</div><div class="v">${s.projects}</div></div>
        <div class="stat"><div class="k">Written</div><div class="v">${s.written}</div></div>
      </div>
      <span class="card-cta">${p.complete ? "Continue" : "Start the course"} ${ARROW}</span>
    </a>`;
  }

  // ---------- About ----------
  function renderAbout() {
    setNav("about");
    const steps = [
      ["Read", "Each chapter walks five blocks: the real problem, the smallest idea, one added block, the whole machine, and where it breaks in reality."],
      ["Play", "Diagrams for every idea, animations you can step through, and simulations you drive with sliders."],
      ["Practise", "Exercises run in an in-page terminal against a GPU simulator that measures coalescing, divergence and memory traffic. Passing them is required."],
      ["Quiz", "A short graded quiz closes every chapter, and a checkpoint quiz closes every Part. Answers are checked on the server."],
      ["Build", "Long-running projects grow across Parts in milestones, and the capstone reuses your own code."],
      ["Ask", "The Ask panel knows the chapter you're on. It answers questions and gives hints, never solutions."],
    ];
    main.innerHTML = `
      <section class="hero" style="padding-bottom:48px">
        <div class="container" style="position:relative;z-index:1">
          <p class="eyebrow">How it works</p>
          <h1 class="display" style="font-size:var(--text-3xl)">Read it, see it, <span class="serif">then prove it</span><span class="dot">.</span></h1>
          <p class="lede">Groundwork runs on your machine. Content is static and written chapter by chapter; your progress lives in <code>data/progress.json</code>.</p>
        </div>
      </section>
      <section class="section" style="padding-top:8px">
        <div class="container steps">
          ${steps.map(([h, p], i) => `<div class="step"><div class="n">${pad(i + 1)}</div><h3>${h}</h3><p>${p}</p></div>`).join("")}
        </div>
      </section>`;
  }

  // ---------- Course overview ----------
  const TYPE_LABEL = { chapter: "chapter", milestone: "milestone", checkpoint: "checkpoint", paper: "paper", scenario: "scenario", lab: "GPU lab", exam: "exam" };

  async function renderCourse(slug) {
    setNav("courses");
    main.innerHTML = `<div class="container" style="padding:48px 16px"><div class="empty-card">Loading…</div></div>`;
    let c;
    try { c = await api(`/api/courses/${slug}`); } catch (err) { return showError(err); }
    const s = c.stats, p = c.progress;
    let chapterNo = 0;
    main.innerHTML = `
      <section class="hero course-hero">
        <div class="container hero-grid">
          <div>
            <div class="crumbs"><a href="#/">Courses</a> / <span>${esc(c.title)}</span></div>
            <p class="eyebrow">${esc(c.tagline)}</p>
            <h1 class="display" style="font-size:var(--text-3xl)">${esc(c.title)}</h1>
            <p class="lede">${esc(c.description)}</p>
            <div class="chips">${c.chips.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>
            <div class="btn-row">
              ${p.next ? `<a class="btn btn-primary" href="#/c/${slug}/${p.next}">${p.complete ? "Continue" : "Start the course"} ${ARROW}</a>` : `<span class="pill">All written chapters complete</span>`}
            </div>
            <p class="save-note">Progress saves automatically on this computer.
              <button type="button" class="linkish" id="pg-export">Download a backup</button> ·
              <button type="button" class="linkish" id="pg-import">Restore from a backup</button>
              <input type="file" id="pg-file" accept="application/json,.json" hidden></p>
          </div>
          <div class="stack-card lifted">
            <div class="stats big">
              <div class="stat"><div class="k">Parts</div><div class="v">${s.parts}</div></div>
              <div class="stat"><div class="k">Chapters</div><div class="v">${s.chapters}</div></div>
              <div class="stat"><div class="k">Projects</div><div class="v">${s.projects}</div></div>
              <div class="stat"><div class="k">Papers</div><div class="v">${s.papers}</div></div>
            </div>
            <div class="progress-bar" aria-label="Progress"><i style="width:${p.ready ? (100 * p.complete) / p.ready : 0}%"></i></div>
            <p class="muted small">${p.complete} of ${p.ready} written items complete · ${s.written} of ${s.chapters} chapters written so far</p>
            <div class="companions">
              <div class="k">Companions</div>
              ${c.companions.map((x) => `<div class="comp"><b>${esc(x.title)}</b> <span class="muted">${esc(x.by)}</span></div>`).join("")}
            </div>
          </div>
        </div>
      </section>
      <section class="section" style="padding-top:24px">
        <div class="container">
          <div class="section-head"><p class="eyebrow">Projects</p><h2 class="h2">What you'll build</h2>
            <p>Long-running projects grow across Parts in milestones. The capstone reuses your own code.</p></div>
          <div class="project-grid">
            ${c.projects.map((x) => `<div class="project"><div class="pid">${esc(x.id)}</div><h3>${esc(x.title)}</h3><p>${esc(x.summary)}</p><span class="chip">${esc(x.runs)}</span></div>`).join("")}
          </div>
        </div>
      </section>
      <section class="section" style="padding-top:8px">
        <div class="container">
          <div class="section-head"><p class="eyebrow">Syllabus</p><h2 class="h2">Parts and chapters</h2>
            <p>Each chapter unlocks when the one before it is complete: exercises passed and quiz at 80% or better.</p></div>
          <div class="parts">
            ${c.parts.map((part) => `
              <div class="part">
                <div class="part-head"><span class="part-n">Part ${part.n}</span><h3>${esc(part.title)}</h3><p>${esc(part.summary)}</p>${part.hp ? `<p class="hp"><span>H&amp;P 7e</span> ${esc(part.hp)}</p>` : ""}</div>
                <div class="stack">
                  ${part.items.map((it) => {
                    const n = it.type === "chapter" ? ++chapterNo : null;
                    const icon = it.state === "complete" ? CHECK : it.state === "open" ? "" : LOCK;
                    const tone = it.state === "complete" ? "t-mint" : it.state === "open" ? "t-indigo" : it.type === "milestone" ? "t-saffron" : it.type === "paper" ? "t-rose" : it.type === "scenario" ? "t-mint" : it.type === "lab" ? "t-saffron" : "t-empty";
                    const tag = it.state === "planned" ? "coming soon" : it.state === "locked" ? "locked" : TYPE_LABEL[it.type];
                    const label = it.type === "chapter" ? `${it.id.replace("-", ".")}  ${it.title}` : it.title;
                    const inner = `<span class="n">${it.type === "chapter" ? pad(n) : it.type === "milestone" ? "◆" : it.type === "paper" ? "¶" : it.type === "scenario" ? "★" : it.type === "lab" ? "▣" : "✓"}</span><span class="name">${esc(label)}</span><span class="tag">${icon} ${esc(tag)}</span>`;
                    return it.state === "open" || it.state === "complete"
                      ? `<a class="block ${tone} link" href="#/c/${slug}/${it.id}">${inner}</a>`
                      : `<div class="block ${tone}" title="${it.state === "locked" ? `Complete ${esc(it.blocked_by)} first` : "Not written yet"}">${inner}</div>`;
                  }).join("")}
                </div>
              </div>`).join("")}
          </div>
        </div>
      </section>`;
    setupBackup();
  }

  // ---------- Reader ----------
  const reader = { slug: null, item: null, course: null };

  async function renderItem(slug, itemId) {
    setNav("courses");
    // Keep the current page on screen while the next one loads (no blank flash); only show a
    // loading card if the server is slow.
    const navId = ++navSeq;
    const slow = setTimeout(() => { if (navId === navSeq) main.innerHTML = `<div class="container" style="padding:48px 16px"><div class="empty-card">Loading…</div></div>`; }, 400);
    let it, c;
    try {
      [it, c] = await Promise.all([api(`/api/courses/${slug}/items/${itemId}`), api(`/api/courses/${slug}`)]);
    } catch (err) {
      clearTimeout(slow);
      return showError(err, slug);
    } finally { clearTimeout(slow); }
    if (navId !== navSeq) return;  // the user already clicked elsewhere
    window.scrollTo(0, 0);
    Object.assign(reader, { slug, item: it, course: c });
    const chNum = it.type === "chapter" ? it.id.replace("-", ".") : null;
    const kicker = it.type === "chapter" ? `Part ${it.part.n} · Chapter ${chNum}` : it.type === "milestone" ? `Part ${it.part.n} · Project milestone` : it.type === "paper" ? `Part ${it.part.n} · Paper` : it.type === "scenario" ? `Part ${it.part.n} · Real-world scenario` : it.type === "lab" ? `Part ${it.part.n} · Real-GPU lab` : it.type === "exam" ? `Part ${it.part.n} · Timed exam` : `Part ${it.part.n} · Checkpoint`;

    main.innerHTML = `
      <div class="reader container">
        <aside class="toc" aria-label="Course contents">
          <a class="toc-course" href="#/c/${slug}">${esc(c.title)}</a>
          ${c.parts.map((p) => `
            <div class="toc-part ${p.id === it.part.id ? "current" : ""}">
              <div class="toc-part-t">Part ${p.n}. ${esc(p.title)}</div>
              ${p.id === it.part.id || p.items.some((x) => x.state === "open") ? p.items.map((x) => {
                const cls = `${x.id === it.id ? "here" : ""} ${x.state}`;
                const mark = x.state === "complete" ? "✓" : x.state === "open" ? "•" : "·";
                const lab = x.type === "chapter" ? `${x.id.replace("-", ".")} ${x.title}` : x.title;
                return x.state === "open" || x.state === "complete"
                  ? `<a class="toc-item ${cls}" href="#/c/${slug}/${x.id}"><span>${mark}</span>${esc(lab)}</a>`
                  : `<span class="toc-item ${cls}"><span>${mark}</span>${esc(lab)}</span>`;
              }).join("") : ""}
            </div>`).join("")}
        </aside>
        <article class="chapter">
          <header class="ch-head">
            <p class="eyebrow">${esc(kicker)}</p>
            <h1 class="ch-title">${esc(it.title)}</h1>
            ${it.summary ? `<p class="ch-sub">${esc(it.summary)}</p>` : ""}
            ${it.estimate ? `<p class="ch-meta"><span title="Reading time">${CLOCK} ${it.estimate.reading} min read</span>${it.estimate.practice ? `<span title="Exercises, problems and quiz">${PENCIL} about ${fmtMins(it.estimate.practice)} of practice</span>` : ""}${it.problems ? `<span>${it.problems.problems.length} problems</span>` : ""}${it.exercises.length ? `<span>${it.exercises.length} coding ${it.exercises.length > 1 ? "exercises" : "exercise"}</span>` : ""}</p>` : ""}
            ${it.part.hp && it.type === "chapter" ? `<p class="hp"><span>H&amp;P 7e</span> ${esc(it.part.hp)}</p>` : ""}
            ${it.blocks.length ? `<div class="stack ch-chain">${it.blocks.map(([name, tag], i) =>
              `<a class="block ${i === 0 ? "" : i === 4 ? "t-saffron" : "t-indigo"} link" href="#b${i + 1}" data-jump="b${i + 1}">
                <span class="n">${pad(i + 1)}</span><span class="name">${esc(name)}</span><span class="tag">${esc(tag)}</span></a>`).join("")}</div>` : ""}
          </header>
          <div class="ch-body prose" id="ch-body">${it.html}</div>
          ${it.exercises.length ? `<section class="practice" id="practice"><p class="eyebrow">Practice</p><h2>${it.type === "scenario" ? "Your solution" : "Exercises"}</h2>
            <p class="muted">Pass every exercise${it.problems ? ", the problem set" : ""}${it.quiz ? " and the quiz" : ""} to complete the chapter. Your code is saved in this browser as you type.</p>
            <div id="exercises"></div></section>` : ""}
          ${it.lab ? `<section class="practice lab" id="lab-sec"><p class="eyebrow">${it.lab.cloud ? "Real GPU · rented Ampere/Hopper" : "Real GPU · your RTX 2060 Super"}</p><h2>Run it</h2>
            <p class="muted">In a terminal on the machine with the GPU, from your clone of this repository:</p>
            <pre class="lab-cmd"><code>cd courses/gpus-from-first-principles/${esc(it.lab.dir)}
make run        # build, test correctness, measure; writes results.json
make submit     # record the results here (Groundwork must be running)</code></pre>
            <p class="muted small">Other targets: <code>make regs</code> (registers and spills), <code>make ptx</code>, <code>make sass</code>, <code>make ncu</code> (Nsight Compute), <code>make nsys</code> (Nsight Systems). Not on a 20-series card? Add <code>ARCH=sm_86</code> (30-series), <code>sm_89</code> (40-series) or <code>sm_80</code>/<code>sm_90</code> (A100/H100).</p>
            ${it.lab.targets.length ? `<table class="lab-targets"><thead><tr><th>Target</th><th>Needed</th><th>Your best run</th></tr></thead><tbody id="lab-tbody"></tbody></table>` : ""}
            <div class="quiz-actions"><button class="btn btn-ghost btn-sm" type="button" id="lab-refresh">Check for new results</button><span class="muted" id="lab-status"></span></div>
          </section>` : ""}
          ${it.problems ? `<section class="practice" id="problems-sec"><p class="eyebrow">Problem set</p><h2>Practice problems</h2>
            <p class="muted">Solve at least ${Math.round(it.problems.pass * 100)}% to complete the chapter. ★ mechanics · ★★ analysis · ★★★ design. Hints are free; a worked solution unlocks when you solve a problem, or after ${2} tries if you give up (then it doesn't count).</p>
            <div class="ps-progress" id="ps-progress"></div>
            <div id="problems" class="problems"></div></section>` : ""}
          ${it.writeup ? `<section class="practice" id="writeup-sec"><p class="eyebrow">Design notes</p><h2>Write-up</h2>
            <p class="muted">At least ${it.writeup.min_words} words. Cover:</p>
            <ul class="wu-prompts">${it.writeup.prompts.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
            <textarea class="field wu-text" id="wu-text" rows="12" placeholder="What you measured, what you tried, what you chose and why…"></textarea>
            <div class="quiz-actions"><button class="btn btn-primary" type="button" id="wu-save">Save write-up</button>
              <button class="btn btn-ghost" type="button" id="wu-review">Ask for a review</button>
              <span class="quiz-score muted" id="wu-count"></span></div></section>` : ""}
          ${it.quiz ? `<section class="practice" id="quiz-sec"><p class="eyebrow">Check yourself</p><h2>${it.type === "checkpoint" ? "Checkpoint quiz" : "Quiz"}</h2>
            <p class="muted">Pass mark ${Math.round(it.quiz.pass * 100)}%. Retake it as many times as you like; explanations appear for questions you get right.</p>
            <form id="quiz" class="quiz"></form></section>` : ""}
          ${it.exam ? `<section class="practice exam" id="exam-sec"><p class="eyebrow">Exam</p><h2>${esc(it.title)}</h2><div id="exam"></div></section>` : ""}
          <div class="gate" id="gate"></div>
        </article>
      </div>
      ${it.exam ? "" : `<button class="ask-fab" id="ask-open" type="button" aria-haspopup="dialog">Ask a question</button>`}
      ${it.exam ? "" : `<aside class="ask" id="ask" aria-label="Ask a question" hidden>
        <div class="ask-head"><div><b>Ask</b><span class="muted"> · knows this chapter · hints, not solutions</span></div>
          <div><button class="term-btn" id="ask-clear" type="button">Clear</button><button class="icon-btn small" id="ask-close" type="button" aria-label="Close">✕</button></div></div>
        <div class="ask-thread" id="ask-thread"></div>
        <form class="ask-form" id="ask-form"><textarea id="ask-input" rows="2" placeholder="Ask anything about this chapter…" aria-label="Question"></textarea><button class="btn btn-primary btn-sm" type="submit">Ask</button></form>
      </aside>`}`;

    const body = $("#ch-body");
    setupReadBar();
    window.GWComponents.mount(body);
    typeset(body);
    body.querySelectorAll("section.blk").forEach((s, i) => { if (!s.id) s.id = `b${i + 1}`; });
    main.querySelectorAll("[data-jump]").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      const t = document.getElementById(a.dataset.jump);
      if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
    }));

    await renderExercises(slug, it);
    renderProblems(slug, it);
    if (it.lab) setupLab(slug, it);
    renderQuiz(slug, it);
    renderGate(it.state, it);
    if (it.exam) setupExam(slug, it); else setupAsk(slug, it);
    if (it.writeup) setupWriteup(slug, it);
    if (!it.exam && !it.exercises.length && !it.quiz && it.state.state === "open") {
      api(`/api/courses/${slug}/items/${it.id}/read`, { method: "POST" }).then((r) => renderGate(r.state, it)).catch(() => {});
    }
  }

  // Reading progress: a bar under the site header that fills as you scroll through the chapter.
  // Cheap on purpose: the chapter's extent is measured only on load and resize, scroll events
  // are coalesced to one update per frame, and the bar moves with a transform (no layout, no
  // repaint of the header).
  let readBar = null;
  function setupReadBar() {
    hideReadBar();
    const bar = document.getElementById("read-bar"), fill = bar && bar.firstElementChild;
    const art = document.querySelector("article.chapter, #ch-body");
    if (!bar || !art) return;
    bar.hidden = false;
    let start = 0, span = 1, queued = false;
    const measure = () => {
      const startEl = document.querySelector(".ch-head") || art, endEl = document.getElementById("gate") || art;
      start = startEl.getBoundingClientRect().top + window.scrollY;
      const end = endEl.getBoundingClientRect().bottom + window.scrollY;
      span = Math.max(1, end - start - window.innerHeight);
    };
    const paint = () => {
      queued = false;
      const p = Math.min(1, Math.max(0, (window.scrollY - start + 64) / span));
      fill.style.transform = `scaleX(${p.toFixed(4)})`;
    };
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
    const onResize = () => { measure(); onScroll(); };
    // The chapter grows as figures mount and math renders: re-measure when its size changes.
    const ro = "ResizeObserver" in window ? new ResizeObserver(onResize) : null;
    if (ro) ro.observe(art);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    readBar = { onScroll, onResize, ro };
    onResize();
  }
  function hideReadBar() {
    const bar = document.getElementById("read-bar");
    if (bar) bar.hidden = true;
    if (readBar) {
      window.removeEventListener("scroll", readBar.onScroll);
      window.removeEventListener("resize", readBar.onResize);
      if (readBar.ro) readBar.ro.disconnect();
      readBar = null;
    }
  }
  const fmtMins = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`couldn't load ${src}`));
      document.head.appendChild(s);
    });
  }

  async function renderExercises(slug, it) {
    const box = $("#exercises");
    if (!box) return;
    for (const [i, exId] of it.exercises.entries()) {
      const url = `/content/${slug}/exercises/${exId}.js`;
      if (!window.GW.exercises[exId]) {
        try { await loadScript(url); } catch (e) { box.insertAdjacentHTML("beforeend", `<div class="error-note">${esc(e.message)}</div>`); continue; }
      }
      const ex = window.GW.exercises[exId];
      const passed = it.state.exercises[exId];
      const wrap = document.createElement("div");
      wrap.className = "exercise";
      wrap.innerHTML = `
        <div class="ex-head"><span class="ex-n">Exercise ${i + 1}</span><h3>${esc(ex.title)}</h3>
          <span class="ex-status ${passed ? "ok" : ""}" data-ex-status="${esc(exId)}">${passed ? `${CHECK} passed` : "not passed yet"}</span></div>
        <div class="prose ex-prompt">${ex.prompt}</div>`;
      const term = window.GWTerminal.create({
        title: ex.file || `${exId}.js`,
        starter: ex.starter,
        storageKey: `gw-ex-${slug}-${exId}`,
        exerciseUrl: url,
        exerciseId: exId,
        onResult: async (ok, results) => {
          try {
            const r = await api(`/api/courses/${slug}/items/${it.id}/exercises/${exId}`, {
              method: "POST", body: JSON.stringify({ passed: ok, results }),
            });
            const st = wrap.querySelector("[data-ex-status]");
            if (r.state.exercises[exId]) { st.innerHTML = `${CHECK} passed`; st.classList.add("ok"); }
            renderGate(r.state, it);
          } catch (e) { /* recorded next time */ }
        },
      });
      wrap.appendChild(term);
      box.appendChild(wrap);
      typeset(wrap.querySelector(".ex-prompt"));
    }
  }

  function renderProblems(slug, it) {
    const box = $("#problems");
    if (!box || !it.problems) return;
    const rec = () => it.state.problems || {};
    const stars = (n) => "★".repeat(n || 1);
    const progressLine = () => {
      const solved = it.problems.problems.filter((p) => (rec()[p.id] || {}).solved).length, n = it.problems.problems.length;
      const need = Math.ceil(it.problems.pass * n - 1e-9);
      $("#ps-progress").innerHTML = `<div class="ps-bar"><span style="width:${(100 * solved) / n}%"></span></div><span class="muted">${solved} of ${n} solved · ${solved >= need ? "set complete" : `${need - solved} more to complete the set`}</span>`;
    };
    box.innerHTML = it.problems.problems.map((p, k) => {
      const r = rec()[p.id] || {};
      const parts = p.parts.map((q) => {
        let input;
        if (q.type === "single") input = q.options.map((o, i) => `<label class="opt"><input type="radio" name="${esc(q.id)}" value="${i}"> <span>${o}</span></label>`).join("");
        else if (q.type === "multi") input = q.options.map((o, i) => `<label class="opt"><input type="checkbox" name="${esc(q.id)}" value="${i}"> <span>${o}</span></label>`).join("");
        else input = `<div class="num"><input class="field" name="${esc(q.id)}" inputmode="decimal" autocomplete="off" placeholder="Answer">${q.unit ? `<span class="muted">${esc(q.unit)}</span>` : ""}</div>`;
        return `<div class="pp" data-part="${esc(q.id)}"><div class="pp-prompt"><b>(${esc(q.id)})</b> ${q.prompt}</div>${input}<span class="pp-mark"></span></div>`;
      }).join("");
      return `<form class="prob ${r.solved ? "solved" : ""}" data-pid="${esc(p.id)}">
        <div class="prob-head"><span class="prob-n">Problem ${k + 1}</span><span class="prob-lvl">${stars(p.level)}</span><b>${esc(p.title || "")}</b><span class="prob-status">${r.solved ? "✓ solved" : r.revealed ? "solution shown" : r.attempts ? `${r.attempts} attempt${r.attempts > 1 ? "s" : ""}` : ""}</span></div>
        <div class="prob-stmt">${p.statement || ""}</div>
        ${parts}
        <div class="prob-actions"><button class="btn btn-primary btn-sm" type="submit">Check</button>
          ${(p.hints || []).length ? `<button class="btn btn-ghost btn-sm" type="button" data-act="hint">Hint (${p.hints.length})</button>` : ""}
          <button class="btn btn-ghost btn-sm" type="button" data-act="reveal">Show solution</button>
          <span class="prob-msg muted"></span></div>
        <div class="prob-hints"></div>
        <div class="prob-sol" hidden></div>
      </form>`;
    }).join("");
    typeset(box);
    progressLine();
    const showSolution = (form, res) => {
      const sol = form.querySelector(".prob-sol");
      const ans = Object.entries(res.answers || {}).map(([k, v]) => `<b>(${esc(k)})</b> ${esc(Array.isArray(v) ? v.map((i) => i + 1).join(", ") : String(v))}`).join(" · ");
      sol.innerHTML = `<p class="eyebrow">Worked solution</p>${res.solution || ""}${ans ? `<p class="muted small">Answers: ${ans}</p>` : ""}`;
      sol.hidden = false; typeset(sol);
    };
    box.querySelectorAll("form.prob").forEach((form) => {
      const p = it.problems.problems.find((x) => x.id === form.dataset.pid);
      let hintN = 0;
      form.addEventListener("click", async (e) => {
        const b = e.target.closest("button[data-act]");
        if (!b) return;
        const msg = form.querySelector(".prob-msg");
        if (b.dataset.act === "hint") {
          if (hintN < p.hints.length) {
            const d = document.createElement("div"); d.className = "callout"; d.innerHTML = `<b>Hint ${hintN + 1}.</b> ${p.hints[hintN]}`;
            form.querySelector(".prob-hints").appendChild(d); typeset(d); hintN++;
            b.textContent = hintN < p.hints.length ? `Next hint (${p.hints.length - hintN})` : "No more hints"; if (hintN >= p.hints.length) b.disabled = true;
          }
        } else if (b.dataset.act === "reveal") {
          try {
            const r = await api(`/api/courses/${slug}/items/${it.id}/problems/${p.id}/reveal`, { method: "POST" });
            showSolution(form, r); it.state = r.state; form.querySelector(".prob-status").textContent = r.record.solved ? "✓ solved" : "solution shown"; progressLine(); renderGate(r.state, it);
          } catch (err) { msg.textContent = err.message; }
        }
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const answers = {};
        for (const q of p.parts) {
          if (q.type === "multi") answers[q.id] = [...form.querySelectorAll(`input[name="${CSS.escape(q.id)}"]:checked`)].map((x) => +x.value);
          else if (q.type === "single") { const c = form.querySelector(`input[name="${CSS.escape(q.id)}"]:checked`); answers[q.id] = c ? +c.value : null; }
          else answers[q.id] = form.querySelector(`input[name="${CSS.escape(q.id)}"]`).value;
        }
        const msg = form.querySelector(".prob-msg");
        try {
          const r = await api(`/api/courses/${slug}/items/${it.id}/problems/${p.id}`, { method: "POST", body: JSON.stringify({ answers }) });
          for (const [pid, ok] of Object.entries(r.parts)) {
            const el = form.querySelector(`.pp[data-part="${CSS.escape(pid)}"]`);
            el.classList.toggle("right", ok); el.classList.toggle("wrong", !ok);
            el.querySelector(".pp-mark").textContent = ok ? "✓" : "✗";
          }
          it.state = r.state;
          form.classList.toggle("solved", !!r.record.solved);
          form.querySelector(".prob-status").textContent = r.record.solved ? "✓ solved" : r.record.revealed ? "solution shown" : `${r.record.attempts} attempt${r.record.attempts > 1 ? "s" : ""}`;
          msg.textContent = r.solved ? "Correct." : `${Object.values(r.parts).filter(Boolean).length} of ${p.parts.length} parts right.`;
          if (r.solution !== undefined) showSolution(form, r);
          progressLine(); renderGate(r.state, it);
        } catch (err) { msg.textContent = err.message; }
      });
    });
  }

  function setupLab(slug, it) {
    const status = $("#lab-status"), tbody = $("#lab-tbody");
    const show = (rec) => {
      const last = rec && rec.last;
      if (tbody) {
        tbody.innerHTML = it.lab.targets.map((t) => {
          const lt = last && (last.targets || []).find((x) => x.metric === t.metric);
          const v = lt && typeof lt.value === "number" ? +lt.value.toFixed(2) : "–";
          return `<tr class="${lt ? (lt.met ? "met" : "missed") : ""}"><td>${esc(t.label || t.metric)}</td><td>${esc(t.op || ">=")} ${t.value}</td><td>${v}${lt ? (lt.met ? " ✓" : " ✗") : ""}</td></tr>`;
        }).join("");
      }
      status.textContent = !rec ? "No results submitted yet." :
        `${rec.passed ? "Passed" : "Not passed yet"} · ${rec.submissions} submission${rec.submissions > 1 ? "s" : ""}` +
        (last && last.device ? ` · last run on ${last.device.name}` : "") +
        (last && last.checks && Object.values(last.checks).some((x) => !x) ? " · a correctness check failed" : "");
    };
    show(it.lab_record);
    const refresh = async () => {
      try {
        const r = await api(`/api/courses/${slug}/items/${it.id}`);
        if (JSON.stringify(r.lab_record) !== JSON.stringify(it.lab_record)) { it.lab_record = r.lab_record; it.state = r.state; show(r.lab_record); renderGate(r.state, it); }
      } catch (e) { /* ignore */ }
    };
    $("#lab-refresh").addEventListener("click", refresh);
    const timer = setInterval(() => { if (!document.body.contains($("#lab-sec") || document.createElement("i"))) clearInterval(timer); else if (!document.hidden) refresh(); }, 5000);
  }

  function renderQuiz(slug, it) {
    const form = $("#quiz");
    if (!form || !it.quiz) return;
    const prev = it.state.quiz;
    form.innerHTML = it.quiz.questions.map((q, i) => {
      let input = "";
      if (q.type === "single" || q.type === "multi") {
        const t = q.type === "single" ? "radio" : "checkbox";
        input = `<div class="opts">${q.options.map((o, k) =>
          `<label class="opt"><input type="${t}" name="${esc(q.id)}" value="${k}"><span>${o}</span></label>`).join("")}</div>`;
      } else if (q.type === "numeric") {
        input = `<div class="num"><input class="field" name="${esc(q.id)}" inputmode="decimal" autocomplete="off" placeholder="Your answer">${q.unit ? `<span class="muted">${esc(q.unit)}</span>` : ""}</div>`;
      }
      return `<fieldset class="q" data-q="${esc(q.id)}"><legend><span class="qn">Q${i + 1}</span> ${q.prompt}${q.type === "multi" ? ' <span class="muted small">(select all that apply)</span>' : ""}</legend>${input}<div class="q-fb"></div></fieldset>`;
    }).join("") + `<div class="quiz-actions"><button class="btn btn-primary" type="submit">Submit answers</button>
      <span class="quiz-score muted">${prev ? `Best so far: ${Math.round(prev.best * 100)}%${prev.passed ? " · passed" : ""} (${prev.attempts} attempt${prev.attempts > 1 ? "s" : ""})` : ""}</span></div>`;
    typeset(form);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const answers = {};
      for (const q of it.quiz.questions) {
        if (q.type === "single") { const c = form.querySelector(`input[name="${CSS.escape(q.id)}"]:checked`); answers[q.id] = c ? +c.value : null; }
        else if (q.type === "multi") answers[q.id] = [...form.querySelectorAll(`input[name="${CSS.escape(q.id)}"]:checked`)].map((x) => +x.value);
        else answers[q.id] = form.querySelector(`input[name="${CSS.escape(q.id)}"]`).value;
      }
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        const r = await api(`/api/courses/${slug}/items/${it.id}/quiz`, { method: "POST", body: JSON.stringify({ answers }) });
        for (const res of r.results) {
          const fs = form.querySelector(`[data-q="${CSS.escape(res.id)}"]`);
          fs.classList.toggle("right", res.correct);
          fs.classList.toggle("wrong", !res.correct);
          fs.querySelector(".q-fb").innerHTML = res.correct
            ? `<b>Correct.</b> ${res.explanation || ""}`
            : `<b>Not quite.</b> ${r.passed ? res.explanation || "" : "Revisit the chapter and try again."}`;
          typeset(fs.querySelector(".q-fb"));
        }
        form.querySelector(".quiz-score").textContent =
          `${r.correct}/${r.total} (${Math.round(r.score * 100)}%) · ${r.passed ? "passed" : `need ${Math.round(it.quiz.pass * 100)}% to pass`}`;
        renderGate(r.state, it);
      } catch (err) {
        form.querySelector(".quiz-score").textContent = err.message;
      } finally { btn.disabled = false; }
    });
  }

  function setupWriteup(slug, it) {
    const ta = $("#wu-text"), count = $("#wu-count");
    const key = `gw-wu-${slug}-${it.id}`;
    let draft = null; try { draft = localStorage.getItem(key); } catch (e) {}
    ta.value = draft ?? it.writeup_text ?? "";
    const words = () => (ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0);
    const upd = () => { count.textContent = `${words()} / ${it.writeup.min_words} words${it.writeup_text && ta.value === it.writeup_text ? " · saved" : ""}`; };
    ta.addEventListener("input", () => { try { localStorage.setItem(key, ta.value); } catch (e) {} upd(); });
    upd();
    $("#wu-save").addEventListener("click", async () => {
      try {
        const r = await api(`/api/courses/${slug}/items/${it.id}/writeup`, { method: "POST", body: JSON.stringify({ text: ta.value }) });
        it.writeup_text = ta.value; upd();
        count.textContent += words() < it.writeup.min_words ? " · too short to count yet" : "";
        renderGate(r.state, it);
      } catch (e) { count.textContent = e.message; }
    });
    $("#wu-review").addEventListener("click", () => {
      $("#ask-open").click();
      const q = $("#ask-input");
      q.value = `Please review my design write-up for this scenario like a senior engineer would.\n\n---\n${ta.value}`;
      q.focus();
    });
  }

  function renderGate(state, it) {
    const g = $("#gate");
    if (!g) return;
    const exLeft = Object.values(state.exercises || {}).filter((v) => !v).length;
    const quizLeft = it.quiz && !(state.quiz && state.quiz.passed);
    const wuLeft = it.writeup && (state.writeup_words || 0) < it.writeup.min_words;
    const labLeft = it.lab && !(it.lab_record && it.lab_record.passed);
    const psLeft = (() => {
      if (!it.problems) return 0;
      const n = it.problems.problems.length, need = Math.ceil(it.problems.pass * n - 1e-9);
      const solved = it.problems.problems.filter((p) => ((state.problems || {})[p.id] || {}).solved).length;
      return Math.max(0, need - solved);
    })();
    const done = state.state === "complete";
    const nextLink = it.next ? `#/c/${reader.slug}/${it.next}` : `#/c/${reader.slug}`;
    g.className = `gate ${done ? "done" : ""}`;
    g.innerHTML = done
      ? `<div><b>${CHECK} Complete.</b> ${it.next ? "The next chapter is unlocked." : "That's everything written so far."}</div>
         <a class="btn btn-primary" href="${nextLink}">${it.next ? "Next" : "Back to course"} ${ARROW}</a>`
      : `<div><b>${LOCK} Next chapter locked.</b> ${[exLeft ? `${exLeft} check${exLeft > 1 ? "s" : ""} to pass` : "", labLeft ? "lab results to submit" : "", psLeft ? `${psLeft} problem${psLeft > 1 ? "s" : ""} to solve` : "", quizLeft ? "quiz to pass" : "", wuLeft ? "write-up to save" : ""].filter(Boolean).join(" · ") || "Finishing up…"}</div>
         <button class="btn btn-ghost" type="button" disabled>Next ${ARROW}</button>`;
    // keep the TOC in sync
    if (done) {
      const here = document.querySelector(".toc-item.here span");
      if (here) here.textContent = "✓";
    }
  }

  // ---------- Ask panel ----------
  // ---------- Exams ----------
  // Timed, closed-book: problems appear only when an attempt starts, with no hints and no Ask
  // panel. Answers are kept in this browser while you work (a reload doesn't lose them) and
  // graded on the server when you submit, or automatically when time runs out.
  let examTimer = null;
  function stopExamTimer() { if (examTimer) { clearInterval(examTimer); examTimer = null; } }
  const fmtClock = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h ? h + ":" : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(x).padStart(2, "0")}`; };
  function partInput(q, name) {
    if (q.type === "single") return q.options.map((o, i) => `<label class="opt"><input type="radio" name="${name}" value="${i}"> <span>${o}</span></label>`).join("");
    if (q.type === "multi") return q.options.map((o, i) => `<label class="opt"><input type="checkbox" name="${name}" value="${i}"> <span>${o}</span></label>`).join("");
    return `<div class="num"><input class="field" name="${name}" inputmode="decimal" autocomplete="off" placeholder="Answer">${q.unit ? `<span class="muted">${esc(q.unit)}</span>` : ""}</div>`;
  }
  function setupExam(slug, it) {
    const box = $("#exam");
    const info = it.exam;
    const skew = Date.now() / 1000 - info.now;  // server clock → browser clock
    const history = () => info.attempts.length ? `<table class="lab-targets"><thead><tr><th>Attempt</th><th>Score</th><th>Result</th></tr></thead><tbody>${info.attempts.map((a, i) =>
      `<tr><td>${i + 1} · ${new Date(a.started * 1000).toLocaleString()}</td><td>${Math.round(100 * a.score)}%${a.total ? ` (${a.correct}/${a.total})` : ""}</td><td>${a.passed ? "✓ passed" : a.expired ? "not submitted" : a.late ? "late" : "not passed"}</td></tr>`).join("")}</tbody></table>` : "";
    const intro = () => {
      const wait = info.next_attempt_at ? info.next_attempt_at - info.now : 0;
      box.innerHTML = `<ul class="exam-rules">
          <li><b>${info.count} problems</b> (${info.parts} graded parts, partial credit per part), <b>${info.minutes} minutes</b>. Pass mark ${Math.round(info.pass * 100)}%.</li>
          <li>Closed book: no hints, no Ask panel, no worked solutions until you submit. Paper, pencil and a calculator are fine, as in any exam.</li>
          <li>The clock starts when you press Start and keeps running if you leave the page. It submits automatically when time runs out.</li>
          <li>One attempt every 12 hours. Your best score counts.</li></ul>
        ${history()}
        <div class="quiz-actions">${wait > 0 ? `<span class="muted">Next attempt opens in ${fmtClock(wait)}.</span>` : `<button class="btn btn-primary" type="button" id="exam-start">${info.attempts.length ? "Start a new attempt" : "Start the exam"}</button>`}</div>`;
      const b = $("#exam-start");
      if (b) b.addEventListener("click", async () => {
        if (!info.active && !confirm(`Start the ${info.minutes}-minute exam now?`)) return;
        try { sit(await api(`/api/courses/${slug}/items/${it.id}/exam/start`, { method: "POST" })); } catch (e) { alert(e.message); }
      });
    };
    const sit = (att) => {
      const key = `gw-exam-${slug}-${it.id}-${Math.floor(att.active.started)}`;
      let saved = {}; try { saved = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) {}
      box.innerHTML = `<div class="exam-clock" id="exam-clock"></div>
        <form id="exam-form">${att.paper.map((p, k) => `
          <div class="prob" data-pid="${esc(p.id)}">
            <div class="prob-head"><span class="prob-n">Problem ${k + 1}</span><span class="prob-lvl">${"★".repeat(p.level || 1)}</span><b>${esc(p.title || "")}</b></div>
            <div class="prob-stmt">${p.statement || ""}</div>
            ${p.parts.map((q) => `<div class="pp"><div class="pp-prompt"><b>(${esc(q.id)})</b> ${q.prompt}</div>${partInput(q, `${p.id}::${q.id}`)}</div>`).join("")}
          </div>`).join("")}
          <div class="quiz-actions"><button class="btn btn-primary" type="submit">Submit the exam</button><span class="muted" id="exam-msg">Answers are saved in this browser as you go.</span></div>
        </form>`;
      typeset(box);
      const form = $("#exam-form");
      Object.entries(saved).forEach(([name, v]) => form.querySelectorAll(`[name="${CSS.escape(name)}"]`).forEach((el) => {
        if (el.type === "radio" || el.type === "checkbox") el.checked = [].concat(v).map(String).includes(el.value); else el.value = v;
      }));
      const collect = () => {
        const flat = {}, nested = {};
        att.paper.forEach((p) => p.parts.forEach((q) => {
          const name = `${p.id}::${q.id}`, els = [...form.querySelectorAll(`[name="${CSS.escape(name)}"]`)];
          let v;
          if (q.type === "multi") v = els.filter((e) => e.checked).map((e) => +e.value);
          else if (q.type === "single") { const c = els.find((e) => e.checked); v = c ? +c.value : null; }
          else v = els[0] ? els[0].value : "";
          flat[name] = v; (nested[p.id] = nested[p.id] || {})[q.id] = v;
        }));
        return { flat, nested };
      };
      form.addEventListener("input", () => { try { localStorage.setItem(key, JSON.stringify(collect().flat)); } catch (e) {} });
      let submitting = false;
      const submit = async (auto) => {
        if (submitting) return; submitting = true; stopExamTimer();
        const { nested } = collect();
        try {
          const r = await api(`/api/courses/${slug}/items/${it.id}/exam/submit`, { method: "POST", body: JSON.stringify({ answers: nested }) });
          try { localStorage.removeItem(key); } catch (e) {}
          results(att, r, nested, auto);
        } catch (e) { submitting = false; $("#exam-msg").textContent = `Couldn't submit: ${e.message}. Try again.`; }
      };
      form.addEventListener("submit", (e) => { e.preventDefault(); if (confirm("Submit your answers? You can't change them afterwards.")) submit(false); });
      const clock = $("#exam-clock");
      const tick = () => {
        const left = att.active.deadline - (Date.now() / 1000 - skew);
        clock.textContent = `Time left ${fmtClock(left)}`;
        clock.classList.toggle("low", left < 300);
        if (left <= 0) submit(true);
      };
      stopExamTimer(); tick(); examTimer = setInterval(tick, 1000);
    };
    const results = (att, r, mine, auto) => {
      box.innerHTML = `<div class="exam-result ${r.passed ? "pass" : "fail"}"><b>${Math.round(100 * r.score)}%</b> · ${r.correct} of ${r.total} parts correct · ${r.passed ? "passed" : r.late ? "submitted late: not counted" : `not passed (needs ${Math.round(info.pass * 100)}%)`}${auto ? " · submitted when time ran out" : ""}</div>
        ${att.paper.map((p, k) => { const rv = r.review.find((x) => x.id === p.id) || { parts: {}, answers: {} };
          return `<div class="prob ${Object.values(rv.parts).every(Boolean) ? "solved" : ""}">
            <div class="prob-head"><span class="prob-n">Problem ${k + 1}</span><b>${esc(p.title || "")}</b></div>
            <div class="prob-stmt">${p.statement || ""}</div>
            ${p.parts.map((q) => { const ok = rv.parts[q.id], yours = (mine[p.id] || {})[q.id], ans = rv.answers[q.id];
              const show = (v) => q.type === "numeric" ? esc(v === "" || v == null ? "—" : v) : [].concat(v ?? []).map((i) => q.options[i] !== undefined ? q.options[i] : "—").join("; ") || "—";
              return `<div class="pp"><div class="pp-prompt"><b>(${esc(q.id)})</b> ${q.prompt}</div><div class="muted small">${ok ? "✓" : "✗"} yours: ${show(yours)} · answer: ${q.type === "numeric" ? esc(typeof ans === "number" ? +ans.toPrecision(6) : ans) : show(ans)}</div></div>`; }).join("")}
            <div class="prob-sol"><p class="eyebrow">Worked solution</p>${rv.solution}</div></div>`; }).join("")}
        <div class="quiz-actions"><button class="btn btn-ghost" type="button" id="exam-back">Back to the exam page</button></div>`;
      typeset(box);
      $("#exam-back").addEventListener("click", () => route());
      window.scrollTo(0, $("#exam-sec").offsetTop - 80);
    };
    if (info.active) api(`/api/courses/${slug}/items/${it.id}/exam/start`, { method: "POST" }).then(sit).catch((e) => { box.textContent = e.message; });
    else intro();
  }

  function setupAsk(slug, it) {
    const panel = $("#ask"), thread = $("#ask-thread"), form = $("#ask-form"), input = $("#ask-input");
    const open = () => { panel.hidden = false; $("#ask-open").hidden = true; input.focus(); thread.scrollTop = thread.scrollHeight; };
    const close = () => { panel.hidden = true; $("#ask-open").hidden = false; };
    $("#ask-open").addEventListener("click", open);
    $("#ask-close").addEventListener("click", close);
    const empty = () => {
      thread.innerHTML = `<div class="ask-empty"><b>Stuck on something?</b><p>Ask about anything in this chapter, or paste an error from the terminal. You'll get explanations and hints. Exercise and quiz answers stay yours to find.</p></div>`;
    };
    if (it.qa.length) it.qa.forEach((m) => addMsg(m.role, m.text)); else empty();
    $("#ask-clear").addEventListener("click", async () => {
      await api(`/api/courses/${slug}/items/${it.id}/ask`, { method: "DELETE" });
      empty();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });

    function addMsg(role, text) {
      const e = thread.querySelector(".ask-empty"); if (e) e.remove();
      const d = document.createElement("div");
      d.className = role === "user" ? "msg-user" : "msg-tutor prose";
      if (role === "user") d.textContent = text; else { d.innerHTML = renderMarkdown(text); typeset(d); }
      thread.appendChild(d);
      thread.scrollTop = thread.scrollHeight;
      return d;
    }

    let busy = false;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q || busy) return;
      busy = true; input.value = "";
      addMsg("user", q);
      const d = addMsg("tutor", "");
      d.classList.add("cursor");
      const acts = document.createElement("div"); acts.className = "activity"; d.before(acts);
      let text = "", raf = 0;
      const paint = (final) => { d.innerHTML = renderMarkdown(text); if (final) { d.classList.remove("cursor"); typeset(d); } thread.scrollTop = thread.scrollHeight; };
      try {
        const res = await fetch(`/api/courses/${slug}/items/${it.id}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }) });
        if (!res.ok) { let m = res.statusText; try { m = (await res.json()).detail; } catch (x) {} throw new Error(m); }
        const rd = res.body.getReader(), dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await rd.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            if (!chunk.startsWith("data: ")) continue;
            let ev; try { ev = JSON.parse(chunk.slice(6)); } catch (x) { continue; }
            if (ev.type === "text_start" && text && !text.endsWith("\n\n")) text += "\n\n";
            else if (ev.type === "text") { text += ev.text; if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(false); }); }
            else if (ev.type === "search") acts.insertAdjacentHTML("beforeend", `<span class="act search"><span class="dot"></span>Searched: <b>${esc(ev.query)}</b></span>`);
            else if (ev.type === "sources") acts.insertAdjacentHTML("beforeend", ev.sources.slice(0, 4).map((s) => `<a class="act" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"><span class="dot"></span><b>${esc(s.title || s.url)}</b></a>`).join(""));
            else if (ev.type === "error") d.insertAdjacentHTML("afterend", `<div class="error-note">${esc(ev.message)}</div>`);
          }
        }
      } catch (err) {
        d.insertAdjacentHTML("afterend", `<div class="error-note">${esc(err.message)}</div>`);
      } finally {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        paint(true);
        if (!acts.children.length) acts.remove();
        busy = false;
      }
    });
  }

  function showError(err, slug) {
    const locked = err.status === 403;
    main.innerHTML = `<div class="container" style="padding:64px 16px;max-width:720px">
      <div class="empty-card"><strong>${locked ? `${LOCK} Locked` : "Couldn't load this page"}</strong>${esc(err.message)}
      ${slug ? `<p style="margin-top:16px"><a class="btn btn-ghost btn-sm" href="#/c/${slug}">Back to the course</a></p>` : ""}</div></div>`;
  }

  // ---------- Backup and restore ----------
  // A backup holds the server-side progress (checkmarks, problems, quizzes, labs, write-ups) and
  // the browser-side drafts (exercise code and unsent write-ups), so it moves everything to a new
  // machine or browser.
  function setupBackup() {
    const ex = $("#pg-export"), im = $("#pg-import"), file = $("#pg-file");
    if (!ex) return;
    ex.addEventListener("click", async () => {
      const server = await api("/api/progress/export");
      const drafts = {};
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("gw-")) drafts[k] = localStorage.getItem(k); } } catch (e) {}
      const blob = new Blob([JSON.stringify({ ...server, drafts }, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `groundwork-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    im.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const f = file.files[0];
      if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch (e) { alert("That file isn't a Groundwork backup."); return; }
      if (!confirm("Replace your current progress with this backup? (The current progress is kept as a copy next to the progress file.)")) return;
      try { await api("/api/progress/import", { method: "POST", body: JSON.stringify(data) }); }
      catch (e) { alert(`Restore failed: ${e.message}`); return; }
      try { Object.entries(data.drafts || {}).forEach(([k, v]) => { if (k.startsWith("gw-")) localStorage.setItem(k, v); }); } catch (e) {}
      route();
    });
  }

  // ---------- Router ----------
  let navSeq = 0;
  function route() {
    hideReadBar();
    stopExamTimer();
    // Stop everything the previous page started: figure timers and animation loops, and any
    // exercise still running in a worker.
    if (window.GWComponents && window.GWComponents.unmountAll) window.GWComponents.unmountAll();
    if (window.GWTerminal && window.GWTerminal.stopAll) window.GWTerminal.stopAll();
    const h = location.hash.replace(/^#/, "") || "/";
    const parts = h.split("/").filter(Boolean);
    if (parts[0] === "c" && parts[1] && parts[2] && !parts[2].startsWith("b")) return renderItem(parts[1], parts[2]);
    if (parts[0] === "c" && parts[1]) { navSeq++; window.scrollTo(0, 0); return renderCourse(parts[1]); }
    if (parts[0] === "about") { navSeq++; window.scrollTo(0, 0); return renderAbout(); }
    if (parts.length === 0) { navSeq++; window.scrollTo(0, 0); return renderHome(); }
  }
  window.addEventListener("hashchange", route);
  route();
  api("/api/config").then((c) => { $("#model-tag").textContent = `Ask panel: ${c.model} · effort ${c.effort}`; }).catch(() => {});
})();
