/* search.js — global command palette (⌘K / Ctrl-K).
   Finds tasks, subjects, courses and pages, and can create a task from a
   natural-language line ("Math IA due friday 2h high") via the coach parser. */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const D = App.dates;
  const S = (App.search = {});

  let overlay = null, selIdx = 0, results = [];

  const PAGES = [
    ["dashboard", "Dashboard", "dashboard"], ["timeline", "Timeline", "clock"], ["calendar", "Calendar", "calendar"],
    ["study", "Study Session", "timer"], ["focus", "Focus", "target"], ["scheduler", "Scheduler", "calendarClock"],
    ["analytics", "Analytics", "chart"], ["coach", "Coach", "messageCircle"], ["subjects", "Subjects", "book"],
    ["core", "Core Requirements", "award"], ["grades", "Grades", "gradcap"], ["university", "University", "building"],
    ["templates", "Templates", "template"], ["notes", "Notes", "fileText"], ["settings", "Settings", "settings"],
  ];

  function buildResults(q) {
    q = (q || "").trim();
    const ql = q.toLowerCase();
    const out = [];

    // natural-language quick-add
    if (q.length >= 2 && App.coach && App.coach.buildTaskFromText) {
      const spec = App.coach.buildTaskFromText(q);
      if (spec) {
        const bits = [spec.subject_name, spec.due_date ? "due " + D.fmtShort(spec.due_date) : "",
          spec.estimated_minutes ? App.fmtMinutes(spec.estimated_minutes) : "",
          spec.priority !== "medium" ? spec.priority + " priority" : ""].filter(Boolean).join(" · ");
        out.push({ type: "create", icon: "plus", label: `Create task: “${spec.title}”`, sub: bits,
          action: () => { App.createTask(spec); App.toast("Task added"); App.navigate("timeline"); } });
      }
    }

    if (ql) {
      App.state().tasks
        .filter((t) => !App.isArchived(t) && (t.title.toLowerCase().includes(ql) || (t.subject_name || "").toLowerCase().includes(ql)))
        .slice(0, 6)
        .forEach((t) => out.push({
          type: "task", icon: t.completed ? "checkCircle" : "clock", label: t.title,
          sub: [t.subject_name, t.due_date ? D.fmtShort(t.due_date) : "", t.completed ? "done" : ""].filter(Boolean).join(" · "),
          action: () => App.taskui.openTaskModal(t),
        }));
      App.state().subjects.filter((su) => su.name.toLowerCase().includes(ql)).slice(0, 3)
        .forEach((su) => out.push({ type: "subject", icon: "book", label: App.ui.subjectLabel(su.name), sub: "Subject", action: () => App.navigate("subjects") }));
      App.state().courses.filter((c) => (c.university_name + " " + c.course_name).toLowerCase().includes(ql)).slice(0, 3)
        .forEach((c) => out.push({ type: "course", icon: "building", label: `${c.university_name} — ${c.course_name}`, sub: "University", action: () => App.navigate("university") }));
    }

    const pages = PAGES.filter((p) => !ql || p[1].toLowerCase().includes(ql));
    (ql ? pages.slice(0, 6) : PAGES).forEach((p) =>
      out.push({ type: "page", icon: p[2], label: p[1], sub: "Go to page", action: () => App.navigate(p[0]) }));

    return out;
  }

  function renderResults() {
    const list = overlay.querySelector("[data-results]");
    list.innerHTML = results.length ? results.map((r, i) => `
      <button class="cmd-item ${i === selIdx ? "active" : ""}" data-idx="${i}">
        <span class="cmd-ic">${App.icon(r.icon)}</span>
        <span class="cmd-main">
          <span class="cmd-label">${esc(r.label)}</span>
          ${r.sub ? `<span class="cmd-sub">${esc(r.sub)}</span>` : ""}
        </span>
      </button>`).join("") : `<div class="cmd-empty">No matches</div>`;
    list.querySelectorAll("[data-idx]").forEach((b) => {
      b.addEventListener("mousemove", () => { selIdx = Number(b.dataset.idx); highlight(); });
      b.addEventListener("click", () => activate(Number(b.dataset.idx)));
    });
  }

  function highlight() {
    if (!overlay) return;
    overlay.querySelectorAll(".cmd-item").forEach((el, i) => el.classList.toggle("active", i === selIdx));
  }

  function activate(i) {
    const r = results[i];
    if (!r) return;
    close();
    r.action();
  }

  function update(q) { results = buildResults(q); selIdx = 0; renderResults(); }

  function onKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); selIdx = Math.min(results.length - 1, selIdx + 1); highlight(); ensureVisible(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); selIdx = Math.max(0, selIdx - 1); highlight(); ensureVisible(); }
    else if (e.key === "Enter") { e.preventDefault(); activate(selIdx); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  }

  function ensureVisible() {
    const el = overlay && overlay.querySelector(".cmd-item.active");
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  S.open = function (prefill) {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "cmd-scrim";
    overlay.innerHTML = `
      <div class="cmd-palette" role="dialog" aria-modal="true">
        <div class="cmd-input-row">
          ${App.icon("search")}
          <input class="cmd-input" placeholder="Search tasks & pages, or type a task to add…" aria-label="Search">
        </div>
        <div class="cmd-results" data-results></div>
        <div class="cmd-foot"><span>↑↓ navigate · ↵ open · esc close</span></div>
      </div>`;
    document.getElementById("modal-root").appendChild(overlay);
    const input = overlay.querySelector(".cmd-input");
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
    input.addEventListener("input", () => update(input.value));
    input.addEventListener("keydown", onKey);
    if (prefill) input.value = prefill;
    update(input.value);
    setTimeout(() => input.focus(), 30);
  };

  function close() { if (overlay) { overlay.remove(); overlay = null; } }
  S.close = close;

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      if (overlay) close(); else S.open();
    }
  });
})();
