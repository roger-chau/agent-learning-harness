/* Groundwork frontend: hash router, topic cards, live tutor chat, knowledge map. */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const main = $("#main");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const MASTERY = ["unseen", "gap", "shaky", "solid", "mastered"];
  const MASTERY_TONE = ["t-empty", "t-rose", "t-saffron", "t-teal", "t-mint"];

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).detail || msg; } catch (e) {}
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return res.json();
  }

  // ---------- Theme ----------
  $("#theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("gw-theme", next); } catch (e) {}
  });

  // ---------- Markdown + math ----------
  function renderMarkdown(src) {
    const math = [];
    // Protect math from the markdown parser, then restore it for KaTeX.
    let text = src.replace(/\$\$([\s\S]+?)\$\$/g, (m) => { math.push(m); return `@@MATH${math.length - 1}@@`; })
                  .replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$/g, (m, pre, body) => { math.push(`$${body}$`); return `${pre}@@MATH${math.length - 1}@@`; });
    let html = window.marked ? window.marked.parse(text, { breaks: false, gfm: true }) : `<p>${esc(text)}</p>`;
    html = html.replace(/@@MATH(\d+)@@/g, (_, i) => esc(math[+i]));
    html = window.DOMPurify ? window.DOMPurify.sanitize(html, { ADD_ATTR: ["target"] }) : html;
    return html;
  }
  function typeset(el) {
    el.querySelectorAll("a[href^='http']").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(el, {
          delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }],
          throwOnError: false,
        });
      } catch (e) {}
    }
  }

  // ---------- Shared pieces ----------
  function blockRow(n, name, tag, tone) {
    return `<div class="block ${tone}"><span class="n">${pad(n)}</span><span class="name">${esc(name)}</span><span class="tag">${esc(tag)}</span></div>`;
  }

  function orderedConcepts(topic) {
    return [...topic.concepts].sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
  }

  function topicStack(topic) {
    const cs = orderedConcepts(topic);
    if (!cs.length) {
      return `<div class="stack">${blockRow(1, "Not mapped yet", "diagnose first", "t-empty")}${blockRow(2, "…", "", "t-empty")}${blockRow(3, "…", "", "t-empty")}</div>`;
    }
    // Pick up to 5 concepts spread from foundations to the top of the map.
    const pick = cs.length <= 5 ? cs : [0, 1, 2, 3, 4].map((i) => cs[Math.round((i * (cs.length - 1)) / 4)]);
    return `<div class="stack">${pick.map((c, i) => blockRow(i + 1, c.name, c.mastery_label, MASTERY_TONE[c.mastery])).join("")}</div>`;
  }

  async function refreshNavDue() {
    try {
      const due = await api("/api/reviews");
      const el = $("#nav-due");
      el.hidden = !due.length;
      el.textContent = due.length;
    } catch (e) {}
  }

  function setNav(key) {
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === key));
  }

  // ---------- Home ----------
  async function renderHome() {
    setNav("home");
    main.innerHTML = `
      <section class="hero">
        <div class="container hero-grid">
          <div>
            <p class="eyebrow">A tutor that starts where you are</p>
            <h1 class="display"><span class="nowrap">Learn anything from</span><br><span class="serif">first principles</span><span class="dot">.</span></h1>
            <p class="lede">Name something you want to understand. Groundwork asks a few questions to find the edge of what you know, walks down to the first missing idea, and builds back up one block at a time, then brings each block back for review before you forget it.</p>
            <form class="start-form" id="start-form" autocomplete="off">
              <div class="row">
                <input class="field" id="start-title" name="title" required maxlength="200" placeholder="What do you want to understand?" aria-label="Topic">
                <button class="btn btn-primary" type="submit">Start learning ${ARROW}</button>
              </div>
              <textarea class="field" id="start-goal" name="goal" rows="2" maxlength="2000" placeholder="Optional: why, and what you already know (e.g. “I code daily but never understood how TLS works”)" aria-label="Goal"></textarea>
              <p class="hint" id="start-hint"></p>
            </form>
          </div>
          <div class="stack-card lifted" aria-label="How a session works">
            <div class="stack">
              ${blockRow(1, "What you already know", "probe", "t-mint")}
              ${blockRow(2, "The first gap", "diagnose", "t-indigo")}
              ${blockRow(3, "One small block", "build", "t-indigo")}
              ${blockRow(4, "Prove it to yourself", "exercise", "t-indigo")}
              ${blockRow(5, "Keep it", "spaced review", "t-saffron")}
            </div>
          </div>
        </div>
      </section>
      <section class="section" id="topics">
        <div class="container">
          <div class="section-head">
            <p class="eyebrow">Your map</p>
            <h2 class="h2">Topics</h2>
            <p>Each topic is a graph of small ideas and how well you've shown you understand them. Pick one up where you left off.</p>
          </div>
          <div class="card-grid" id="topic-grid"><div class="empty-card">Loading…</div></div>
        </div>
      </section>`;

    $("#start-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = $("#start-title").value.trim();
      if (!title) return;
      const btn = e.target.querySelector("button");
      btn.disabled = true;
      try {
        const t = await api("/api/topics", { method: "POST", body: JSON.stringify({ title, goal: $("#start-goal").value.trim() }) });
        location.hash = `#/t/${t.id}/start`;
      } catch (err) {
        $("#start-hint").textContent = `Couldn't create the topic: ${err.message}`;
        btn.disabled = false;
      }
    });

    try {
      const [topics, cfg] = await Promise.all([api("/api/topics"), api("/api/config")]);
      if (!cfg.has_key) {
        $("#start-hint").innerHTML = "No <code>ANTHROPIC_API_KEY</code> in the server's environment. If you haven't logged in with <code>ant auth login</code> either, set one and restart.";
      }
      const grid = $("#topic-grid");
      if (!topics.length) {
        grid.innerHTML = `<div class="empty-card"><strong>No topics yet</strong>Start one above. A first session takes a few minutes: a handful of questions, then your first block.</div>`;
        return;
      }
      grid.innerHTML = topics.map(topicCard).join("");
    } catch (err) {
      $("#topic-grid").innerHTML = `<div class="error-note">Couldn't load topics: ${esc(err.message)}</div>`;
    }
  }

  function topicCard(t) {
    const s = t.stats;
    const pill = s.due ? `<span class="pill saffron">${s.due} due for review</span>`
      : s.concepts ? `<span class="pill">In progress</span>` : `<span class="pill indigo">New</span>`;
    const chips = orderedConcepts(t).slice(-6).reverse().map((c) => `<span class="chip">${esc(c.name)}</span>`).join("");
    return `
      <a class="topic-card" href="#/t/${t.id}">
        ${topicStack(t)}
        ${pill}
        <h3>${esc(t.title)}</h3>
        <p class="goal">${esc(t.goal || "No goal written down yet.")}</p>
        ${chips ? `<div class="chips">${chips}</div>` : ""}
        <div class="stats">
          <div class="stat"><div class="k">Concepts</div><div class="v">${s.concepts}</div></div>
          <div class="stat"><div class="k">Solid</div><div class="v">${s.mastered}</div></div>
          <div class="stat"><div class="k">Gaps</div><div class="v">${s.gaps}</div></div>
          <div class="stat"><div class="k">Due</div><div class="v">${s.due}</div></div>
        </div>
        <span class="card-cta">${t.turns ? "Continue learning" : "Begin"} ${ARROW}</span>
      </a>`;
  }

  // ---------- Review ----------
  async function renderReview() {
    setNav("review");
    main.innerHTML = `
      <section class="section">
        <div class="container">
          <div class="section-head">
            <p class="eyebrow">Spaced review</p>
            <h2 class="h2">Due for review</h2>
            <p>Ideas come back just as you're about to forget them. Each correct recall pushes the next review further out; a miss brings it back sooner.</p>
          </div>
          <div class="review-list" id="review-list"><div class="empty-card">Loading…</div></div>
        </div>
      </section>`;
    try {
      const due = await api("/api/reviews");
      const list = $("#review-list");
      if (!due.length) {
        list.innerHTML = `<div class="empty-card"><strong>Nothing due</strong>You're caught up. New reviews appear here as concepts you've worked on come due.</div>`;
        return;
      }
      const byTopic = {};
      due.forEach((c) => { (byTopic[c.topic_id] ||= { name: c.topic, items: [] }).items.push(c); });
      list.innerHTML = Object.entries(byTopic).map(([tid, g]) => `
        <div class="review-row">
          <div>
            <div class="topic-name">${esc(g.name)}</div>
            <div class="t">${g.items.map((c) => esc(c.name)).join(" · ")}</div>
            <div class="s">${g.items.length} concept${g.items.length > 1 ? "s" : ""} due</div>
          </div>
          <a class="btn btn-primary btn-sm" href="#/t/${tid}/review">Review now ${ARROW}</a>
        </div>`).join("");
    } catch (err) {
      $("#review-list").innerHTML = `<div class="error-note">${esc(err.message)}</div>`;
    }
  }

  // ---------- About ----------
  function renderAbout() {
    setNav("about");
    const steps = [
      ["Probe", "The tutor asks you to explain or predict, not recite. Your answers show where understanding actually stops."],
      ["Map", "It breaks your goal into small concepts and links each to the ideas it rests on. That graph is the map beside your conversation."],
      ["Find the lowest gap", "When something's missing, it walks down the prerequisite chain to the lowest block you don't have yet, and starts there."],
      ["Build one block", "One idea per turn: the problem it solves, the smallest true statement of it, a worked example with real numbers, then a question for you."],
      ["Record honestly", "Mastery changes only on evidence: what you said or did, never what the tutor explained. Misconceptions are written down."],
      ["Review", "Every assessed concept is scheduled for spaced review. Due items come back with fresh questions."],
    ];
    main.innerHTML = `
      <section class="hero" style="padding-bottom:48px">
        <div class="container" style="position:relative;z-index:1">
          <p class="eyebrow">How it works</p>
          <h1 class="display" style="font-size:var(--text-3xl)">Start from what's true, <span class="serif">add one block at a time</span><span class="dot">.</span></h1>
          <p class="lede">Groundwork is a small agent harness around Claude. It keeps a learner model of what you've shown you understand, and the tutor reads it, updates it, and plans from it every turn.</p>
        </div>
      </section>
      <section class="section" style="padding-top:8px">
        <div class="container steps">
          ${steps.map(([h, p], i) => `<div class="step"><div class="n">${pad(i + 1)}</div><h3>${h}</h3><p>${p}</p></div>`).join("")}
        </div>
      </section>`;
  }

  // ---------- Topic workspace ----------
  const state = { topic: null, busy: false, selected: null };

  async function renderTopic(tid, action) {
    setNav("");
    main.innerHTML = `<div class="container" style="padding:48px 16px"><div class="empty-card">Loading…</div></div>`;
    let t;
    try {
      t = await api(`/api/topics/${tid}`);
    } catch (err) {
      main.innerHTML = `<div class="container" style="padding:48px 16px"><div class="error-note">${esc(err.message)}</div></div>`;
      return;
    }
    state.topic = t;
    state.selected = t.focus;
    state.busy = false;

    main.innerHTML = `
      <section class="topic-head">
        <div class="container">
          <div class="crumbs"><a href="#/">Topics</a> / <span>${esc(t.title)}</span></div>
          <h1 class="topic-title">${esc(t.title)}</h1>
          ${t.goal ? `<p class="topic-goal">${esc(t.goal)}</p>` : ""}
          <div class="topic-actions">
            <button class="btn btn-ghost btn-sm" id="act-review" type="button">Review due</button>
            <button class="btn btn-ghost btn-sm" id="act-reset" type="button" title="Clears the conversation; keeps your map and progress">New conversation</button>
            <button class="btn btn-ghost btn-sm" id="act-delete" type="button">Delete topic</button>
          </div>
        </div>
      </section>
      <div class="container workspace">
        <div class="chat">
          <div class="thread" id="thread" aria-live="polite"></div>
          <div class="composer">
            <form class="composer-box" id="composer">
              <textarea id="input" rows="1" placeholder="Answer, ask, or say “I'm stuck”…" aria-label="Message"></textarea>
              <button class="btn btn-primary btn-sm" type="submit" id="send">Send</button>
            </form>
            <div class="row2">
              <button class="quick" type="button" data-q="I'm stuck. Can you give me a small hint?">I'm stuck</button>
              <button class="quick" type="button" data-q="Can you show me a worked example with real numbers?">Worked example</button>
              <button class="quick" type="button" data-q="Why is this true? Take it one level deeper.">Why?</button>
              <button class="quick" type="button" data-q="Where can I read more? Give me good sources.">Sources</button>
            </div>
          </div>
        </div>
        <aside class="sidebar" aria-label="Knowledge map">
          <div class="panel">
            <div class="panel-title"><h4>Knowledge map</h4><span id="map-count"></span></div>
            <div class="graph-wrap" id="graph"></div>
            <div class="legend">
              <span><i style="background:var(--surface);border-color:var(--rule-strong)"></i>unseen</span>
              <span><i style="background:var(--rose-soft);border-color:var(--rose-line)"></i>gap</span>
              <span><i style="background:var(--saffron-soft);border-color:var(--saffron-line)"></i>shaky</span>
              <span><i style="background:var(--accent-soft);border-color:var(--primary)"></i>solid</span>
              <span><i style="background:var(--mint-soft);border-color:var(--mint-line)"></i>mastered</span>
            </div>
          </div>
          <div class="panel" id="detail-panel"></div>
          <div class="panel">
            <div class="panel-title"><h4>Progress</h4></div>
            <div class="kv" id="kv"></div>
          </div>
          <div class="panel">
            <div class="panel-title"><h4>Sources</h4><span id="src-count"></span></div>
            <ul class="sources" id="sources"></ul>
          </div>
        </aside>
      </div>`;

    renderThread(t.transcript);
    renderSidebar();
    renderSources(t.sources);

    const input = $("#input");
    input.addEventListener("input", autosize);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#composer").requestSubmit(); }
    });
    $("#composer").addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || state.busy) return;
      input.value = ""; autosize.call(input);
      send({ message: text, mode: "chat" });
    });
    document.querySelectorAll(".quick").forEach((b) => b.addEventListener("click", () => send({ message: b.dataset.q, mode: "chat" })));
    $("#act-review").addEventListener("click", () => send({ mode: "review" }));
    $("#act-reset").addEventListener("click", async () => {
      if (!confirm("Start a new conversation? Your map and progress stay.")) return;
      await api(`/api/topics/${tid}/reset`, { method: "POST" });
      renderTopic(tid);
    });
    $("#act-delete").addEventListener("click", async () => {
      if (!confirm(`Delete “${t.title}” and everything recorded for it?`)) return;
      await api(`/api/topics/${tid}`, { method: "DELETE" });
      location.hash = "#/";
    });

    if (action === "start" && !t.transcript.length) {
      history.replaceState(null, "", `#/t/${tid}`);
      send({ mode: "start" });
    } else if (action === "review") {
      history.replaceState(null, "", `#/t/${tid}`);
      send({ mode: "review" });
    } else if (!t.transcript.length) {
      showBegin();
    }
    if (t.busy) setBusy(true);
  }

  function autosize() { this.style.height = "auto"; this.style.height = Math.min(this.scrollHeight, 220) + "px"; }

  function showBegin() {
    $("#thread").innerHTML = `
      <div class="begin">
        <h3>Ready when you are</h3>
        <p>The tutor will sketch a map of this topic and ask a first question to see what you already know. There's no penalty for “I don't know”; that answer is useful.</p>
        <button class="btn btn-primary" type="button" id="begin-btn">Begin diagnosis ${ARROW}</button>
      </div>`;
    $("#begin-btn").addEventListener("click", () => send({ mode: "start" }));
  }

  function renderThread(items) {
    const thread = $("#thread");
    thread.innerHTML = "";
    items.forEach((m) => {
      if (m.role === "user") thread.appendChild(userMsg(m.text));
      else {
        const v = tutorMsg();
        m.activity.forEach((a) => addActivity(v, a.label, a.detail, a.label === "Searched"));
        v.text = m.text;
        paint(v, false);
        thread.appendChild(v.el);
      }
    });
    scrollToEnd(false);
  }

  function userMsg(text) {
    const d = document.createElement("div");
    d.className = "msg-user";
    d.textContent = text;
    return d;
  }

  function tutorMsg() {
    const el = document.createElement("div");
    el.className = "msg-tutor";
    el.innerHTML = `
      <div class="avatar" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 64 64"><rect x="36" y="10" width="18" height="11" rx="3" fill="#fff" fill-opacity=".75"/><rect x="22" y="26" width="32" height="11" rx="3" fill="#fff" fill-opacity=".85"/><rect x="8" y="42" width="46" height="11" rx="3" fill="#fff"/></svg></div>
      <div class="body">
        <div class="activity"></div>
        <details class="thinking" hidden><summary>Tutor's reasoning</summary><div class="body"></div></details>
        <div class="prose"></div>
      </div>`;
    return { el, text: "", thinking: "", activity: el.querySelector(".activity"), prose: el.querySelector(".prose"), think: el.querySelector("details.thinking") };
  }

  function addActivity(v, label, detail, isSearch, pending) {
    const a = document.createElement("span");
    a.className = `act${isSearch ? " search" : ""}${pending ? " pending" : ""}`;
    a.innerHTML = `<span class="dot"></span>${esc(label)}${detail ? `: <b>${esc(detail)}</b>` : ""}`;
    v.activity.appendChild(a);
    return a;
  }

  function paint(v, streaming) {
    v.prose.innerHTML = renderMarkdown(v.text || "");
    v.prose.classList.toggle("cursor", !!streaming);
    if (!streaming) typeset(v.prose);
  }

  function scrollToEnd(smooth = true) {
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 400;
    if (nearBottom || !smooth) window.scrollTo({ top: document.body.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  function setBusy(b) {
    state.busy = b;
    ["#send", "#act-review", "#act-reset", "#act-delete"].forEach((s) => { const el = $(s); if (el) el.disabled = b; });
    document.querySelectorAll(".quick").forEach((q) => (q.disabled = b));
  }

  async function send(body) {
    if (state.busy) return;
    const tid = state.topic.id;
    const thread = $("#thread");
    const begin = $(".begin", thread);
    if (begin) begin.remove();
    setBusy(true);

    let v = null;
    let pendingAct = null;
    let raf = 0;
    const schedulePaint = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (v) { paint(v, true); scrollToEnd(); } });
    };
    const ensureTutor = () => {
      if (!v) { v = tutorMsg(); thread.appendChild(v.el); }
      return v;
    };
    const clearPending = () => { if (pendingAct) { pendingAct.remove(); pendingAct = null; } };

    try {
      const res = await fetch(`/api/topics/${tid}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = res.statusText;
        try { msg = (await res.json()).detail || msg; } catch (e) {}
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line.slice(6)); } catch (e) { continue; }
          handle(ev);
        }
      }
    } catch (err) {
      ensureTutor();
      const n = document.createElement("div");
      n.className = "error-note";
      n.textContent = err.message;
      v.el.querySelector(".body").appendChild(n);
    } finally {
      clearPending();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (v) paint(v, false);
      setBusy(false);
      refreshNavDue();
      $("#input")?.focus();
    }

    function handle(ev) {
      switch (ev.type) {
        case "user":
          thread.appendChild(userMsg(ev.text));
          ensureTutor();
          pendingAct = addActivity(v, "Thinking", "", false, true);
          scrollToEnd(false);
          break;
        case "thinking_start":
          ensureTutor().think.hidden = false;
          break;
        case "thinking":
          ensureTutor();
          v.thinking += ev.text;
          v.think.querySelector(".body").textContent = v.thinking;
          break;
        case "text_start":
          clearPending();
          ensureTutor();
          if (v.text && !v.text.endsWith("\n\n")) v.text += "\n\n";
          break;
        case "text":
          ensureTutor().text += ev.text;
          schedulePaint();
          break;
        case "tool_start":
          clearPending();
          pendingAct = addActivity(ensureTutor(), ev.label, "", false, true);
          break;
        case "search_start":
          clearPending();
          pendingAct = addActivity(ensureTutor(), "Searching the web", "", true, true);
          break;
        case "search":
          clearPending();
          addActivity(ensureTutor(), "Searched", ev.query, true);
          break;
        case "tool":
          clearPending();
          addActivity(ensureTutor(), ev.label, ev.detail);
          break;
        case "topic":
          Object.assign(state.topic, ev.topic);
          if (ev.topic.focus) state.selected = ev.topic.focus;
          renderSidebar();
          break;
        case "sources":
          state.topic.sources = [...(state.topic.sources || []), ...ev.sources];
          renderSources(state.topic.sources);
          break;
        case "error": {
          clearPending();
          const n = document.createElement("div");
          n.className = "error-note";
          n.textContent = ev.message;
          ensureTutor().el.querySelector(".body").appendChild(n);
          break;
        }
        case "done":
          clearPending();
          break;
      }
    }
  }

  // ---------- Sidebar: graph, detail, stats ----------
  function renderSidebar() {
    const t = state.topic;
    $("#map-count").textContent = `${t.concepts.length} concept${t.concepts.length === 1 ? "" : "s"}`;
    $("#graph").innerHTML = graphSVG(t);
    $("#graph").querySelectorAll(".node").forEach((n) => {
      const pick = () => { state.selected = n.dataset.id; renderSidebar(); };
      n.addEventListener("click", pick);
      n.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
    renderDetail();
    const s = t.stats;
    $("#kv").innerHTML = [["Concepts", s.concepts], ["Solid", s.mastered], ["Gaps", s.gaps], ["Due", s.due]]
      .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  }

  function renderDetail() {
    const panel = $("#detail-panel");
    const t = state.topic;
    const c = t.concepts.find((x) => x.id === state.selected) || t.concepts.find((x) => x.id === t.focus);
    if (!c) {
      panel.innerHTML = `<div class="panel-title"><h4>Building blocks</h4></div><p class="muted" style="margin:0;font-size:.92rem">Concepts appear here as the tutor maps the topic. Click a block on the map to see what you've shown about it.</p>`;
      return;
    }
    const byId = Object.fromEntries(t.concepts.map((x) => [x.id, x]));
    // Foundations-first chain under the selected concept.
    const seen = new Set();
    const walk = (id) => { if (seen.has(id) || !byId[id]) return; seen.add(id); byId[id].prerequisites.forEach(walk); };
    walk(c.id);
    const chain = [...seen].map((id) => byId[id]).sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
    const next = c.next_review ? new Date(c.next_review) : null;
    panel.innerHTML = `
      <div class="panel-title"><h4>${c.id === t.focus ? "Current block" : "Selected block"}</h4><span>${esc(c.mastery_label)}</span></div>
      <div class="concept-detail">
        <h5>${esc(c.name)}</h5>
        ${c.summary ? `<p>${esc(c.summary)}</p>` : ""}
        ${c.misconceptions.length ? `<ul class="mis">${c.misconceptions.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
        <div class="meta">${next ? `next review ${c.due ? "due now" : next.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "not assessed yet"}</div>
      </div>
      ${chain.length > 1 ? `<div class="stack" style="margin-bottom:12px">${chain.slice(-6).reverse().map((x, i, arr) => blockRow(arr.length - i, x.name, x.mastery_label, MASTERY_TONE[x.mastery])).join("")}</div>` : ""}
      <div class="btn-row">
        <button class="btn btn-ghost btn-sm" type="button" id="teach-this">Work on this</button>
        <button class="btn btn-ghost btn-sm" type="button" id="quiz-this">Quiz me</button>
      </div>`;
    $("#teach-this").disabled = state.busy;
    $("#quiz-this").disabled = state.busy;
    $("#teach-this").addEventListener("click", () => send({ mode: "chat", message: `Let's work on “${c.name}” next.` }));
    $("#quiz-this").addEventListener("click", () => send({ mode: "chat", message: `Quiz me on “${c.name}”.` }));
  }

  function graphSVG(t) {
    const cs = t.concepts;
    if (!cs.length) return `<div class="graph-empty">The map fills in as the tutor breaks your goal into building blocks.</div>`;
    const W = 368, PADX = 12, NODE_H = 28, ROW_GAP = 22, LAYER_GAP = 34, PER_ROW = 3, TOP = 16, BOTTOM = 26;
    const layers = {};
    cs.forEach((c) => (layers[c.depth] ||= []).push(c));
    const depths = Object.keys(layers).map(Number).sort((a, b) => a - b);
    depths.forEach((d) => layers[d].sort((a, b) => a.name.localeCompare(b.name)));

    // Lay out bottom-up: foundations sit on the ground line.
    const pos = {};
    let y = 0;
    const rows = [];
    depths.forEach((d, li) => {
      const items = layers[d];
      const nRows = Math.ceil(items.length / PER_ROW);
      for (let r = 0; r < nRows; r++) {
        const rowItems = items.slice(r * PER_ROW, (r + 1) * PER_ROW);
        rows.push({ y, items: rowItems, depth: d, firstOfLayer: r === 0 });
        y += NODE_H + (r < nRows - 1 ? ROW_GAP : LAYER_GAP);
      }
      if (li === depths.length - 1) y -= LAYER_GAP;
    });
    const H = TOP + y + NODE_H + BOTTOM;
    rows.forEach((row) => {
      const n = row.items.length;
      const gap = 8;
      const w = Math.min(150, (W - PADX * 2 - 22 - gap * (n - 1)) / n);
      const total = n * w + gap * (n - 1);
      let x = 22 + PADX + (W - PADX * 2 - 22 - total) / 2;
      const yy = H - BOTTOM - NODE_H - row.y;
      row.items.forEach((c) => { pos[c.id] = { x, y: yy, w }; x += w + gap; });
    });

    const focusChain = new Set();
    if (t.focus) {
      const byId = Object.fromEntries(cs.map((c) => [c.id, c]));
      const walk = (id) => { if (focusChain.has(id) || !byId[id]) return; focusChain.add(id); byId[id].prerequisites.forEach(walk); };
      walk(t.focus);
    }

    let edges = "";
    cs.forEach((c) => c.prerequisites.forEach((p) => {
      const a = pos[p], b = pos[c.id];
      if (!a || !b) return;
      const x1 = a.x + a.w / 2, y1 = a.y, x2 = b.x + b.w / 2, y2 = b.y + NODE_H;
      const my = (y1 + y2) / 2;
      const hot = focusChain.has(c.id) && focusChain.has(p);
      edges += `<path class="edge${hot ? " hot" : ""}" d="M${x1.toFixed(1)},${y1} C${x1.toFixed(1)},${my} ${x2.toFixed(1)},${my} ${x2.toFixed(1)},${y2}"/>`;
    }));

    const fills = [
      ["var(--surface)", "var(--rule-strong)"], ["var(--rose-soft)", "var(--rose-line)"],
      ["var(--saffron-soft)", "var(--saffron-line)"], ["var(--accent-soft)", "var(--primary)"], ["var(--mint-soft)", "var(--mint-line)"],
    ];
    let nodes = "";
    cs.forEach((c) => {
      const p = pos[c.id];
      const [fill, stroke] = fills[c.mastery] || fills[0];
      const maxChars = Math.max(4, Math.floor((p.w - 14) / 6.1));
      const label = c.name.length > maxChars ? c.name.slice(0, maxChars - 1) + "…" : c.name;
      const sel = c.id === state.selected;
      nodes += `<g class="node" data-id="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.name)}: ${esc(c.mastery_label)}">
        <title>${esc(c.name)} (${esc(c.mastery_label)})${c.summary ? "\n" + esc(c.summary) : ""}</title>
        ${c.id === t.focus ? `<rect class="focus-ring" x="${p.x - 4}" y="${p.y - 4}" width="${p.w + 8}" height="${NODE_H + 8}" rx="11"/>` : ""}
        <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${NODE_H}" rx="8" fill="${fill}" stroke="${stroke}" ${sel ? 'stroke-width="2.4"' : ""}/>
        ${c.due ? `<circle cx="${p.x + p.w - 6}" cy="${p.y + 6}" r="3.2" fill="var(--saffron)"/>` : ""}
        <text x="${p.x + p.w / 2}" y="${p.y + NODE_H / 2 + 4}" text-anchor="middle">${esc(label)}</text>
      </g>`;
    });

    let labels = "";
    rows.filter((r) => r.firstOfLayer).forEach((r) => {
      const yy = H - BOTTOM - NODE_H - r.y + NODE_H / 2 + 3;
      labels += `<text class="layer-label" x="8" y="${yy}">L${r.depth}</text>`;
    });

    const groundY = H - BOTTOM + 8;
    return `<svg class="graph" viewBox="0 0 ${W} ${H}" role="img" aria-label="Prerequisite map: foundations at the bottom, your goal at the top">
      ${labels}${edges}${nodes}
      <rect class="ground" x="${PADX + 22}" y="${groundY}" width="${W - PADX * 2 - 22}" height="4" rx="2"/>
      <text class="layer-label" x="${W - PADX}" y="${groundY + 15}" text-anchor="end">foundations</text>
    </svg>`;
  }

  function renderSources(list) {
    const ul = $("#sources");
    if (!ul) return;
    $("#src-count").textContent = list.length ? String(list.length) : "";
    if (!list.length) {
      ul.innerHTML = `<li class="muted" style="font-size:.9rem">References the tutor finds while teaching collect here.</li>`;
      return;
    }
    ul.innerHTML = list.slice().reverse().map((s) => {
      let host = "";
      try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch (e) {}
      return `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}<div class="host">${esc(host)}</div></a></li>`;
    }).join("");
  }

  // ---------- Router ----------
  function route() {
    const h = location.hash.replace(/^#/, "") || "/";
    const parts = h.split("/").filter(Boolean);
    window.scrollTo(0, 0);
    if (parts[0] === "t" && parts[1]) return renderTopic(parts[1], parts[2]);
    if (parts[0] === "review") return renderReview();
    if (parts[0] === "about") return renderAbout();
    return renderHome();
  }
  window.addEventListener("hashchange", route);
  route();
  refreshNavDue();
  api("/api/config").then((c) => { $("#model-tag").textContent = `${c.model} · effort ${c.effort}`; }).catch(() => {});
})();
