/* core.js — store, persistence, dates, router, tiny utilities */
(function () {
  "use strict";
  const App = (window.App = window.App || {});

  /* ---------- utilities ---------- */
  App.uid = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  };

  App.esc = function (s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };

  App.escAttr = App.esc;

  /* ---------- rich-text sanitizer (Notes) ----------
     Note bodies are real HTML, so anything pasted in — or restored from a
     backup file — has to be cleaned before it reaches the DOM. Parsing happens
     via DOMParser, which builds an INERT document: no scripts run and no images
     load while we inspect it. (A detached div + innerHTML is NOT inert — an
     <img onerror> fires there — so never use that for untrusted HTML.)
     Whitelist approach: keep basic formatting, drop everything else. */
  const KEEP_TAGS = new Set(["B","STRONG","I","EM","U","S","STRIKE","DEL","H1","H2","H3","H4","H5","H6",
    "UL","OL","LI","A","BR","DIV","P","CODE","PRE","BLOCKQUOTE","HR"]);
  const DROP_TAGS = new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE","IFRAME","OBJECT","EMBED","SVG","MATH",
    "IMG","VIDEO","AUDIO","SOURCE","CANVAS","FORM","INPUT","BUTTON","SELECT","TEXTAREA","LINK","META","BASE"]);
  const SAFE_URL = /^(https?:|mailto:)/i;

  App.sanitizeHtml = function (html) {
    const src = String(html || "");
    if (!src) return "";
    const doc = new DOMParser().parseFromString(src, "text/html");
    const walk = (node) => {
      // iterate over a copy — we mutate the tree as we go
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) continue;                 // text — always fine
        if (child.nodeType !== 1) { child.remove(); continue; } // comments etc.
        const tag = child.tagName;
        if (DROP_TAGS.has(tag)) { child.remove(); continue; }
        walk(child);
        if (!KEEP_TAGS.has(tag)) {                          // unknown wrapper: keep the text, drop the tag
          child.replaceWith(...Array.from(child.childNodes));
          continue;
        }
        for (const attr of Array.from(child.attributes)) {  // strip styles, handlers, everything unlisted
          const name = attr.name.toLowerCase();
          const keep =
            (tag === "A" && name === "href" && SAFE_URL.test(attr.value.trim())) ||
            (tag === "UL" && name === "class" && attr.value === "checklist") ||
            (tag === "LI" && name === "class" && attr.value === "checked");
          if (!keep) child.removeAttribute(attr.name);
        }
        if (tag === "A") { child.setAttribute("target", "_blank"); child.setAttribute("rel", "noopener noreferrer"); }
      }
    };
    walk(doc.body);
    return doc.body.innerHTML;
  };

  // HTML -> plain text, for note previews and search. Deliberately avoids the
  // DOM: tags are stripped textually and entities decoded via a <textarea>,
  // whose contents the parser treats as text, so nothing can execute.
  const _decoder = document.createElement("textarea");
  App.htmlToText = function (html) {
    const stripped = String(html || "")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/?(h[1-6]|div|p|li|ul|ol|blockquote|pre|tr|br)\b[^>]*>/gi, " ") // block edges become spaces
      .replace(/<[^>]*>/g, "");
    _decoder.innerHTML = stripped;
    return (_decoder.value || "").replace(/ /g, " ");
  };

  App.clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  // User-supplied link -> a URL safe to put in href, or "" if it isn't one.
  // Only http/https: a "javascript:" or "data:" URL in a link the user pasted
  // would run as soon as they clicked it. A bare "oxford.ac.uk" is assumed https.
  App.safeURL = function (url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : "https://" + raw;
    try {
      const u = new URL(withScheme);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
    } catch (e) { return ""; }
  };

  // "https://www.commonapp.org/apply" -> "commonapp.org" (for link labels)
  App.urlHost = function (url) {
    try { return new URL(App.safeURL(url)).hostname.replace(/^www\./, ""); }
    catch (e) { return ""; }
  };

  App.debounce = function (fn, ms) {
    let t;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  };

  /* ---------- dates (all local-timezone, no UTC pitfalls) ---------- */
  const D = (App.dates = {});

  // Date -> "YYYY-MM-DD" in local time
  D.toStr = function (date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  // "YYYY-MM-DD" -> local Date at midnight (never UTC-parsed)
  D.parse = function (str) {
    if (!str) return null;
    const [y, m, d] = str.slice(0, 10).split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  };

  D.today = () => D.toStr(new Date());

  D.addDays = function (str, n) {
    const d = D.parse(str);
    d.setDate(d.getDate() + n);
    return D.toStr(d);
  };

  D.addMonths = function (str, n) {
    const d = D.parse(str);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return D.toStr(d);
  };

  D.diffDays = function (a, b) { // b - a in whole days
    return Math.round((D.parse(b) - D.parse(a)) / 86400000);
  };

  D.dayOfWeek = (str) => D.parse(str).getDay(); // 0=Sun..6=Sat

  D.mondayOf = function (str) {
    const d = D.parse(str);
    const dow = d.getDay();
    d.setDate(d.getDate() - ((dow + 6) % 7));
    return D.toStr(d);
  };

  const MONTHS_S = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DOWS_L = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  D.fmtShort = function (str) { // "Mar 4"
    const d = D.parse(str);
    return d ? `${MONTHS_S[d.getMonth()]} ${d.getDate()}` : "";
  };
  D.fmtMed = function (str) { // "Mar 4, 2026"
    const d = D.parse(str);
    return d ? `${MONTHS_S[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : "";
  };
  D.fmtLong = function (str) { // "Wednesday, March 4"
    const d = D.parse(str);
    return d ? d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "";
  };
  D.fmtMonthYear = function (str) {
    const d = D.parse(str);
    return d ? d.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "";
  };

  // ISO datetime -> local "YYYY-MM-DD"
  D.isoToDateStr = function (iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d) ? null : D.toStr(d);
  };
  // ISO datetime -> minutes from local midnight
  D.isoToMin = function (iso) {
    const d = new Date(iso);
    return isNaN(d) ? 0 : d.getHours() * 60 + d.getMinutes();
  };

  D.minToLabel = function (min) { // 570 -> "9:30 AM"
    const h = Math.floor(min / 60), m = min % 60;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const ap = h < 12 ? "AM" : "PM";
    return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, "0")} ${ap}`;
  };

  App.fmtMinutes = function (mins) {
    mins = Math.round(mins || 0);
    if (!mins) return "0m";
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  };

  App.fmtClock = function (totalSec) {
    totalSec = Math.max(0, Math.floor(totalSec));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  /* ---------- store ---------- */
  const STORAGE_KEY = "ib-study-tracker:v1";

  /* The coach's default model, in ONE place — core.js loads before everything
     else, so coach.js and the Settings page both read it from here.

     It used to be written out as a literal in three files. OpenRouter then
     retired the model, and because the string was duplicated, the app went on
     offering a model that no longer existed: adding an API key and leaving the
     default gave you an opaque API error and a coach that simply didn't work.
     RETIRED_MODELS in migrate() remaps saved copies as they are read. */
  App.DEFAULT_AI_MODEL = "anthropic/claude-sonnet-5";

  App.defaultSettings = function () {
    return {
      appName: "IB Tracker",
      hours_per_day: { monday: 4, tuesday: 4, wednesday: 4, thursday: 4, friday: 4, saturday: 2, sunday: 2 },
      work_start_hour: 8,
      work_end_hour: 22,
      ee_grade: "",
      tok_grade: "",
      theme: "auto",
      coach_tone: "warm",           // 'warm' | 'direct'
      ai_model: App.DEFAULT_AI_MODEL,
      coach_ai_enabled: true,       // header toggle — AI mode used only when this AND a key are set
      ai_api_key: "",               // optional — OpenRouter key, enables AI coach; never exported in backups
      max_streak: 0,
      exam_date: "",                // IB exam session start date (YYYY-MM-DD) — powers the Dashboard countdown
      last_backup_at: "",           // ISO timestamp of the last exported backup (for the safety-net nudge)
      weekly_goal_hours: 10,        // target focused-study hours per week (0 = off)
      target_points: 40,            // IB points goal for the diploma projection
      pomodoro_enabled: false,      // Study Session pomodoro cycling
      pomodoro_focus_min: 25,
      pomodoro_break_min: 5,
      sound_enabled: true,          // chimes on completions, sessions, level-ups, errors
      desktop_notifications: true,  // OS banner for timer cues while the app is in the background
      last_streak_milestone: 0,     // highest streak day-count already celebrated (resets when the streak breaks)
      default_materials: [],        // starting materials for a new university course ([] = built-in list)
      default_key_steps: [],        // starting application steps for a new course ([] = built-in list)
      auto_update_check: true,      // look for a new version once a day (never installs on its own)
    };
  };

  // Seeded into state.portals on first load; editable and removable afterwards.
  // Defined here (not data.js) because migrate() runs while core.js loads.
  App.DEFAULT_PORTALS = [
    { label: "Common App", url: "https://www.commonapp.org/" },
    { label: "BridgeU", url: "https://app.bridge-u.com/" },
  ];

  App.emptyData = function () {
    return {
      version: 1,
      tasks: [], subtasks: [], subjects: [], grades: [], sessions: [],
      busyBlocks: [], templates: [], savedFilters: [], courses: [],
      gradeSnapshots: [],
      portals: [],        // [{ id, label, url }] — University quick-launch links
      scratchpad: "",     // legacy free-form quick notes (migrated into notes[])
      notes: [],          // [{ id, title, body, pinned, created_at, updated_at }]
      focus: App.defaultFocus(),
      settings: App.defaultSettings(),
      ui: { welcomed: false },
      timer: null,        // floating single-task timer state
      studySession: null, // study-session page state
      coach: { messages: [] },
    };
  }

  // Focus-mode state: an allowlist of sites/apps you permit yourself during a
  // locked session, plus the running "times I left" counter for the current lock.
  App.defaultFocus = function () {
    return {
      allowlist: [],      // [{ id, label }] — sites/apps you allow yourself
      locked: false,      // true while a lock-in session is active
      leaves: 0,          // times the app lost focus during this lock session
      lockedAt: "",       // ISO timestamp the current lock started
    };
  };;

  function migrate(data) {
    const base = App.emptyData();
    // A restored backup is untrusted JSON. JSON.parse keeps "__proto__" as a
    // real own property, and Object.assign copies with [[Set]] — which finds the
    // Object.prototype accessor and swaps this object's prototype for whatever
    // the file said. Drop it before merging; nothing legitimate uses that key.
    if (data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "__proto__")) {
      Reflect.deleteProperty(data, "__proto__");
    }
    const out = Object.assign(base, data);
    out.settings = Object.assign(App.defaultSettings(), data.settings || {});
    out.ui = Object.assign({
      welcomed: false, backup_snooze_until: "", tour_done: false,
      update_last_check: "",        // ISO timestamp of the last version check
      update_dismissed_version: "", // banner hidden for this specific version
      portals_seeded: false,        // default University links added once
      license_key: "",              // the signed key as pasted; verified on boot
      license_date_seen: "",        // furthest date ever seen — defeats clock rollback
      trial_started_at: "",         // first launch; the 7-day trial runs from here
      setup_done: false,            // the first-run wizard has been finished or skipped
      page_intros_seen: [],         // pages whose first-visit explainer has been dismissed
      checklist_done: false,        // getting-started checklist hidden by hand
    }, data.ui || {});
    if (!Array.isArray(out.ui.page_intros_seen)) out.ui.page_intros_seen = [];
    if (typeof out.scratchpad !== "string") out.scratchpad = "";
    out.focus = Object.assign(App.defaultFocus(), data.focus || {});
    if (!Array.isArray(out.focus.allowlist)) out.focus.allowlist = [];
    for (const k of ["tasks","subtasks","subjects","grades","sessions","busyBlocks","templates","savedFilters","courses","gradeSnapshots","notes","portals"]) {
      if (!Array.isArray(out[k])) out[k] = [];
    }
    // Seed the two common portals once. Guarded by a flag, not by emptiness, so
    // deleting them all doesn't resurrect them on the next load.
    if (!out.ui.portals_seeded) {
      out.ui.portals_seeded = true;
      if (!out.portals.length) {
        out.portals = App.DEFAULT_PORTALS.map((p) => ({ id: App.uid(), label: p.label, url: p.url }));
      }
    }
    // One-time lift: the old single scratchpad becomes the first proper note.
    if (!out.notes.length && out.scratchpad.trim()) {
      const now = new Date().toISOString();
      out.notes.push({ id: App.uid(), title: "Scratchpad", body: out.scratchpad, pinned: false, created_at: now, updated_at: now });
    }
    // the per-task Notes field was retired — drop any leftover task notes
    out.tasks.forEach((t) => { if (t && "notes" in t) delete t.notes; });
    /* Dependencies are gone; a predecessor says the same thing more simply and
       two ways to express "do this first" only ever confused people. The field
       is dropped rather than converted, which does mean a task that was held
       back by a dependency is now actionable — deliberate, and called out in
       the release notes rather than left to be noticed. */
    out.tasks.forEach((t) => { if (t && "dependencies" in t) delete t.dependencies; });
    // Models we used to ship that OpenRouter has since removed. A saved
    // ai_model pointing at a retired model fails at request time with a bare
    // API error and no hint in the UI, so changing the default is not enough —
    // an existing install has the dead ID saved and would never see the new
    // one. Like every lift in here this corrects `state` on load and is not
    // written back until something else saves, so it simply runs again next
    // launch; the coach always reads through state, so it never sees the dead
    // ID either way. Only remaps IDs this app chose — a model the student
    // typed in themselves is left alone.
    const RETIRED_MODELS = {
      "anthropic/claude-3.7-sonnet": "anthropic/claude-sonnet-5",
      "google/gemini-2.0-flash-001": "google/gemini-2.5-flash",
    };
    if (RETIRED_MODELS[out.settings.ai_model]) {
      out.settings.ai_model = RETIRED_MODELS[out.settings.ai_model];
    }
    if (!out.coach || !Array.isArray(out.coach.messages)) out.coach = { messages: [] };
    return out;
  }

  let state;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    /* A first-ever launch goes through migrate() too. It used to take
       emptyData() raw, which meant the very first run was the one shape of
       state that had none of the ui defaults on it: page_intros_seen and
       friends were simply absent, and every reader had to guard with `|| []`
       or crash on day one. It also skipped the default University portals, so
       a fresh install quietly lacked links the site advertises.

       migrate() is idempotent and seeds by flag rather than by emptiness, so
       running it over an empty document is safe and makes every path produce
       identically-shaped state. */
    state = migrate(raw ? JSON.parse(raw) : App.emptyData());
  } catch (e) {
    console.error("Failed to load saved data:", e);
    state = App.emptyData();
  }

  let persistError = false;
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      persistError = false;
    } catch (e) {
      if (!persistError && App.toast) App.toast("Couldn't save — storage is full", "error");
      persistError = true;
      console.error("Persist failed:", e);
    }
  }

  const listeners = new Set();
  App.state = () => state;
  App.subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  /* Read-only mode (an expired or missing license) is enforced here, at the
     one place every change funnels through — 93 call sites reach state only
     via update(). Reading, searching, reports and Export backup all keep
     working: data is never held hostage, you just can't add to it.

     {system: true} is the exception, for writes that must survive read-only —
     entering a license key, dismissing a banner, the updater's bookkeeping.
     It marks plumbing, never a user edit. */
  let blockedToastAt = 0;
  function blockedByLicense(opts) {
    if (opts && opts.system) return false;
    if (!App.license || !App.license.readOnly || !App.license.readOnly()) return false;
    const now = Date.now();
    if (now - blockedToastAt > 4000) {          // one nudge, not one per keystroke
      blockedToastAt = now;
      if (App.toast) App.toast("Read-only — add a license key in Settings to make changes", "error");
    }
    return true;
  }
  // Silent query for the UI (disabling buttons); doesn't nudge.
  App.writeBlocked = () => !!(App.license && App.license.readOnly && App.license.readOnly());

  // update(fn, {silent, system}) — fn mutates state; then persist; then re-render unless silent
  App.update = function (fn, opts) {
    if (blockedByLicense(opts)) return false;
    fn(state);
    persist();
    if (!opts || !opts.silent) listeners.forEach((l) => { try { l(); } catch (e) { console.error(e); } });
    return true;
  };

  /* Three pieces of `ui` belong to the machine rather than to the data, and so
     survive every wholesale replacement (erase, restore a backup, load the
     sample set):

     • trial_started_at  — otherwise "Erase all data" hands out a fresh 7-day
       trial, which turns the paywall into a formality.
     • license_date_seen — the anti-rollback high-water mark. Letting it reset
       would undo the same protection from the other direction.
     • license_key       — erasing your tasks should not confiscate something
       you paid for. Without this, a licensed user who erases their data lands
       with no key AND a spent trial, i.e. locked out of their own app.

     Backups already have the key and the date stamp stripped on export, so a
     restore was never going to supply them anyway; keeping the current
     machine's values is the only sensible answer. */
  const MACHINE_UI_KEYS = ["trial_started_at", "license_date_seen", "license_key"];

  App.replaceState = function (newData, opts) {
    if (blockedByLicense(opts)) return false;
    const carried = {};
    for (const k of MACHINE_UI_KEYS) {
      const v = state && state.ui ? state.ui[k] : "";
      if (v) carried[k] = v;
    }
    state = migrate(newData);
    Object.assign(state.ui, carried);
    persist();
    listeners.forEach((l) => { try { l(); } catch (e) { console.error(e); } });
    return true;
  };

  App.STORAGE_KEY = STORAGE_KEY;

  /* ---------- router (hash-based) ---------- */
  App.pages = {}; // name -> { title, render(container), mount?(container) }

  App.currentPage = function () {
    const h = (location.hash || "#/dashboard").replace(/^#\//, "");
    return h.split("?")[0] || "dashboard";
  };

  App.navigate = function (name) {
    if (App.currentPage() === name) { App.render(); return; }
    location.hash = "#/" + name;
  };

  /* ---------- render loop ---------- */
  // Coalesce bursts of updates into one render per microtask.
  // (Not requestAnimationFrame — it never fires in hidden tabs, which would
  // silently stall the UI.)
  let renderScheduled = false;
  App.render = function () {
    if (renderScheduled) return;
    renderScheduled = true;
    queueMicrotask(() => {
      renderScheduled = false;
      App.renderNow();
    });
  };

  App.renderNow = function () {
    const name = App.currentPage();
    const page = App.pages[name] || App.pages.dashboard;
    const main = document.getElementById("main");
    if (!page || !main) return;
    App.ui && App.ui.closePopovers && App.ui.closePopovers();
    const appEl = document.getElementById("app");
    if (appEl) appEl.classList.toggle("focus-active", name === "focus");
    // run a page's onEnter once, when navigating INTO it (not on same-page re-renders)
    if (App._lastPage !== name) {
      App._lastPage = name;
      if (page.onEnter) { try { page.onEnter(); } catch (e) { console.error(e); } }
    }
    main.innerHTML = page.render();
    /* Slot the first-visit explainer in under the page title. Done here rather
       than inside fifteen render() functions: the copy stays in one place, and
       a page added later gets it without touching this. */
    if (App.pageIntroHTML) {
      const intro = App.pageIntroHTML(name);
      if (intro) {
        const pageEl = main.querySelector(".page");
        const head = pageEl && pageEl.querySelector(".page-head");
        if (head) head.insertAdjacentHTML("afterend", intro);
        else if (pageEl) pageEl.insertAdjacentHTML("afterbegin", intro);
      }
    }
    if (page.mount) page.mount(main);
    if (App.mountPageIntro) App.mountPageIntro(main);
    App.renderChrome();
    // Last, deliberately: renderChrome rebuilds the sidebar, so running this
    // before it left the sidebar's own Add Task button enabled and lying.
    if (App.applyReadOnly) App.applyReadOnly(document);
    document.title = `${page.title} · ${state.settings.appName || "IB Tracker"}`;
  };

  App.renderChrome = function () {
    if (App.renderSidebar) App.renderSidebar();
    if (App.timerUI && App.timerUI.renderFloating) App.timerUI.renderFloating();
    if (App.coachUI && App.coachUI.renderBubble) App.coachUI.renderBubble();
  };

  /* ---------- theme ---------- */
  App.applyTheme = function () {
    const pref = state.settings.theme || "auto";
    const dark = pref === "dark" || (pref === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => App.applyTheme());
})();
