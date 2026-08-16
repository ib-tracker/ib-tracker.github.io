/* ui.js — toasts, modals, popovers, form helpers, sidebar */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = (App.ui = {});

  /* ---------- toast ---------- */
  App.toast = function (msg, type) {
    const root = document.getElementById("toast-root");
    if (!root) return;
    const el = document.createElement("div");
    el.className = "toast " + (type || "success");
    el.innerHTML = (type === "error" ? App.icon("alertCircle") : App.icon("checkCircle")) + `<span></span>`;
    el.querySelector("span").textContent = msg;
    root.appendChild(el);
    // Success cues are picked per event by the caller; a failure sounds the same
    // wherever it comes from, so it can hang off the toast itself.
    if (type === "error" && App.sfx) App.sfx("error");
    setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 300); }, 2600);
  };

  /* ---------- read-only, made visible -------------------------------------
     When the trial ends every write is refused, but until now nothing said so
     until AFTER you had filled a form in: you could type a title, subject, due
     date and estimate, press Save, and get an error toast with the lot thrown
     away. 105 controls across the app stayed fully clickable and lied about it.

     App.writeBlocked() was written for precisely this ("silent query for the
     UI (disabling buttons)") and had no callers. This is that caller.

     An explicit list, not a heuristic over button text. Getting this wrong in
     the other direction is worse than the bug: disabling Export backup would
     hold someone's data hostage, and disabling the licence box would lock them
     out of fixing it. Anything not named here stays enabled by default. */
  const WRITE_CONTROLS = [
    "[data-add-task]", '[data-action="new-task"]',
    '[data-tact="edit"]', '[data-tact="delete"]', '[data-tact="toggle"]',
    "[data-add-subject]", "[data-del-subject]",
    "[data-add-course]", "[data-new-note]", "[data-save-view]",
    "[data-import]", "[data-sample]", "[data-erase]",
    "[data-mat-add-btn]", "[data-mat-remove]", "[data-mat-reset]",
    "[data-step-add-btn]", "[data-step-remove]", "[data-step-reset]",
    "[data-mat-add]", "[data-mat-del]", "[data-step-add]", "[data-step-del]",
  ].join(",");

  /* Fields, not just buttons. Disabling the buttons alone still left forty
     inputs and selects looking editable: you could retype a subject name, tab
     away, and get an error toast for your trouble.

     Everything inside #main is covered EXCEPT the license box, which has to
     keep working or there is no way back out of read-only, and the search
     field, which is a read operation. */
  const READONLY_FIELD_SCOPE = "#main input, #main select, #main textarea";
  // Only the license box. The "add a default material/step" fields are writes
  // like any other and were exempted here by mistake on the first pass.
  const FIELD_EXEMPT = "[data-license-input]";

  App.applyReadOnly = function (root) {
    const blocked = App.writeBlocked && App.writeBlocked();
    const scope = root || document;

    const setState = (el, disable, why) => {
      if (disable) {
        el.disabled = true;
        el.dataset.roDisabled = "1";
        el.title = why;
      } else if (el.dataset.roDisabled) {
        el.disabled = false;
        el.removeAttribute("title");
        delete el.dataset.roDisabled;
      }
    };

    const why = "Read-only — add a license key in Settings to make changes";
    scope.querySelectorAll(WRITE_CONTROLS).forEach((el) => setState(el, blocked, why));
    scope.querySelectorAll(READONLY_FIELD_SCOPE).forEach((el) => {
      if (el.closest(FIELD_EXEMPT) || el.matches(FIELD_EXEMPT)) return;
      setState(el, blocked, why);
    });
  };

  /* ---------- first-visit page intros ------------------------------------
     The old tour explained all fifteen pages up front, before any of them had
     anything in them. This does the opposite: each page says what it is the
     first time you open it, and only while it's still empty, so the
     explanation arrives at the moment it's useful and never again.

     Injected centrally by renderNow rather than added to fifteen page files,
     which keeps the copy in one place and means a new page gets this free. */
  const PAGE_INTROS = {
    timeline: ["Every open task, by date",
      "One list of everything still to do, soonest first. Filter it down to a subject or a priority, then save that combination as a view you can come back to."],
    calendar: ["Your month at a glance",
      "Due dates across the month, coloured by subject. Click a day to see what's due, or switch to Schedule to see the study you've actually planned."],
    scheduler: ["Plan the week around real life",
      "Block out school, sport and travel, then hit Auto-Schedule. It only ever plans into hours you've said are free, and you can drag anything it gets wrong."],
    analytics: ["Where your time actually goes",
      "Once you've logged a few study sessions, this shows your workload forecast, time per subject, and how far off your time estimates tend to be."],
    subjects: ["One card per subject",
      "Each subject gets a grade ring, hours studied and what's left to do. Add your subjects in Settings if the grid looks empty."],
    core: ["TOK, the EE and CAS",
      "The Diploma treats these separately from your six subjects, so this app does too. Track each one's progress and the deadlines that come with it."],
    grades: ["Your predicted total, live",
      "Put in current and target grades and it works out your points from 45, including the TOK and EE matrix, then shows which subject is worth the most effort."],
    university: ["Applications and their conditions",
      "Track courses, deadlines and offer conditions per subject, and see at a glance whether your predicted grades currently meet them."],
    templates: ["Build a routine once",
      "Save a structure you repeat, like an IA write-up with its sub-tasks, and create the whole thing again in one click."],
    notes: ["Somewhere for everything else",
      "Formulae, essay ideas, feedback from a teacher. Anything that isn't a task with a deadline. It saves as you type."],
    study: ["Focus, timed and logged",
      "Queue up what you're working through and start the clock. Optional Pomodoro breaks are excluded from your logged time, and everything feeds your streak."],
    // Coach and Focus are deliberately absent. Coach already opens with a
    // fuller introduction of its own, and Focus exists to strip everything
    // away, so a box explaining it would be the first thing to contradict it.
  };

  App.pageIntroHTML = function (page) {
    const intro = PAGE_INTROS[page];
    if (!intro) return "";
    const seen = App.state().ui.page_intros_seen || [];
    if (seen.includes(page)) return "";
    return `
      <div class="page-intro" data-page-intro="${esc(page)}">
        <div class="pi-icon">${App.icon("info")}</div>
        <div class="pi-text">
          <strong>${esc(intro[0])}</strong>
          <p>${esc(intro[1])}</p>
          <span class="pi-once">Shown once</span>
        </div>
        <button class="icon-btn" data-intro-dismiss aria-label="Dismiss">${App.icon("x")}</button>
      </div>`;
  };

  /* Marked seen as soon as it has been shown, rather than waiting to be
     dismissed. Having been on the page IS the thing that teaches you what it
     does; an explainer that sits there until you close it becomes furniture
     you stop reading and start working around.

     The write is {system}: these appear during the trial and after it, and an
     intro that couldn't retire itself in read-only mode would be permanent.
     Silent, so marking it doesn't trigger a re-render that removes the box
     from under the reader mid-sentence. */
  App.mountPageIntro = function (root) {
    const box = root.querySelector("[data-page-intro]");
    if (!box) return;
    const page = box.dataset.pageIntro;

    const markSeen = () => {
      App.update((s) => {
        const seen = s.ui.page_intros_seen || (s.ui.page_intros_seen = []);
        if (!seen.includes(page)) seen.push(page);
      }, { silent: true, system: true });
    };

    markSeen();
    box.querySelector("[data-intro-dismiss]").addEventListener("click", () => box.remove());
  };

  /* ---------- modal (imperative, stacked) ---------- */
  const modalStack = [];

  // openModal({title, body, foot, size, onMount, onClose}) -> {el, close}
  UI.openModal = function (opts) {
    const root = document.getElementById("modal-root");
    const scrim = document.createElement("div");
    scrim.className = "modal-scrim";
    scrim.innerHTML = `
      <div class="modal ${opts.size === "sm" ? "modal-sm" : opts.size === "lg" ? "modal-lg" : ""}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h2>${esc(opts.title || "")}</h2>
          <button class="icon-btn" data-close aria-label="Close">${App.icon("x")}</button>
        </div>
        <div class="modal-body">${opts.body || ""}</div>
        ${opts.foot ? `<div class="modal-foot${opts.footSplit ? " split" : ""}">${opts.foot}</div>` : ""}
      </div>`;
    root.appendChild(scrim);

    const handle = {
      el: scrim,
      close() {
        const i = modalStack.indexOf(handle);
        if (i >= 0) modalStack.splice(i, 1);
        scrim.remove();
        if (opts.onClose) opts.onClose();
      },
    };
    modalStack.push(handle);

    scrim.addEventListener("mousedown", (e) => { if (e.target === scrim) handle.close(); });
    scrim.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => handle.close()));
    if (opts.onMount) opts.onMount(scrim, handle);
    const firstInput = scrim.querySelector("input:not([type=checkbox]), textarea, select");
    if (firstInput) setTimeout(() => firstInput.focus(), 60);
    return handle;
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalStack.length) {
      modalStack[modalStack.length - 1].close();
    }
  });

  /* ---------- confirm dialog ---------- */
  UI.confirm = function (opts) {
    return new Promise((resolve) => {
      let settled = false;
      const h = UI.openModal({
        title: opts.title || "Are you sure?",
        size: "sm",
        body: `<p class="muted" style="font-size:13px; line-height:1.5;">${esc(opts.message || "This action cannot be undone.")}</p>`,
        foot: `
          <button class="btn btn-outline" data-close>Cancel</button>
          <button class="btn ${opts.danger === false ? "btn-primary" : "btn-danger"}" data-confirm>${esc(opts.confirmLabel || "Delete")}</button>`,
        onMount(el, handle) {
          el.querySelector("[data-confirm]").addEventListener("click", () => {
            settled = true; handle.close(); resolve(true);
          });
        },
        onClose() { if (!settled) resolve(false); },
      });
      return h;
    });
  };

  /* ---------- popover (one at a time) ---------- */
  let openPop = null;
  UI.closePopovers = function () {
    if (openPop) { openPop.remove(); openPop = null; }
  };
  UI.togglePopover = function (anchorEl, contentHTML) {
    if (openPop && openPop._anchor === anchorEl) { UI.closePopovers(); return; }
    UI.closePopovers();
    const pop = document.createElement("div");
    pop.className = "popover";
    pop.innerHTML = contentHTML;
    pop._anchor = anchorEl;
    anchorEl.closest(".pop-anchor").appendChild(pop);
    openPop = pop;
    // keep inside the viewport horizontally
    requestAnimationFrame(() => {
      const r = pop.getBoundingClientRect();
      if (r.left < 8) pop.style.transform = `translateX(calc(-50% + ${8 - r.left}px))`;
      else if (r.right > window.innerWidth - 8) pop.style.transform = `translateX(calc(-50% - ${r.right - window.innerWidth + 8}px))`;
    });
  };
  document.addEventListener("click", (e) => {
    if (openPop && !e.target.closest(".popover") && !e.target.closest("[data-popover-trigger]")) UI.closePopovers();
  });

  /* ---------- form helpers ---------- */
  UI.selectHTML = function (name, options, selected, attrs) {
    const opts = options.map(([v, label]) =>
      `<option value="${esc(v)}"${String(v) === String(selected) ? " selected" : ""}>${esc(label)}</option>`).join("");
    return `<select class="select" name="${esc(name)}" ${attrs || ""}>${opts}</select>`;
  };

  UI.subjectOptions = function (selected, allowNone) {
    const subs = App.state().subjects.map((s) => [s.name, s.name]);
    const opts = allowNone ? [["", "None"], ...subs] : [["", "Select subject…"], ...subs];
    return opts;
  };

  UI.categoryOptions = () => Object.entries(App.CATEGORIES).map(([k, v]) => [k, v.label]);
  UI.priorityOptions = () => Object.entries(App.PRIORITIES).map(([k, v]) => [k, v.label]);

  UI.readForm = function (rootEl) {
    const out = {};
    rootEl.querySelectorAll("input[name], select[name], textarea[name]").forEach((el) => {
      if (el.type === "checkbox") out[el.name] = el.checked;
      else if (el.type === "number") out[el.name] = el.value === "" ? "" : Number(el.value);
      else out[el.name] = el.value;
    });
    return out;
  };

  /* ---------- chips ---------- */
  UI.categoryChip = function (cat) {
    const c = App.CATEGORIES[cat];
    if (!c) return "";
    return `<span class="chip" style="background:var(--${c.cls});color:var(--${c.cls}-ink)">${esc(c.label)}</span>`;
  };
  UI.priorityChip = function (pri) {
    const p = App.PRIORITIES[pri] || App.PRIORITIES.medium;
    return `<span class="chip ${p.chip}">${esc(p.label)}</span>`;
  };
  UI.subjectChip = function (name) {
    if (!name) return "";
    const meta = App.subjectMeta(name);
    return `<span class="chip subj-chip" style="background:color-mix(in srgb, ${meta.color} 15%, var(--surface));color:color-mix(in srgb, ${meta.color} 62%, var(--ink) 38%)">${meta.emoji ? esc(meta.emoji) + " " : ""}${esc(name)}</span>`;
  };
  // "🧮 Math AA HL" — emoji-prefixed label for headings and reports
  UI.subjectLabel = function (name) {
    if (!name) return "";
    const meta = App.subjectMeta(name);
    return `${meta.emoji ? esc(meta.emoji) + " " : ""}${esc(name)}`;
  };
  UI.dueChip = function (task) {
    if (!task.due_date) return "";
    if (App.isOverdue(task)) return `<span class="chip chip-danger">${App.icon("calendar")} Overdue · ${esc(App.dates.fmtShort(task.due_date))}</span>`;
    if (App.isDueToday(task)) return `<span class="chip chip-warning">${App.icon("calendar")} Today</span>`;
    return `<span class="chip chip-plain">${App.icon("calendar")} ${esc(App.dates.fmtShort(task.due_date))}</span>`;
  };

  /* ---------- page head ---------- */
  UI.pageHead = function (title, sub, actionsHTML) {
    return `
      <div class="page-head">
        <div>
          <h1>${esc(title)}</h1>
          ${sub ? `<p class="sub">${esc(sub)}</p>` : ""}
        </div>
        ${actionsHTML ? `<div class="row wrap">${actionsHTML}</div>` : ""}
      </div>`;
  };

  UI.emptyState = function (icon, title, sub, actionHTML) {
    return `
      <div class="empty">
        ${App.icon(icon)}
        <div class="empty-title">${esc(title)}</div>
        ${sub ? `<div style="margin-top:3px">${esc(sub)}</div>` : ""}
        ${actionHTML || ""}
      </div>`;
  };

  UI.spinnerless = true; // everything is synchronous — no loading states needed

  /* ---------- sidebar ---------- */
  const NAV = [
    { group: "Overview", items: [
      { page: "dashboard", label: "Dashboard", icon: "dashboard" },
      { page: "timeline", label: "Timeline", icon: "clock" },
      { page: "calendar", label: "Calendar", icon: "calendar" },
    ]},
    { group: "Study", items: [
      { page: "study", label: "Study Session", icon: "timer" },
      { page: "focus", label: "Focus", icon: "target" },
      { page: "scheduler", label: "Scheduler", icon: "calendarClock" },
      { page: "analytics", label: "Analytics", icon: "chart" },
      { page: "coach", label: "Coach", icon: "messageCircle" },
    ]},
    { group: "IB", items: [
      { page: "subjects", label: "Subjects", icon: "book" },
      { page: "core", label: "Core Requirements", icon: "award" },
      { page: "grades", label: "Grades", icon: "gradcap" },
      { page: "university", label: "University", icon: "building" },
    ]},
    { group: "Workspace", items: [
      { page: "templates", label: "Templates", icon: "template" },
      { page: "notes", label: "Notes", icon: "fileText" },
      { page: "settings", label: "Settings", icon: "settings" },
    ]},
  ];

  App.renderSidebar = function () {
    const sb = document.getElementById("sidebar");
    if (!sb) return;
    const cur = App.currentPage();
    const s = App.state();
    const openCount = s.tasks.filter((t) => !t.completed).length;
    const overdueCount = s.tasks.filter((t) => App.isOverdue(t)).length;

    sb.innerHTML = `
      <div class="sidebar-brand">
        <div class="brand-mark"><svg class="brand-hex" viewBox="0 0 64 64" aria-hidden="true"><defs><mask id="bhx"><path d="M32 5 L55.4 18.5 L55.4 45.5 L32 59 L8.6 45.5 L8.6 18.5 Z" fill="#fff"/><g stroke="#000" stroke-width="3.4"><line x1="32" y1="32" x2="32" y2="5"/><line x1="32" y1="32" x2="55.4" y2="18.5"/><line x1="32" y1="32" x2="55.4" y2="45.5"/><line x1="32" y1="32" x2="32" y2="59"/><line x1="32" y1="32" x2="8.6" y2="45.5"/><line x1="32" y1="32" x2="8.6" y2="18.5"/></g></mask></defs><path d="M32 5 L55.4 18.5 L55.4 45.5 L32 59 L8.6 45.5 L8.6 18.5 Z" fill="#fff" mask="url(#bhx)"/></svg></div>
        <div>
          <div class="brand-name">${esc(s.settings.appName || "IB Tracker")}</div>
          <div class="brand-sub">IB Diploma</div>
        </div>
      </div>
      <button class="sidebar-search" data-open-search>
        ${App.icon("search")}
        <span>Search or add…</span>
        <span class="kbd-hint">${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}</span>
      </button>
      <nav class="sidebar-nav">
        ${NAV.map((g) => `
          <div class="nav-group-label">${esc(g.group)}</div>
          ${g.items.map((item) => {
            let count = "";
            if (item.page === "timeline" && openCount) count = `<span class="nav-count">${openCount}</span>`;
            if (item.page === "dashboard" && overdueCount) count = `<span class="nav-count" style="background:var(--danger-soft);color:var(--danger-ink)">${overdueCount}</span>`;
            return `
              <a class="nav-item ${cur === item.page ? "active" : ""}" href="#/${item.page}" data-nav>
                ${App.icon(item.icon)}
                <span>${esc(item.label)}</span>
                ${count}
              </a>`;
          }).join("")}
        `).join("")}
      </nav>
      <div class="sidebar-foot">
        <button class="btn btn-primary btn-block" data-action="new-task">${App.icon("plus")} Add Task</button>
      </div>`;

    sb.querySelectorAll("[data-nav]").forEach((a) =>
      a.addEventListener("click", () => UI.closeSidebar()));
    sb.querySelector('[data-action="new-task"]').addEventListener("click", () => {
      UI.closeSidebar();
      App.taskui.openTaskModal(null);
    });
    sb.querySelector("[data-open-search]").addEventListener("click", () => {
      UI.closeSidebar();
      App.search.open();
    });

    const mh = document.getElementById("mobile-header");
    mh.innerHTML = `
      <button class="icon-btn" data-open-sidebar aria-label="Menu">${App.icon("menu")}</button>
      <div class="row" style="gap:8px">
        <div class="brand-mark brand-mark-sm"><svg class="brand-hex" viewBox="0 0 64 64" aria-hidden="true"><defs><mask id="bhx"><path d="M32 5 L55.4 18.5 L55.4 45.5 L32 59 L8.6 45.5 L8.6 18.5 Z" fill="#fff"/><g stroke="#000" stroke-width="3.4"><line x1="32" y1="32" x2="32" y2="5"/><line x1="32" y1="32" x2="55.4" y2="18.5"/><line x1="32" y1="32" x2="55.4" y2="45.5"/><line x1="32" y1="32" x2="32" y2="59"/><line x1="32" y1="32" x2="8.6" y2="45.5"/><line x1="32" y1="32" x2="8.6" y2="18.5"/></g></mask></defs><path d="M32 5 L55.4 18.5 L55.4 45.5 L32 59 L8.6 45.5 L8.6 18.5 Z" fill="#fff" mask="url(#bhx)"/></svg></div>
        <span style="font-weight:700;font-size:14px">${esc(s.settings.appName || "IB Tracker")}</span>
      </div>`;
    mh.querySelector("[data-open-sidebar]").addEventListener("click", () => UI.openSidebar());
  };

  UI.openSidebar = function () {
    document.getElementById("sidebar").classList.add("open");
    document.getElementById("sidebar-scrim").classList.add("show");
  };
  UI.closeSidebar = function () {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-scrim").classList.remove("show");
  };
  document.getElementById("sidebar-scrim").addEventListener("click", () => UI.closeSidebar());

  /* ---------- level-up popup ---------- */
  App.showLevelUp = function (level) {
    document.querySelectorAll(".levelup-scrim").forEach((n) => n.remove());
    const el = document.createElement("div");
    el.className = "levelup-scrim";
    el.innerHTML = `
      <div class="levelup-card">
        <div class="levelup-emoji">🎉</div>
        <div class="levelup-title">LEVEL UP!</div>
        <div class="levelup-level">You reached Level ${level}!</div>
      </div>`;
    document.body.appendChild(el);
    App.sfx("levelup");
    const dismiss = () => el.remove();
    el.addEventListener("click", dismiss);
    setTimeout(dismiss, 2000);
  };

  /* ---------- sound effects (WebAudio, no assets) ---------- */
  /* Synthesised rather than bundled as .mp3 on purpose: the desktop updater
     only ever swaps index.html + css/ + js/, so audio files would never reach
     an installed copy through an update. These also stay tiny and offline. */

  // One context for the whole app. The old per-chime `new AudioContext()` leaked
  // one on every ding, and browsers cap how many a page may create.
  let audioCtx = null;
  function ctx() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    // Autoplay policy parks the context until a gesture; every cue follows one.
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  // Each cue is a list of notes: [frequency, start offset, length, peak gain].
  // Kept short and soft — this fires while someone is trying to concentrate.
  const CUES = {
    // ticking a task off: a bright, quick two-note lift
    task:     { type: "sine",     notes: [[784, 0, 0.3, 0.20], [1046.5, 0.09, 0.38, 0.18]] },
    // finishing a study session: a settled major triad, warmer and slower
    session:  { type: "sine",     notes: [[523.3, 0, 0.5, 0.16], [659.3, 0.11, 0.5, 0.15], [784, 0.22, 0.62, 0.16]] },
    // levelling up / streak milestone: a proper little fanfare
    levelup:  { type: "triangle", notes: [[523.3, 0, 0.32, 0.16], [659.3, 0.1, 0.32, 0.16], [784, 0.2, 0.34, 0.17], [1046.5, 0.3, 0.75, 0.19]] },
    streak:   { type: "triangle", notes: [[880, 0, 0.3, 0.15], [1174.7, 0.1, 0.3, 0.15], [1318.5, 0.2, 0.6, 0.16]] },
    // something went wrong: low, falling, quieter than the rest
    error:    { type: "sine",     notes: [[330, 0, 0.26, 0.13], [246.9, 0.13, 0.4, 0.12]] },
    // timer cues — the two original chime flavours, unchanged in character
    focus:    { type: "sine",     notes: [[523, 0, 0.52, 0.22], [784, 0.18, 0.52, 0.22]] },
    breakNow: { type: "sine",     notes: [[520, 0, 0.52, 0.22], [392, 0.18, 0.52, 0.22]] },
  };

  App.soundEnabled = function () {
    return App.state().settings.sound_enabled !== false; // default on
  };

  // Bulk actions call this once per item (completing 12 tasks, say). Replaying
  // the same cue inside a few hundred ms just sounds like a rattle, so the
  // first one wins and the rest are dropped.
  const lastPlayed = {};

  App.sfx = function (name) {
    const cue = CUES[name];
    if (!cue || !App.soundEnabled()) return;
    const t = Date.now();
    if (t - (lastPlayed[name] || 0) < 400) return;
    lastPlayed[name] = t;
    try {
      const ac = ctx();
      if (!ac) return;
      const start = ac.currentTime + 0.01;
      cue.notes.forEach(([freq, at, len, peak]) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.connect(g); g.connect(ac.destination);
        o.type = cue.type;
        o.frequency.value = freq;
        const t0 = start + at;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
        o.start(t0); o.stop(t0 + len + 0.02);
      });
    } catch (e) { /* audio may be blocked until first interaction — fine */ }
  };

  // Kept for the timer call sites: `up === false` is the falling break cue.
  App.chime = function (up) { App.sfx(up === false ? "breakNow" : "focus"); };

  /* ---------- desktop notification ---------- */
  /* Only worth showing when the window isn't the one being looked at — in the
     app itself the toast already says it. Permission is asked for lazily, on
     the first cue that actually needs it, never on load. */
  App.notificationsEnabled = function () {
    return "Notification" in window && App.state().settings.desktop_notifications !== false;
  };

  App.appIsFocused = function () {
    return !document.hidden && document.hasFocus();
  };

  App.notify = function (title, body) {
    if (!App.notificationsEnabled() || App.appIsFocused()) return;
    const show = () => {
      try {
        new Notification(title, { body: body || "", tag: "ib-tracker", silent: true });
      } catch (e) { /* unsupported or blocked — the toast still carries the message */ }
    };
    // Read the permission fresh — it can change from Settings, or from the OS,
    // while the app is open.
    const perm = Notification.permission;
    if (perm === "granted") show();
    else if (perm !== "denied") {
      try {
        Notification.requestPermission().then((p) => { if (p === "granted") show(); });
      } catch (e) { /* older callback-only implementations — skip */ }
    }
  };

  // Toast now, banner if they're looking at something else. `body` is the
  // longer line the OS banner gets room for; the toast keeps the short one.
  App.announce = function (msg, body) {
    App.toast(msg);
    App.notify(msg, body);
  };

  /* ---------- confetti (dependency-free) ---------- */
  App.confetti = function () {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:400";
    canvas.width = innerWidth; canvas.height = innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const colors = ["#4f46e5", "#7c6ff0", "#2a78d6", "#1baf7a", "#eda100", "#e87ba4"];
    const parts = [];
    for (let i = 0; i < 70; i++) {
      parts.push({
        x: innerWidth / 2 + (Math.random() - 0.5) * 200,
        y: innerHeight * 0.68,
        vx: (Math.random() - 0.5) * 11,
        vy: -(6 + Math.random() * 9),
        size: 5 + Math.random() * 5,
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
      });
    }
    let frame = 0;
    (function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.35; p.rot += p.vr;
        if (p.y < innerHeight + 30) alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - frame / 90);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      frame++;
      if (alive && frame < 100) requestAnimationFrame(tick);
      else canvas.remove();
    })();
  };
})();
