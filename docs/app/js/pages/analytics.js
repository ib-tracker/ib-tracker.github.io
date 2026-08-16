/* pages/analytics.js — insights dashboard.
   Completion metrics use the real completion timestamp, accuracy is clamped,
   every chart has a hover tooltip and a table view, and a date range scopes
   all history charts together. */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = App.ui;
  const C = App.charts;
  const D = App.dates;

  let range = 30; // 30 | 90 | 0 (all time)

  function sessionsInRange() {
    const s = App.state().sessions.filter((x) => x.start_time && x.end_time);
    if (!range) return s;
    const cutoff = D.addDays(D.today(), -range);
    return s.filter((x) => (D.isoToDateStr(x.start_time) || "") >= cutoff);
  }

  function completedInRange() {
    const tasks = App.state().tasks.filter((t) => t.completed && t.completed_at);
    if (!range) return tasks;
    const cutoff = D.addDays(D.today(), -range);
    return tasks.filter((t) => (D.isoToDateStr(t.completed_at) || "") >= cutoff);
  }

  /* ---------- metrics ---------- */
  function streak() {
    const days = new Set(App.state().sessions.map((s) => D.isoToDateStr(s.start_time)).filter(Boolean));
    let count = 0;
    const today = D.today();
    for (let i = 0; i < 730; i++) {
      const ds = D.addDays(today, -i);
      if (days.has(ds)) count++;
      else if (i > 0) break;
    }
    return count;
  }

  function estPairs(sessions) {
    return sessions
      .filter((s) => (s.estimated_minutes || 0) > 0)
      .map((s) => ({ x: s.estimated_minutes, y: App.sessionMinutes(s), label: s.task_title || "Session" }))
      .filter((p) => p.y > 0);
  }

  function accuracy(pairs) {
    if (!pairs.length) return null;
    const errs = pairs.map((p) => Math.abs(p.x - p.y) / Math.max(p.x, 1));
    return App.clamp(Math.round((1 - errs.reduce((a, b) => a + b, 0) / errs.length) * 100), 0, 100);
  }

  function forecastData() {
    const s = App.state();
    const today = D.today();
    const out = [];
    for (let i = 0; i < 30; i++) {
      const ds = D.addDays(today, i);
      const mins = s.tasks
        .filter((t) => !t.completed && t.due_date === ds)
        .reduce((sum, t) => sum + (t.estimated_minutes || 0), 0);
      const dayName = App.DAY_KEYS[(D.dayOfWeek(ds) + 6) % 7];
      out.push({
        label: D.fmtShort(ds),
        tipTitle: D.fmtLong(ds),
        value: mins,
        capacity: (s.settings.hours_per_day[dayName] || 0) * 60,
      });
    }
    return out;
  }

  let dailyDays = 30; // 7 | 30 — this chart's own toggle

  function dailyStudyData(days) {
    const byDay = {};
    for (const s of App.state().sessions) {
      if (!s.start_time || !s.end_time) continue;
      const ds = D.isoToDateStr(s.start_time);
      if (ds) byDay[ds] = (byDay[ds] || 0) + App.sessionMinutes(s);
    }
    const out = [];
    const today = D.today();
    for (let i = days - 1; i >= 0; i--) {
      const ds = D.addDays(today, -i);
      out.push({ label: D.fmtShort(ds), tipTitle: D.fmtLong(ds), value: byDay[ds] || 0 });
    }
    return out;
  }

  /* ---------- session manager ---------- */
  function openSessionsModal() {
    const UNUSUAL_MIN = 8 * 60; // flag sessions over 8h — likely a forgotten timer

    const listHTML = () => {
      const sessions = [...App.state().sessions]
        .filter((s) => s.start_time && s.end_time)
        .sort((a, b) => b.start_time.localeCompare(a.start_time));
      if (!sessions.length) return `<p class="muted small" style="text-align:center;padding:20px 0">No sessions logged yet</p>`;
      return sessions.map((s) => {
        const mins = App.sessionMinutes(s);
        const d = new Date(s.start_time);
        const when = `${D.fmtMed(D.isoToDateStr(s.start_time))} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
        return `
          <div class="queue-row" data-session-id="${esc(s.id)}" style="gap:12px">
            <div style="flex:1;min-width:0">
              <div class="q-title" style="font-weight:550;cursor:default">${esc(s.task_title || "Study Session")}</div>
              <div class="muted small">${esc(when)}${s.subject_name ? ` · ${esc(s.subject_name)}` : ""}</div>
            </div>
            <span class="chip ${mins >= UNUSUAL_MIN ? "chip-danger" : "chip-plain"}" title="${mins >= UNUSUAL_MIN ? "Unusually long — forgotten timer?" : ""}">
              ${mins >= UNUSUAL_MIN ? App.icon("alertCircle") + " " : ""}${App.fmtMinutes(mins)}
            </span>
            <button class="icon-btn danger" data-del-session title="Delete session">${App.icon("trash")}</button>
          </div>`;
      }).join("");
    };

    UI.openModal({
      title: "All study sessions",
      size: "lg",
      body: `
        <p class="muted small mb-3">Deleting a session removes it from every statistic and chart. Sessions over 8h are flagged — usually a timer left running.</p>
        <div data-session-list style="max-height:52vh;overflow-y:auto">${listHTML()}</div>`,
      foot: `<button class="btn btn-outline" data-close>Close</button>`,
      onMount(el) {
        const list = el.querySelector("[data-session-list]");
        const bind = () => {
          list.querySelectorAll("[data-del-session]").forEach((btn) =>
            btn.addEventListener("click", async () => {
              const row = btn.closest("[data-session-id]");
              const sess = App.state().sessions.find((x) => x.id === row.dataset.sessionId);
              if (!sess) return;
              const ok = await UI.confirm({
                title: "Delete this session?",
                message: `“${sess.task_title || "Study Session"}” (${App.fmtMinutes(App.sessionMinutes(sess))}) will be removed from your stats. This can't be undone.`,
              });
              if (!ok) return;
              App.deleteSession(sess.id);
              App.toast("Session deleted");
              list.innerHTML = listHTML();
              bind();
            }));
        };
        bind();
      },
    });
  }

  function subjectTimeData(sessions) {
    const taskMap = App.taskMap();
    const map = {};
    for (const s of sessions) {
      const t = s.task_id ? taskMap.get(s.task_id) : null;
      const key = s.subject_name || (t && t.subject_name) || "Other";
      map[key] = (map[key] || 0) + App.sessionMinutes(s);
    }
    return Object.entries(map).map(([name, value]) => {
      if (name === "Other") return { label: name, value };
      const meta = App.subjectMeta(name);
      return { label: `${meta.emoji} ${name}`.trim(), value, color: meta.color };
    });
  }

  function dailyCompletions(completed) {
    const days = range || Math.max(30, App.state().tasks.length ? D.diffDays(
      completed.reduce((min, t) => {
        const ds = D.isoToDateStr(t.completed_at);
        return ds && ds < min ? ds : min;
      }, D.today()), D.today()) + 1 : 30);
    const n = Math.min(days, 120);
    const counts = {};
    completed.forEach((t) => {
      const ds = D.isoToDateStr(t.completed_at);
      if (ds) counts[ds] = (counts[ds] || 0) + 1;
    });
    const out = [];
    const today = D.today();
    for (let i = n - 1; i >= 0; i--) {
      const ds = D.addDays(today, -i);
      out.push({ label: D.fmtShort(ds), tipTitle: D.fmtLong(ds), value: counts[ds] || 0 });
    }
    return out;
  }

  function statTile(icon, label, value, sub, bg, ink) {
    return `
      <div class="card stat-tile">
        <div class="stat-icon" style="background:${bg};color:${ink}">${App.icon(icon)}</div>
        <div>
          <div class="stat-value">${value}</div>
          <div class="stat-label">${esc(label)}${sub ? ` <span style="opacity:.7">· ${esc(sub)}</span>` : ""}</div>
        </div>
      </div>`;
  }

  App.pages.analytics = {
    title: "Analytics",
    render() {
      const sessions = sessionsInRange();
      const completed = completedInRange();
      const pairs = estPairs(sessions);
      const acc = accuracy(pairs);
      const focusMin = sessions.reduce((s, x) => s + App.sessionMinutes(x), 0);
      const rangeLabel = range ? `last ${range} days` : "all time";

      return `
        <div class="page">
          ${UI.pageHead("Analytics", "Insights into your workload and study habits", `
            <button class="btn btn-outline" data-all-sessions>${App.icon("clock")} See all sessions</button>
            <button class="btn btn-primary" data-report>${App.icon("fileText")} Progress Report</button>`)}

          ${App.xp.barHTML(true)}

          <div class="filter-bar">
            <span style="color:var(--ink-3);display:flex">${App.icon("filter")}</span>
            ${[[30, "Last 30 days"], [90, "Last 90 days"], [0, "All time"]].map(([v, l]) => `
              <button class="btn ${range === v ? "btn-primary" : "btn-outline"} btn-sm" data-range="${v}">${l}</button>`).join("")}
            <span class="spacer"></span>
            <span class="muted small">${App.state().sessions.length ? "" : `Nothing to chart yet — every study session you log fills these in.
              <a class="btn btn-outline btn-sm" href="#/study" style="margin-left:8px">${App.icon("timer")} Start a session</a>`}</span>
          </div>

          <div class="stat-grid">
            ${statTile("flame", "Day streak", streak(), `best ${App.xp.maxStreak()}d`, "var(--warning-soft)", "var(--warning-ink)")}
            ${statTile("clock", "Focus time", App.fmtMinutes(focusMin), rangeLabel, "var(--accent-soft)", "var(--accent-soft-ink)")}
            ${statTile("target", "Estimate accuracy", acc === null ? "—" : acc + "%", rangeLabel, "var(--good-soft)", "var(--good-ink)")}
            ${statTile("trendUp", "Tasks completed", completed.length, rangeLabel, "var(--cat-ia)", "var(--cat-ia-ink)")}
          </div>

          <div class="stack">
            ${C.card("forecast", "Workload forecast — next 30 days", "Estimated task time due each day vs. your available study hours")}
            ${C.card("daily-time", "Study time per day", "Total time you logged each day", `
              <div class="seg-toggle" style="padding:2px">
                <button class="${dailyDays === 7 ? "active" : ""}" data-daily-days="7" style="padding:3px 10px;font-size:11.5px">7 days</button>
                <button class="${dailyDays === 30 ? "active" : ""}" data-daily-days="30" style="padding:3px 10px;font-size:11.5px">30 days</button>
              </div>`)}
            ${C.card("subject-time", "Time by subject", "Where your logged study time goes · " + rangeLabel)}
            ${C.card("completions", "Tasks completed per day", rangeLabel)}
            ${C.card("est-actual", "Estimated vs. actual session length", "Each dot is a logged session — above the line took longer than planned · " + rangeLabel)}
          </div>
        </div>`;
    },

    mount(el) {
      el.querySelectorAll("[data-range]").forEach((b) =>
        b.addEventListener("click", () => { range = Number(b.dataset.range); App.render(); }));

      const sessions = sessionsInRange();
      const completed = completedInRange();

      const fc = forecastData();
      C.mountCard(el, "forecast",
        (body) => C.columnWithCapacity(body, fc, {
          valueLabel: "Planned work",
          fmtVal: App.fmtMinutes,
          fmtTick: (v) => App.fmtMinutes(v),
          emptyMsg: "No upcoming tasks with due dates and time estimates yet",
        }),
        { columns: ["Day", "Planned", "Capacity"], rows: fc.filter((d) => d.value || d.capacity).map((d) => [d.tipTitle, App.fmtMinutes(d.value), App.fmtMinutes(d.capacity)]) });

      el.querySelector("[data-all-sessions]").addEventListener("click", openSessionsModal);
      el.querySelector("[data-report]").addEventListener("click", () => App.report.openModal());
      el.querySelectorAll("[data-daily-days]").forEach((b) =>
        b.addEventListener("click", () => { dailyDays = Number(b.dataset.dailyDays); App.render(); }));

      const dt = dailyStudyData(dailyDays);
      C.mountCard(el, "daily-time",
        (body) => C.columnWithCapacity(body, dt, {
          valueLabel: "Studied",
          fmtVal: App.fmtMinutes,
          fmtTick: (v) => App.fmtMinutes(v),
          labelEvery: dailyDays === 7 ? 1 : 5,
          emptyMsg: "Log study sessions with the timer to see this",
        }),
        { columns: ["Day", "Studied"], rows: dt.filter((d) => d.value).map((d) => [d.tipTitle, App.fmtMinutes(d.value)]) });

      const st = subjectTimeData(sessions);
      C.mountCard(el, "subject-time",
        (body) => C.donut(body, st, { fmtVal: App.fmtMinutes, centerLabel: "logged", emptyMsg: "No timer sessions logged yet" }),
        { columns: ["Subject", "Time"], rows: [...st].sort((a, b) => b.value - a.value).map((d) => [d.label, App.fmtMinutes(d.value)]) });

      const dc = dailyCompletions(completed);
      C.mountCard(el, "completions",
        (body) => C.line(body, dc, { integer: true, valueLabel: "Completed", labelEvery: Math.max(1, Math.round(dc.length / 6)), emptyMsg: "No completions yet" }),
        { columns: ["Day", "Completed"], rows: dc.filter((d) => d.value).map((d) => [d.tipTitle, d.value]) });

      const pairs = estPairs(sessions);
      C.mountCard(el, "est-actual",
        (body) => C.scatter(body, pairs, { emptyMsg: "Sessions with time estimates will appear here" }),
        { columns: ["Session", "Estimated", "Actual"], rows: pairs.map((p) => [p.label, App.fmtMinutes(p.x), App.fmtMinutes(p.y)]) });
    },
  };
})();
