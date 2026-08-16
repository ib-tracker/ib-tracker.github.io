/* pages/calendar.js — monthly due-date overview */
(function () {
  "use strict";
  const App = window.App;
  const UI = App.ui;
  const TK = App.taskui;
  const D = App.dates;

  let monthAnchor = D.today().slice(0, 7) + "-01";
  let selectedDate = null;
  let dayMode = "due"; // 'due' | 'schedule'

  function planListHTML(dateStr) {
    const plan = App.scheduledBlocksOn(dateStr);
    if (!plan.length) {
      return UI.emptyState("calendarClock", "Nothing scheduled this day",
        "Plan tasks in the Scheduler, or switch to Due to see deadlines",
        `<button class="btn btn-outline btn-sm" data-go-scheduler>${App.icon("calendarClock")} Open Scheduler</button>`);
    }
    return `<div class="cal-plan">${plan.map(({ task, block }) => {
      const meta = App.subjectMeta(task.subject_name);
      const color = task.subject_name ? meta.color : "var(--accent)";
      return `
        <div class="cal-plan-item ${task.completed ? "done" : ""}" data-plan-task="${App.esc(task.id)}" style="border-left:3px solid ${color}">
          <span class="cpi-time">${D.minToLabel(block.start_min)}</span>
          <span class="cpi-title">${task.subject_name && meta.emoji ? meta.emoji + " " : ""}${App.esc(task.title)}</span>
          <span class="cpi-dur">${App.fmtMinutes(block.duration)}</span>
        </div>`;
    }).join("")}</div>`;
  }

  App.pages.calendar = {
    title: "Calendar",
    render() {
      const taskMap = App.taskMap();
      const tasks = App.sortedTasks().filter((t) => !App.isArchived(t));
      const byDate = {};
      tasks.forEach((t) => {
        if (!t.due_date) return;
        (byDate[t.due_date] = byDate[t.due_date] || []).push(t);
      });

      const minutesByDate = {};
      for (const sess of App.state().sessions) {
        const ds = App.dates.isoToDateStr(sess.start_time);
        if (ds) minutesByDate[ds] = (minutesByDate[ds] || 0) + App.sessionMinutes(sess);
      }

      const anchor = D.parse(monthAnchor);
      const year = anchor.getFullYear(), month = anchor.getMonth();
      const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday start
      const gridStart = new Date(year, month, 1 - firstDow);
      const cells = [];
      for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        cells.push(d);
      }
      const todayStr = D.today();
      const maxMinutesInView = Math.max(1, ...cells.map((d) => minutesByDate[D.toStr(d)] || 0));

      const dayCell = (d) => {
        const ds = D.toStr(d);
        const inMonth = d.getMonth() === month;
        const dayTasks = byDate[ds] || [];
        const hasDone = dayTasks.some((t) => t.completed);
        const mins = minutesByDate[ds] || 0;
        const heat = mins > 0 ? App.clamp(mins / maxMinutesInView, 0.15, 1) : 0;
        // one subject-colored dot per subject with open tasks that day (max 3)
        const pendingColors = [];
        for (const t of dayTasks) {
          if (t.completed) continue;
          const color = t.subject_name ? App.subjectMeta(t.subject_name).color : "var(--accent)";
          if (!pendingColors.includes(color)) pendingColors.push(color);
          if (pendingColors.length === 3) break;
        }
        return `
          <button class="cal-day ${inMonth ? "" : "other"} ${ds === todayStr ? "today" : ""} ${ds === selectedDate ? "selected" : ""}" data-date="${ds}"
            ${mins ? `title="${App.fmtMinutes(mins)} studied"` : ""}>
            ${heat > 0 ? `<span class="d-heat" style="background:color-mix(in srgb, var(--good-ink) ${Math.round(heat * 65)}%, transparent)"></span>` : ""}
            <span class="d-num">${d.getDate()}</span>
            ${dayTasks.length ? `
              <span class="d-dots">
                ${pendingColors.map((c) => `<span class="dot" style="background:${c}"></span>`).join("")}
                ${hasDone ? `<span class="dot complete"></span>` : ""}
              </span>` : ""}
          </button>`;
      };

      const selTasks = selectedDate ? App.displayOrder(byDate[selectedDate] || [], taskMap) : [];

      return `
        <div class="page">
          ${UI.pageHead("Calendar", "Monthly overview of due dates",
            `<button class="btn btn-primary" data-add-task>${App.icon("plus")} Add Task</button>`)}
          <div class="card card-pad mb-4">
            <div class="row between mb-3">
              <button class="icon-btn" data-prev aria-label="Previous month">${App.icon("chevL")}</button>
              <h2 style="font-size:15px">${D.fmtMonthYear(monthAnchor)}</h2>
              <button class="icon-btn" data-next aria-label="Next month">${App.icon("chevR")}</button>
            </div>
            <div class="cal-grid">
              ${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => `<div class="cal-dow">${d}</div>`).join("")}
              ${cells.map(dayCell).join("")}
            </div>
            <div class="row mt-3" style="justify-content:center;gap:16px;flex-wrap:wrap">
              <span class="row muted small" style="gap:5px"><span class="dot pending"></span> due (colored by subject)</span>
              <span class="row muted small" style="gap:5px"><span class="dot complete"></span> completed</span>
              <span class="row muted small" style="gap:5px"><span class="dot" style="background:color-mix(in srgb, var(--good-ink) 55%, transparent)"></span> study time logged (darker = more)</span>
            </div>
          </div>
          ${selectedDate ? `
            <div data-task-region>
              <div class="row between mb-2" style="align-items:center">
                <div class="section-label" style="margin-bottom:0">${D.fmtLong(selectedDate)}</div>
                <div class="seg-toggle" role="tablist" aria-label="Day view">
                  <button data-day-mode="due" class="${dayMode === "due" ? "active" : ""}" role="tab" aria-selected="${dayMode === "due"}">Due</button>
                  <button data-day-mode="schedule" class="${dayMode === "schedule" ? "active" : ""}" role="tab" aria-selected="${dayMode === "schedule"}">Schedule</button>
                </div>
              </div>
              ${dayMode === "schedule"
                ? planListHTML(selectedDate)
                : (selTasks.length
                    ? `<div class="task-list">${selTasks.map((t) => TK.taskCardHTML(t, { taskMap })).join("")}</div>`
                    : UI.emptyState("calendar", "Nothing due this day", "",
                        `<button class="btn btn-outline btn-sm" data-add-on-date>${App.icon("plus")} Add a task for this day</button>`))}
            </div>` : `<p class="muted small" style="text-align:center">Select a day to see its tasks</p>`}
        </div>`;
    },
    mount(el) {
      el.querySelector("[data-add-task]").addEventListener("click", () => TK.openTaskModal(null));
      el.querySelector("[data-prev]").addEventListener("click", () => {
        monthAnchor = D.addMonths(monthAnchor, -1); App.render();
      });
      el.querySelector("[data-next]").addEventListener("click", () => {
        monthAnchor = D.addMonths(monthAnchor, 1); App.render();
      });
      el.querySelectorAll("[data-date]").forEach((b) =>
        b.addEventListener("click", () => { selectedDate = b.dataset.date; App.render(); }));
      const region = el.querySelector("[data-task-region]");
      if (region) TK.bindTaskList(region);
      const addOn = el.querySelector("[data-add-on-date]");
      if (addOn) addOn.addEventListener("click", () => TK.openTaskModal(null, { due_date: selectedDate }));

      el.querySelectorAll("[data-day-mode]").forEach((b) =>
        b.addEventListener("click", () => { dayMode = b.dataset.dayMode; App.render(); }));
      el.querySelectorAll("[data-plan-task]").forEach((row) =>
        row.addEventListener("click", () => {
          const t = App.taskById(row.dataset.planTask);
          if (t) TK.openTaskModal(t);
        }));
      const goSched = el.querySelector("[data-go-scheduler]");
      if (goSched) goSched.addEventListener("click", () => App.navigate("scheduler"));
    },
  };
})();
