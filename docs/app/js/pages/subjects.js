/* pages/subjects.js — matrix of subject tiles; tap one for a full dossier.
   Archived tasks (completed + past due) are excluded everywhere here, so the
   per-subject progress bars reflect only currently-relevant work. */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = App.ui;
  const TK = App.taskui;
  const D = App.dates;

  let selected = null; // subject name being viewed ("" = the No-subject card), or null for the matrix

  // Everything we know about one subject — tasks (non-archived), grade, study, uni.
  function subjectData(name) {
    const s = App.state();
    const isNo = name === "";
    // Like the Dashboard: archived tasks (completed & past their due date) drop
    // off completely — counts, bar and lists. A task completed on or before its
    // due date still counts until that date passes; once everything's done and
    // past due there are simply no tasks left (0/0 → 0%), which is correct.
    const tasks = s.tasks.filter((t) => (t.subject_name || "") === name && !App.isArchived(t));
    const open = tasks.filter((t) => !t.completed);
    const done = tasks.filter((t) => t.completed);
    const total = tasks.length;
    const pct = total ? Math.round((done.length / total) * 100) : 0;
    const grade = isNo ? null : (s.grades.find((g) => g.subject_name === name) || null);
    const sub = isNo ? null : s.subjects.find((x) => x.name === name);
    const level = sub ? (sub.level || "") : (isNo ? "" : App.parseSubjectLevel(name).level);

    const sessions = s.sessions.filter((x) => (x.subject_name || "") === name);
    const totalMin = sessions.reduce((sum, x) => sum + App.sessionMinutes(x), 0);
    const weekStart = D.mondayOf(D.today());
    const weekMin = sessions.reduce((sum, x) => {
      const ds = D.isoToDateStr(x.start_time);
      return ds && ds >= weekStart ? sum + App.sessionMinutes(x) : sum;
    }, 0);
    const lastStudied = sessions.reduce((mx, x) => {
      const ds = D.isoToDateStr(x.start_time);
      return ds && ds > mx ? ds : mx;
    }, "");

    const uniReqs = [];
    if (!isNo) {
      for (const c of s.courses) {
        for (const r of (c.requirements || [])) {
          if (r.subject_name === name) uniReqs.push({ course: c, grade: r.grade });
        }
      }
    }

    const meta = isNo ? { emoji: "📂", color: "var(--ink-3)" } : App.subjectMeta(name);
    return { name, isNo, meta, level, tasks, open, done, total, pct, grade, sessions, totalMin, weekMin, lastStudied, uniReqs };
  }

  /* ---------- matrix tile ---------- */
  function tileHTML(d) {
    const grade = d.grade;
    return `
      <button class="subj-tile" data-subject="${esc(d.name)}" style="border-top-color:${d.meta.color}">
        <div class="st-head">
          <span class="st-emoji">${d.meta.emoji || "📘"}</span>
          <div class="st-name-wrap">
            <div class="st-name">${d.isNo ? "No subject" : esc(App.parseSubjectLevel(d.name).base || d.name)}</div>
            ${d.level ? `<span class="st-level">${d.level}</span>` : (d.isNo ? "" : "")}
          </div>
          ${grade && grade.current_grade
            ? (() => {
                // the arrow points at work still to do — once you're there it's noise
                const chasing = grade.target_grade && grade.current_grade < grade.target_grade;
                const met = grade.target_grade && grade.current_grade >= grade.target_grade;
                const title = chasing ? `Current ${grade.current_grade}, target ${grade.target_grade}`
                  : met ? `Current ${grade.current_grade} — at or above target ${grade.target_grade}`
                  : "Current grade";
                return `<span class="st-grade${met ? " met" : ""}" title="${title}">${grade.current_grade}${chasing ? `<i>→${grade.target_grade}</i>` : ""}</span>`;
              })()
            : ""}
        </div>
        <div class="st-prog">
          <div class="progress thin"><span class="${d.pct === 100 && d.total ? "good" : ""}" style="width:${d.pct}%${d.total && d.pct !== 100 ? `;background:${d.meta.color}` : ""}"></span></div>
          <div class="st-prog-label">${d.total ? `${d.done.length}/${d.total} done` : "No tasks yet"}${d.open.length ? ` · ${d.open.length} open` : ""}</div>
        </div>
      </button>`;
  }

  /* ---------- grade ring (current / 7, target below) ---------- */
  function gradeRingHTML(d) {
    const cur = d.grade && d.grade.current_grade ? d.grade.current_grade : 0;
    const tgt = d.grade && d.grade.target_grade ? d.grade.target_grade : null;
    const r = 46, circ = 2 * Math.PI * r;
    const offset = circ - App.clamp(cur / 7, 0, 1) * circ;
    return `
      <div class="subj-grade">
        <div class="prog-ring-wrap" style="width:136px;height:136px;margin:2px auto">
          <svg viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="9"/>
            <circle cx="60" cy="60" r="${r}" fill="none" stroke="${d.meta.color}" stroke-width="9"
              stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round" style="transition:stroke-dashoffset .7s ease"/>
          </svg>
          <div class="prog-ring-center">
            <span class="v">${cur || "—"}</span>
            <span class="l">/ 7</span>
          </div>
        </div>
        <div class="subj-target">${tgt ? `Target <b>${tgt}</b>` : `<span class="muted">No target set</span>`}</div>
        ${(() => {
          if (!d.grade || !d.grade.current_grade) return `<button class="btn btn-outline btn-sm mt-2" data-go-grades>${App.icon("gradcap")} Add a grade</button>`;
          if (tgt && cur < tgt) return `<div class="subj-gap warn">${tgt - cur} to go to target</div>`;
          if (tgt && cur >= tgt) return `<div class="subj-gap good">At or above target 🎯</div>`;
          return "";
        })()}
      </div>`;
  }

  function miniStat(v, l) {
    return `<div class="subj-mini"><div class="v">${v}</div><div class="l">${esc(l)}</div></div>`;
  }

  /* ---------- single-subject detail ---------- */
  function detailHTML(d) {
    const taskMap = App.taskMap();
    const ordered = App.subjectOrder(d.tasks, taskMap);
    const lastLabel = d.lastStudied
      ? (() => { const n = D.diffDays(d.lastStudied, D.today()); return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n}d ago`; })()
      : "—";

    return `
      <div class="page">
        <button class="btn btn-ghost btn-sm subj-back" data-back>${App.icon("chevL")} All subjects</button>

        <div class="subj-detail-head" style="border-left:4px solid ${d.meta.color}">
          <span class="st-emoji big">${d.meta.emoji || "📘"}</span>
          <div style="flex:1;min-width:0">
            <h1>${d.isNo ? "No subject" : esc(d.name)}</h1>
            <p class="sub muted">${d.open.length} open · ${d.done.length} done${d.totalMin ? ` · ${App.fmtMinutes(d.totalMin)} studied` : ""}</p>
          </div>
          <button class="btn btn-primary" data-add-task-subj>${App.icon("plus")} Add task</button>
        </div>

        <div class="subj-detail-grid">
          ${d.isNo ? "" : `<div class="card card-pad subj-grade-card">${gradeRingHTML(d)}</div>`}
          <div class="stack">
            <div class="card card-pad">
              <div class="section-label">Study</div>
              <div class="subj-mini-stats">
                ${miniStat(App.fmtMinutes(d.weekMin), "This week")}
                ${miniStat(App.fmtMinutes(d.totalMin), "Total logged")}
                ${miniStat(d.sessions.length, d.sessions.length === 1 ? "Session" : "Sessions")}
                ${miniStat(lastLabel, "Last studied")}
              </div>
            </div>
            <div class="card card-pad">
              <div class="row between mb-2">
                <span class="section-label" style="margin-bottom:0">Task progress</span>
                <span class="muted small">${d.done.length}/${d.total} done</span>
              </div>
              <div class="progress"><span class="${d.pct === 100 && d.total ? "good" : ""}" style="width:${d.pct}%;${d.total && d.pct !== 100 ? `background:${d.meta.color}` : ""}"></span></div>
              <p class="muted small" style="margin-top:7px">${d.total ? `${d.pct}% complete · ${d.open.length} still open` : "No tasks for this subject yet"}</p>
            </div>
            ${d.uniReqs.length ? `
              <div class="card card-pad">
                <div class="section-label">University requirements</div>
                <div class="stack-sm" style="gap:6px">
                  ${d.uniReqs.map((rq) => {
                    const cur = d.grade ? (d.grade.current_grade || 0) : 0;
                    const met = cur >= rq.grade;
                    return `
                      <div class="subj-req ${met ? "met" : ""}">
                        <span class="sr-name">${esc(rq.course.university_name)} — ${esc(rq.course.course_name)}</span>
                        <span class="sr-val">needs ${rq.grade}${d.grade ? ` · you have ${cur}` : ""} ${met ? "✓" : ""}</span>
                      </div>`;
                  }).join("")}
                </div>
              </div>` : ""}
          </div>
        </div>

        <div class="section-label">${d.isNo ? "Tasks with no subject" : "Tasks"}</div>
        <div data-task-region>
          ${ordered.length
            ? `<div class="task-list">${ordered.map((t) => TK.taskCardHTML(t, { taskMap })).join("")}</div>`
            : UI.emptyState("checkCircle", "No tasks for this subject", "Nothing open or recently completed here",
                `<button class="btn btn-outline btn-sm" data-add-task-subj>${App.icon("plus")} Add a task</button>`)}
        </div>
      </div>`;
  }

  App.pages.subjects = {
    title: "Subjects",
    onEnter() { selected = null; }, // always land on the matrix
    render() {
      const s = App.state();
      const registered = s.subjects.map((x) => x.name);

      // detail view — but fall back to the matrix if the subject vanished
      if (selected !== null) {
        const exists = selected === "" || registered.includes(selected) ||
          s.tasks.some((t) => t.subject_name === selected && !App.isArchived(t));
        if (exists) return detailHTML(subjectData(selected));
        selected = null;
      }

      // matrix — registered subjects, then any stray subject names in use, then a No-subject card
      const strays = [...new Set(s.tasks.filter((t) => !App.isArchived(t)).map((t) => t.subject_name).filter(Boolean))]
        .filter((n) => !registered.includes(n));
      const names = [...registered, ...strays];
      const hasNoSubject = s.tasks.some((t) => !App.isArchived(t) && !t.subject_name);

      return `
        <div class="page">
          ${UI.pageHead("Subjects", "Your subjects at a glance — tap one for the full picture",
            `<button class="btn btn-primary" data-add-task>${App.icon("plus")} Add Task</button>`)}
          ${names.length || hasNoSubject ? `
            <div class="subj-matrix">
              ${names.map((n) => tileHTML(subjectData(n))).join("")}
              ${hasNoSubject ? tileHTML(subjectData("")) : ""}
            </div>` :
            UI.emptyState("book", "No subjects yet",
              "Add your six IB subjects in Settings, then create tasks and record grades",
              `<button class="btn btn-outline btn-sm" data-go-settings>Open Settings</button>`)}
        </div>`;
    },

    mount(el) {
      const back = el.querySelector("[data-back]");
      if (back) back.addEventListener("click", () => { selected = null; App.render(); });

      el.querySelectorAll("[data-subject]").forEach((tile) =>
        tile.addEventListener("click", () => { selected = tile.dataset.subject; App.render(); }));

      const addTask = el.querySelector("[data-add-task]");
      if (addTask) addTask.addEventListener("click", () => TK.openTaskModal(null));
      el.querySelectorAll("[data-add-task-subj]").forEach((b) =>
        b.addEventListener("click", () => TK.openTaskModal(null, { subject_name: selected || "" })));

      const goSettings = el.querySelector("[data-go-settings]");
      if (goSettings) goSettings.addEventListener("click", () => App.navigate("settings"));
      const goGrades = el.querySelector("[data-go-grades]");
      if (goGrades) goGrades.addEventListener("click", () => App.navigate("grades"));

      const region = el.querySelector("[data-task-region]");
      if (region) TK.bindTaskList(region);
    },
  };
})();
