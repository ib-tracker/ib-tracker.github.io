/* pages/dashboard.js */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = App.ui;
  const TK = App.taskui;
  const D = App.dates;

  function statTile(icon, label, value, bg, ink) {
    return `
      <div class="card stat-tile">
        <div class="stat-icon" style="background:${bg};color:${ink}">${App.icon(icon)}</div>
        <div>
          <div class="stat-value">${value}</div>
          <div class="stat-label">${esc(label)}</div>
        </div>
      </div>`;
  }

  function welcomeHTML() {
    return `
      <div class="card card-pad mb-6" style="background:linear-gradient(135deg, var(--accent-soft), var(--surface));border-color:var(--accent-soft)">
        <div class="row" style="gap:14px;align-items:flex-start">
          <div class="stat-icon" style="background:var(--accent);color:#fff;flex-shrink:0">${App.icon("sparkles")}</div>
          <div style="flex:1">
            <h2 style="font-size:16px">Welcome to your IB study tracker</h2>
            <p class="muted" style="margin-top:4px;font-size:13px;line-height:1.5">
              Everything is stored privately on this computer — no account, no internet needed.
              Take a quick tour, explore with sample data, or dive right in.
            </p>
            <div class="row wrap mt-4">
              <button class="btn btn-primary" data-w-tour>${App.icon("sparkles")} Take a tour</button>
              <button class="btn btn-outline" data-w-sample>Try with sample data</button>
              <button class="btn btn-outline" data-w-import>${App.icon("upload")} Import data</button>
              <button class="btn btn-ghost" data-w-fresh>Start fresh</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* Getting started: four things that turn an empty install into a working
     one. It ticks itself off from real state rather than from a "done" flag,
     so it can never claim you've done something you haven't, and it disappears
     on its own once the last box is ticked.

     Deliberately not shown until setup has been finished or skipped: two
     onboarding surfaces at once is one too many. */
  function checklistHTML() {
    const s = App.state();
    if (!s.ui.setup_done || s.ui.checklist_done) return "";

    const steps = [
      { done: s.subjects.length > 0, label: "Add your subjects", hint: "Settings › Subjects", nav: "settings" },
      { done: !!s.settings.exam_date, label: "Set your exam date", hint: "for the countdown", nav: "settings" },
      { done: s.tasks.length > 0, label: "Add your first task", hint: "an IA, an essay, anything with a deadline", act: "new-task" },
      { done: s.sessions.length > 0, label: "Log a study session", hint: "Study Session › start the timer", nav: "study" },
    ];
    const left = steps.filter((x) => !x.done).length;
    if (!left) return ""; // finished: stop taking up space

    return `
      <div class="checklist">
        <div class="cl-head">
          <div>
            <b>Getting started</b>
            <span class="muted small"> · ${steps.length - left} of ${steps.length} done</span>
          </div>
          <button class="icon-btn" data-checklist-dismiss aria-label="Hide">${App.icon("x")}</button>
        </div>
        <div class="cl-items">
          ${steps.map((st, i) => `
            <button class="cl-item${st.done ? " done" : ""}" data-cl="${i}"
                    ${st.done ? "disabled" : ""}>
              <span class="cl-tick">${st.done ? App.icon("checkCircle") : App.icon("square")}</span>
              <span class="cl-label">${App.esc(st.label)}<em>${App.esc(st.hint)}</em></span>
            </button>`).join("")}
        </div>
      </div>`;
  }

  const CHECKLIST_ACTIONS = [
    { nav: "settings" }, { nav: "settings" }, { act: "new-task" }, { nav: "study" },
  ];

  App.pages.dashboard = {
    title: "Dashboard",
    render() {
      const s = App.state();
      // archived tasks (completed + past due) drop off the dashboard entirely —
      // counts, ring and lists — and live on only in Analytics. When everything is
      // done and past due there are simply no tasks left (0/0 → 0%), which is right:
      // the dashboard tracks current workload, not lifetime completion.
      const tasks = App.sortedTasks().filter((t) => !App.isArchived(t));
      const total = tasks.length;
      const completed = tasks.filter((t) => t.completed).length;
      const overdue = tasks.filter((t) => App.isOverdue(t)).length;
      const dueToday = tasks.filter((t) => App.isDueToday(t) && !t.completed).length;
      const progress = total ? Math.round((completed / total) * 100) : 0;
      const taskMap = App.taskMap();

      // unlocked tasks first in every list; locked/blocked sink to the bottom
      const todayTasks = App.displayOrder(tasks.filter((t) => App.isDueToday(t) && !t.completed), taskMap);
      const overdueTasks = App.displayOrder(
        tasks.filter((t) => App.isOverdue(t)).sort((a, b) => a.due_date.localeCompare(b.due_date)),
        taskMap);
      const todayStr = D.today();
      const upcoming = App.displayOrder(
        tasks
          .filter((t) => !t.completed && t.due_date && t.due_date > todayStr)
          .sort((a, b) => a.due_date.localeCompare(b.due_date)),
        taskMap).slice(0, 8);

      const isEmpty = total === 0 && !s.subjects.length && !s.sessions.length;
      // The setup wizard has taken over first run, so the welcome card is only
      // for anyone who skipped it and is still staring at an empty app.
      const showWelcome = isEmpty && s.ui.setup_done && !s.ui.welcomed;

      const r = 54, c = 2 * Math.PI * r;
      const offset = c - (progress / 100) * c;

      const streak = App.xp.streak();
      const maxStreak = App.xp.maxStreak();

      const examDate = s.settings.exam_date;
      const examDays = examDate && examDate >= todayStr ? D.diffDays(todayStr, examDate) : null;

      return `
        <div class="page">
          ${UI.pageHead("Dashboard", "Your IB workload at a glance", `
            ${streak > 0 ? `
              <span class="streak-pill" title="Days in a row with a logged study session">🔥 ${streak}-day streak</span>
              ${maxStreak > streak ? `<span class="streak-best" title="Your best-ever streak">Best: ${maxStreak}d</span>` : ""}
            ` : ""}
            <button class="btn btn-primary" data-add-task>${App.icon("plus")} Add Task</button>`)}
          ${examDays !== null ? `
            <div class="exam-countdown" data-go-settings title="Set in Settings → IB exams">
              <span class="ec-num">${examDays}</span>
              <div class="ec-text">
                <div class="ec-title">${examDays === 0 ? "IB exams start today" : `day${examDays === 1 ? "" : "s"} until IB exams`}</div>
                <div class="ec-sub">${esc(D.fmtLong(examDate))}, ${D.parse(examDate).getFullYear()}</div>
              </div>
              ${App.icon("gradcap")}
            </div>` : ""}
          ${App.backupNudgeDue() ? `
            <div class="backup-nudge">
              ${App.icon("alertTri")}
              <div class="bn-text">
                <b>Back up your data</b> — everything is stored only in this browser, and ${App.daysSinceBackup() === null ? "you haven't exported a backup yet" : `your last backup was ${esc(App.lastBackupLabel())}`}.
              </div>
              <button class="btn btn-primary btn-sm" data-backup-now>${App.icon("download")} Export</button>
              <button class="icon-btn" data-backup-dismiss aria-label="Dismiss">${App.icon("x")}</button>
            </div>` : ""}
          ${App.license.bannerHTML()}
          ${App.updates.bannerHTML()}
          ${showWelcome ? welcomeHTML() : ""}
          ${checklistHTML()}
          <div class="stat-grid">
            ${statTile("calendar", "Total tasks", total, "var(--accent-soft)", "var(--accent-soft-ink)")}
            ${statTile("checkCircle", "Completed", completed, "var(--good-soft)", "var(--good-ink)")}
            ${statTile("alertTri", "Overdue", overdue, "var(--danger-soft)", "var(--danger-ink)")}
            ${statTile("clock", "Due today", dueToday, "var(--warning-soft)", "var(--warning-ink)")}
          </div>

          <div style="display:grid;grid-template-columns:1fr 280px;gap:24px" class="dash-cols">
            <div class="stack" data-task-region>
              ${overdueTasks.length ? `
                <div>
                  <div class="section-label" style="color:var(--danger-ink)">Overdue <span class="count">· ${overdueTasks.length}</span></div>
                  <div class="task-list">${overdueTasks.map((t) => TK.taskCardHTML(t, { taskMap })).join("")}</div>
                </div>` : ""}
              ${todayTasks.length ? `
                <div>
                  <div class="section-label">Today</div>
                  <div class="task-list">${todayTasks.map((t) => TK.taskCardHTML(t, { taskMap })).join("")}</div>
                </div>` : ""}
              <div>
                <div class="section-label">Upcoming</div>
                ${upcoming.length
                  ? `<div class="task-list">${upcoming.map((t) => TK.taskCardHTML(t, { taskMap })).join("")}</div>`
                  : UI.emptyState("inbox", total === 0 ? "No tasks yet" : "No upcoming tasks",
                      total === 0 ? "Create your first task to get started" : "You're all caught up",
                      `<button class="btn btn-outline btn-sm" data-add-task>${App.icon("plus")} Add a task</button>`)}
              </div>
            </div>

            <div class="stack">
              ${App.xp.barHTML(false)}
              ${(() => {
                const goalH = s.settings.weekly_goal_hours || 0;
                if (!goalH) return "";
                const doneMin = App.weekMinutes();
                const goalMin = goalH * 60;
                const pct = App.clamp(Math.round((doneMin / goalMin) * 100), 0, 100);
                const hit = doneMin >= goalMin;
                return `
                  <div class="card card-pad weekly-goal">
                    <div class="row between" style="align-items:baseline;margin-bottom:8px">
                      <span class="section-label" style="margin-bottom:0">This week</span>
                      <span class="small" style="font-weight:700;color:${hit ? "var(--good-ink)" : "var(--ink-2)"}">${App.fmtMinutes(doneMin)} / ${goalH}h${hit ? " ✓" : ""}</span>
                    </div>
                    <div class="xp-bar"><span style="width:${pct}%;background:${hit ? "linear-gradient(90deg,var(--good),#1baf7a)" : ""}"></span></div>
                    <p class="muted small" style="margin-top:7px">${hit ? "Weekly goal reached — nice." : `${App.fmtMinutes(Math.max(0, goalMin - doneMin))} to go · resets Monday`}</p>
                  </div>`;
              })()}
              <div class="card card-pad">
                <div class="section-label" style="justify-content:center;margin-bottom:2px">Overall progress</div>
                <div class="prog-ring-wrap">
                  <svg viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="9"/>
                    <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--accent)" stroke-width="9"
                      stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"
                      style="transition:stroke-dashoffset .7s ease"/>
                  </svg>
                  <div class="prog-ring-center">
                    <span class="v">${progress}%</span>
                    <span class="l">complete</span>
                  </div>
                </div>
                <p class="muted small" style="text-align:center">${completed} of ${total || 0} tasks done</p>
              </div>
              <div class="card card-pad">
                <div class="section-label">Quick actions</div>
                <div class="stack-sm">
                  <button class="btn btn-outline btn-block" data-go="study">${App.icon("timer")} Start a study session</button>
                  <button class="btn btn-outline btn-block" data-go="scheduler">${App.icon("calendarClock")} Plan my week</button>
                  <button class="btn btn-outline btn-block" data-go="analytics">${App.icon("chart")} View analytics</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <style>@media (max-width: 1000px){ .dash-cols{grid-template-columns:1fr !important} }</style>`;
    },
    mount(el) {
      el.querySelectorAll("[data-add-task]").forEach((b) =>
        b.addEventListener("click", () => TK.openTaskModal(null)));
      el.querySelectorAll("[data-go]").forEach((b) =>
        b.addEventListener("click", () => App.navigate(b.dataset.go)));
      const region = el.querySelector("[data-task-region]");
      if (region) TK.bindTaskList(region);

      const goSettings = el.querySelector("[data-go-settings]");
      if (goSettings) goSettings.addEventListener("click", () => App.navigate("settings"));
      const backupNow = el.querySelector("[data-backup-now]");
      if (backupNow) backupNow.addEventListener("click", () => {
        App.exportBackup();
        App.toast("Backup downloaded");
        App.render();
      });
      const backupDismiss = el.querySelector("[data-backup-dismiss]");
      if (backupDismiss) backupDismiss.addEventListener("click", () => {
        App.snoozeBackupNudge();
        App.render();
      });
      App.license.mountBanner(el);
      App.updates.mountBanner(el);

      // getting-started checklist
      const clDismiss = el.querySelector("[data-checklist-dismiss]");
      if (clDismiss) clDismiss.addEventListener("click", () => {
        // system: it shows during the trial and after, and one that can't be
        // hidden in read-only mode would be permanent.
        App.update((s) => { s.ui.checklist_done = true; }, { system: true });
      });
      el.querySelectorAll("[data-cl]").forEach((b) =>
        b.addEventListener("click", () => {
          const action = CHECKLIST_ACTIONS[Number(b.dataset.cl)];
          if (!action) return;
          if (action.act === "new-task") App.taskui.openTaskModal();
          else if (action.nav) App.navigate(action.nav);
        }));

      /* First launch: go straight into setup rather than showing a card of
         four choices to someone who doesn't yet know what any of them mean.
         Guarded by a flag rather than by emptiness so it never reappears for
         somebody who deliberately cleared their data. */
      if (!App.state().ui.setup_done && App.setup) {
        setTimeout(() => {
          // Re-checked on firing, not just on scheduling: two mounts inside the
          // delay would otherwise both get past a check made 250ms ago.
          if (App.state().ui.setup_done) return;
          if (document.querySelector(".modal-scrim")) return;
          App.setup.start();
        }, 250);
      }

      // system on both welcomed writes: this is the first-run screen, shown to
      // people who by definition have no license yet. Refused, the flag never
      // sticks and the welcome screen returns on every launch — the same trap
      // that made "try it with sample data" do nothing.
      const wTour = el.querySelector("[data-w-tour]");
      if (wTour) wTour.addEventListener("click", () => {
        App.update((s) => { s.ui.welcomed = true; }, { silent: true, system: true });
        App.tour.start();
      });
      const wImport = el.querySelector("[data-w-import]");
      if (wImport) wImport.addEventListener("click", () => App.navigate("settings"));
      const wSample = el.querySelector("[data-w-sample]");
      if (wSample) wSample.addEventListener("click", () => {
        App.loadSampleData();
        App.toast("Sample data loaded — explore away!");
      });
      const wFresh = el.querySelector("[data-w-fresh]");
      if (wFresh) wFresh.addEventListener("click", () => {
        App.update((s) => { s.ui.welcomed = true; }, { system: true });
      });
    },
  };
})();
