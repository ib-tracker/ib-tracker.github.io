/* report.js — printable progress reports.
   Builds a professionally typeset, self-contained HTML document for a chosen
   date range and opens the browser's print dialog ("Save as PDF"). Everything
   is computed locally; the Coach's Corner text comes from the built-in coach
   and adapts to the timeframe. */
(function () {
  "use strict";
  const App = window.App;
  const D = App.dates;
  const esc = App.esc;
  const R = (App.report = {});

  /* ============================================================
     Data assembly for a range (local dates, inclusive)
     ============================================================ */
  function earliestDataDate() {
    const s = App.state();
    let min = D.today();
    for (const t of s.tasks) {
      const ds = t.created_at ? D.isoToDateStr(t.created_at) : null;
      if (ds && ds < min) min = ds;
    }
    for (const x of s.sessions) {
      const ds = D.isoToDateStr(x.start_time);
      if (ds && ds < min) min = ds;
    }
    return min;
  }

  R.collect = function (from, to) {
    const s = App.state();
    const today = D.today();
    const rangeDays = D.diffDays(from, to) + 1;
    const inRange = (ds) => ds && ds >= from && ds <= to;

    // --- study sessions ---
    const sessions = s.sessions.filter((x) => inRange(D.isoToDateStr(x.start_time)));
    const focusMin = sessions.reduce((sum, x) => sum + App.sessionMinutes(x), 0);
    const byDay = {};
    const bySubject = {};
    for (const x of sessions) {
      const ds = D.isoToDateStr(x.start_time);
      const mins = App.sessionMinutes(x);
      byDay[ds] = (byDay[ds] || 0) + mins;
      const subj = x.subject_name || "Other";
      bySubject[subj] = (bySubject[subj] || 0) + mins;
    }
    const busiest = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0] || null;
    const daysStudied = Object.keys(byDay).length;
    const subjectRows = Object.entries(bySubject)
      .sort((a, b) => b[1] - a[1])
      .map(([name, mins]) => ({
        name, mins,
        pct: focusMin ? Math.round((mins / focusMin) * 100) : 0,
        meta: name === "Other" ? { emoji: "•", color: "#9ca3af" } : App.subjectMeta(name),
      }));

    // estimate accuracy within range
    const pairs = sessions
      .filter((x) => (x.estimated_minutes || 0) > 0 && App.sessionMinutes(x) > 0)
      .map((x) => Math.abs(x.estimated_minutes - App.sessionMinutes(x)) / Math.max(x.estimated_minutes, 1));
    const accuracy = pairs.length
      ? App.clamp(Math.round((1 - pairs.reduce((a, b) => a + b, 0) / pairs.length) * 100), 0, 100)
      : null;

    // --- tasks ---
    const completed = s.tasks.filter((t) => t.completed && inRange(t.completed_at ? D.isoToDateStr(t.completed_at) : null));
    const overdueNow = s.tasks.filter((t) => !t.completed && t.due_date && t.due_date < today);
    const openCount = s.tasks.filter((t) => !t.completed).length;
    const dueSoon = s.tasks.filter((t) => !t.completed && t.due_date && t.due_date >= today && t.due_date <= D.addDays(today, 7)).length;

    // streak, clipped to the range (counts back from range end, never past its start)
    const anchor = to > today ? today : to;
    let streak = 0;
    for (let i = 0; i < 3650; i++) {
      const ds = D.addDays(anchor, -i);
      if (ds < from) break;
      if (byDay[ds]) streak++;
      else if (i > 0) break;
    }

    // --- gamification ---
    const xpRange = App.xp.computeRange(from, to);
    const xpNow = App.xp.compute();

    // --- academics ---
    const grades = s.grades.map((g) => ({
      name: g.subject_name, current: g.current_grade, target: g.target_grade,
      gap: (g.target_grade || 0) - (g.current_grade || 0),
      meta: App.subjectMeta(g.subject_name),
    })).sort((a, b) => a.name.localeCompare(b.name));
    const subjectPoints = grades.reduce((sum, g) => sum + (g.current || 0), 0);
    const corePoints = App.getCorePoints(s.settings.tok_grade, s.settings.ee_grade);
    const failing = App.isFailingCondition(s.settings.tok_grade, s.settings.ee_grade);
    const predicted = subjectPoints + (corePoints || 0);
    const maxPoints = grades.length * 7 + 3;
    const avgGrade = grades.length ? (subjectPoints / grades.length).toFixed(1) : null;

    // --- deadlines: three most urgent upcoming (tasks + university dates) ---
    const deadlines = [];
    for (const t of s.tasks) {
      if (!t.completed && t.due_date && t.due_date >= today) {
        deadlines.push({ date: t.due_date, label: t.title, kind: t.subject_name ? App.subjectMeta(t.subject_name).emoji + " " + t.subject_name : (App.CATEGORIES[t.category] || {}).label || "Task" });
      }
    }
    for (const c of s.courses) {
      const add = (date, type) => { if (date && date >= today) deadlines.push({ date, label: `${c.university_name} — ${type}`, kind: "University" }); };
      add(c.application_deadline, "application deadline");
      add(c.entrance_exam_date, "entrance exam");
      add(c.interview_date, "interview");
    }
    deadlines.sort((a, b) => a.date.localeCompare(b.date));

    // --- core programme ---
    const coreOpen = {};
    for (const [key, label] of [["tok", "TOK"], ["extended_essay", "Extended Essay"], ["cas", "CAS"]]) {
      coreOpen[label] = s.tasks.filter((t) => !t.completed && t.category === key).length;
    }

    return {
      from, to, today, rangeDays,
      sessions: sessions.length, focusMin, daysStudied, busiest,
      avgSession: sessions.length ? Math.round(focusMin / sessions.length) : 0,
      subjectRows, accuracy,
      completed: completed.length, overdueNow: overdueNow.length, openCount, dueSoon,
      streak, xpRange, xpNow,
      grades, subjectPoints, corePoints, failing, predicted, maxPoints, avgGrade,
      tokGrade: s.settings.tok_grade, eeGrade: s.settings.ee_grade,
      deadlines: deadlines.slice(0, 3), coreOpen,
    };
  };

  /* ============================================================
     Coach's Corner — timeframe-adaptive, tone-aware
     ============================================================ */
  R.coachCorner = function (d) {
    const warm = App.coach.tone() === "warm";
    const p = [];
    const hrs = App.fmtMinutes(d.focusMin);

    if (d.rangeDays <= 10) {
      // tactical, week-scale
      p.push(warm
        ? `A quick look at your week: ${hrs} of focused study across ${d.daysStudied} day${d.daysStudied === 1 ? "" : "s"}, with ${d.completed} task${d.completed === 1 ? "" : "s"} finished. ${d.streak > 2 ? `That ${d.streak}-day streak is doing a lot of quiet work for you — protect it.` : d.daysStudied > 0 ? `The rhythm is there; now let's make it daily.` : `This week didn't leave much room for study — next week can look different.`}`
        : `The week in numbers: ${hrs} studied over ${d.daysStudied} day${d.daysStudied === 1 ? "" : "s"}, ${d.completed} task${d.completed === 1 ? "" : "s"} done.`);
      if (d.overdueNow > 0) {
        p.push(warm
          ? `There ${d.overdueNow === 1 ? "is one overdue task" : `are ${d.overdueNow} overdue tasks`} on the list. Pick the smallest, clear it first thing tomorrow, and the rest of the week gets lighter.`
          : `${d.overdueNow} overdue. Clear the smallest one tomorrow morning before anything else.`);
      } else if (d.dueSoon > 0) {
        p.push(warm
          ? `Nothing is overdue — great position. With ${d.dueSoon} task${d.dueSoon === 1 ? "" : "s"} due in the next 7 days, one Auto-Schedule pass now keeps it that way.`
          : `Zero overdue. Keep it that way: auto-schedule the ${d.dueSoon} due this week today.`);
      } else {
        p.push(warm ? `Nothing overdue and nothing pressing — use the slack to get ahead on an IA or the EE.` : `Clean slate. Bank hours on the IA or EE while it's quiet.`);
      }
    } else if (d.rangeDays <= 45) {
      // habits, month-scale
      const perDay = d.daysStudied ? Math.round(d.focusMin / d.daysStudied) : 0;
      p.push(warm
        ? `Over these ${d.rangeDays} days you put in ${hrs} — ${d.daysStudied} study day${d.daysStudied === 1 ? "" : "s"} averaging ${App.fmtMinutes(perDay)} each. Consistency beats intensity at this scale, and ${d.daysStudied >= d.rangeDays / 2 ? "you're showing real consistency." : "there's room to make studying a more regular habit — even 25 minutes counts as a day."}`
        : `${d.rangeDays} days, ${hrs} logged, ${d.daysStudied} active days at ~${App.fmtMinutes(perDay)} each. ${d.daysStudied >= d.rangeDays / 2 ? "Consistency is acceptable." : "Too many zero days. Shrink the bar to 25 minutes and clear it daily."}`);
      const neglected = d.grades.filter((g) => g.gap > 0 && !d.subjectRows.some((r) => r.name === g.name && r.mins >= 60)).slice(0, 2);
      if (neglected.length) {
        p.push(warm
          ? `One pattern worth noticing: ${neglected.map((g) => g.name).join(" and ")} ${neglected.length === 1 ? "has" : "have"} a grade gap but barely any study time this period. Two focused sessions a week there would move your predicted score more than anything else.`
          : `${neglected.map((g) => g.name).join(" and ")}: grade gap, no hours. Fix the allocation — two sessions a week each.`);
      } else if (d.accuracy !== null) {
        p.push(warm
          ? `Your time estimates are ${d.accuracy >= 75 ? `impressively honest (${d.accuracy}% accurate) — planning you can trust.` : `running at ${d.accuracy}% accuracy — try estimating slightly bigger blocks and splitting large tasks.`}`
          : `Estimate accuracy ${d.accuracy}%. ${d.accuracy >= 75 ? "Fine." : "Pad estimates or split tasks."}`);
      }
    } else {
      // long-term growth
      const mid = D.addDays(d.from, Math.floor(d.rangeDays / 2));
      const s = App.state();
      const half = (a, b) => s.sessions
        .filter((x) => { const ds = D.isoToDateStr(x.start_time); return ds && ds >= a && ds <= b; })
        .reduce((sum, x) => sum + App.sessionMinutes(x), 0);
      const h1 = half(d.from, D.addDays(mid, -1));
      const h2 = half(mid, d.to);
      const trend = h1 > 0 ? Math.round(((h2 - h1) / h1) * 100) : null;
      p.push(warm
        ? `Looking across the full ${d.rangeDays} days: ${hrs} of study, ${d.completed} tasks completed, and you're now Level ${d.xpNow.level} (${d.xpNow.rank}). ${trend !== null && trend >= 10 ? `The trend line matters most — your second half was ${trend}% heavier than the first. That's genuine momentum.` : trend !== null && trend <= -10 ? `Study time dipped ${Math.abs(trend)}% in the second half — worth asking what changed and planning around it.` : `Your workload stayed steady across the period — a stable base to build on.`}`
        : `${d.rangeDays} days: ${hrs} studied, ${d.completed} tasks closed, Level ${d.xpNow.level}. ${trend !== null && trend >= 10 ? `Second half up ${trend}%. Keep climbing.` : trend !== null && trend <= -10 ? `Second half down ${Math.abs(trend)}%. Reverse it.` : `Flat trend. Push it upward.`}`);
      const gaps = d.grades.filter((g) => g.gap > 0);
      if (gaps.length) {
        p.push(warm
          ? `On the academic side, ${gaps.length} subject${gaps.length === 1 ? " still sits" : "s still sit"} below target${d.predicted ? ` with a predicted ${d.predicted}/${d.maxPoints}` : ""}. At this timescale the play is structural: a standing weekly session for each gap subject, booked in the Scheduler, non-negotiable.`
          : `${gaps.length} subject${gaps.length === 1 ? "" : "s"} under target. Standing weekly sessions for each. Book them now.`);
      } else if (d.grades.length) {
        p.push(warm ? `Every graded subject is at or above target — genuinely excellent. The goal now is defending that while the workload grows.` : `All subjects at target. Defend it.`);
      }
    }
    return p;
  };

  /* ============================================================
     The printable document
     ============================================================ */
  function reportCSS() {
    return `
      @page { size: A4; margin: 15mm 14mm; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        font-size: 11.5px; line-height: 1.5; color: #1a1a19;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      .head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 2.5px solid #4f46e5; }
      .brand { display: flex; gap: 10px; align-items: center; }
      .brand-mark { width: 34px; height: 34px; border-radius: 9px; background: #4f46e5; color: #fff; font-weight: 800; font-size: 13px; display: flex; align-items: center; justify-content: center; }
      .brand h1 { font-size: 19px; letter-spacing: -0.02em; }
      .brand p { font-size: 11px; color: #6b7280; }
      .range-box { text-align: right; }
      .range-box .range { font-size: 13px; font-weight: 700; }
      .range-box .gen { font-size: 10px; color: #6b7280; margin-top: 2px; }
      h2 { font-size: 13px; margin: 22px 0 10px; padding-bottom: 5px; border-bottom: 1px solid #e5e4dd; letter-spacing: -0.01em; }
      .hl-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; margin-top: 14px; }
      .hl { border: 1px solid #e5e4dd; border-radius: 10px; padding: 10px 12px; }
      .hl .v { font-size: 17px; font-weight: 750; letter-spacing: -0.02em; }
      .hl .l { font-size: 10px; color: #6b7280; margin-top: 1px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; padding: 5px 8px; border-bottom: 1px solid #e5e4dd; }
      td { padding: 6px 8px; border-bottom: 1px solid #f0efe9; vertical-align: middle; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      .bar-track { background: #f0efe9; border-radius: 99px; height: 7px; width: 100%; overflow: hidden; }
      .bar-fill { height: 100%; border-radius: 99px; }
      .swatch { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 6px; vertical-align: baseline; }
      .grade-pill { display: inline-block; min-width: 22px; text-align: center; padding: 1px 6px; border-radius: 6px; font-weight: 700; background: #eceafc; color: #4338ca; }
      .grade-pill.t { background: #e3f4e3; color: #096f09; }
      .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
      .dl { display: flex; justify-content: space-between; gap: 10px; padding: 7px 10px; border: 1px solid #e5e4dd; border-radius: 9px; margin-bottom: 6px; }
      .dl .t { font-weight: 600; font-size: 11px; }
      .dl .k { font-size: 10px; color: #6b7280; }
      .dl .d { font-size: 11px; font-weight: 700; white-space: nowrap; }
      .dl .in { font-size: 9.5px; color: #6b7280; text-align: right; }
      .coach { border: 1.5px solid #4f46e5; border-radius: 12px; padding: 13px 16px; background: #f6f5ff; margin-top: 10px; page-break-inside: avoid; }
      .coach p { margin-bottom: 8px; }
      .coach p:last-child { margin-bottom: 0; }
      .kv { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #f0efe9; font-size: 11px; }
      .kv b { font-variant-numeric: tabular-nums; }
      .xp-line { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
      .xp-line .lvl { width: 30px; height: 30px; border-radius: 50%; background: #4f46e5; color: #fff; font-weight: 800; font-size: 12px; display: flex; align-items: center; justify-content: center; }
      .foot { margin-top: 26px; padding-top: 8px; border-top: 1px solid #e5e4dd; font-size: 9.5px; color: #9ca3af; display: flex; justify-content: space-between; }
      .muted { color: #6b7280; }`;
  }

  R.buildHTML = function (d) {
    const corner = R.coachCorner(d);
    const fmtM = App.fmtMinutes;
    const hl = (v, l) => `<div class="hl"><div class="v">${v}</div><div class="l">${esc(l)}</div></div>`;

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Progress Report — ${esc(D.fmtMed(d.from))} to ${esc(D.fmtMed(d.to))}</title>
      <style>${reportCSS()}</style></head><body>

      <div class="head">
        <div class="brand">
          <div class="brand-mark">IB</div>
          <div>
            <h1>Progress Report</h1>
            <p>${esc(App.state().settings.appName || "IB Tracker")}</p>
          </div>
        </div>
        <div class="range-box">
          <div class="range">${esc(D.fmtMed(d.from))} — ${esc(D.fmtMed(d.to))}</div>
          <div class="gen">${d.rangeDays} day${d.rangeDays === 1 ? "" : "s"} · generated ${esc(D.fmtMed(d.today))}</div>
        </div>
      </div>

      <div class="hl-grid">
        ${hl(fmtM(d.focusMin), "Focused study time")}
        ${hl(`${d.completed} <span class="muted" style="font-size:11px;font-weight:500">vs ${d.overdueNow} overdue</span>`, "Tasks completed")}
        ${hl(`${d.streak} day${d.streak === 1 ? "" : "s"}`, "Study streak (within range)")}
        ${hl(d.predicted ? `${d.predicted}<span class="muted" style="font-size:11px;font-weight:500">/${d.maxPoints}</span>` : "—", "Predicted IB points")}
        ${hl(`+${d.xpRange.total.toLocaleString()} XP`, `XP earned · now Level ${d.xpNow.level} (${d.xpNow.rank})`)}
        ${hl(d.accuracy === null ? "—" : d.accuracy + "%", "Time-estimate accuracy")}
      </div>

      <h2>Study activity</h2>
      <div class="two-col">
        <div>
          ${d.subjectRows.length ? `
            <table>
              <thead><tr><th>Subject</th><th style="width:34%">Share</th><th class="num">Time</th></tr></thead>
              <tbody>
                ${d.subjectRows.slice(0, 8).map((r) => `
                  <tr>
                    <td>${esc(r.meta.emoji)} ${esc(r.name)}</td>
                    <td><div class="bar-track"><div class="bar-fill" style="width:${r.pct}%;background:${r.meta.color}"></div></div></td>
                    <td class="num">${fmtM(r.mins)} · ${r.pct}%</td>
                  </tr>`).join("")}
              </tbody>
            </table>` : `<p class="muted">No study sessions were logged in this period.</p>`}
        </div>
        <div>
          <div class="kv"><span>Sessions logged</span><b>${d.sessions}</b></div>
          <div class="kv"><span>Days studied</span><b>${d.daysStudied} of ${d.rangeDays}</b></div>
          <div class="kv"><span>Average session</span><b>${d.sessions ? fmtM(d.avgSession) : "—"}</b></div>
          <div class="kv"><span>Busiest day</span><b>${d.busiest ? `${esc(D.fmtMed(d.busiest[0]))} (${fmtM(d.busiest[1])})` : "—"}</b></div>
          <div class="kv"><span>Open tasks right now</span><b>${d.openCount}</b></div>
          <div class="kv"><span>Due in the next 7 days</span><b>${d.dueSoon}</b></div>
          <div class="kv"><span>Open core work (TOK / EE / CAS)</span><b>${d.coreOpen["TOK"]} / ${d.coreOpen["Extended Essay"]} / ${d.coreOpen["CAS"]}</b></div>
          <div class="xp-line">
            <div class="lvl">${d.xpNow.level}</div>
            <div style="flex:1">
              <div style="font-size:11px;font-weight:700">${esc(d.xpNow.rank)} · ${d.xpNow.total.toLocaleString()} XP total</div>
              <div class="bar-track" style="margin-top:3px"><div class="bar-fill" style="width:${d.xpNow.pct}%;background:#4f46e5"></div></div>
            </div>
          </div>
        </div>
      </div>

      <h2>Grade snapshot</h2>
      ${d.grades.length ? `
        <div class="two-col">
          <table>
            <thead><tr><th>Subject</th><th class="num">Current</th><th class="num">Target</th><th class="num">Gap</th></tr></thead>
            <tbody>
              ${d.grades.map((g) => `
                <tr>
                  <td><span class="swatch" style="background:${g.meta.color}"></span>${esc(g.meta.emoji)} ${esc(g.name)}</td>
                  <td class="num"><span class="grade-pill">${g.current}</span></td>
                  <td class="num"><span class="grade-pill t">${g.target}</span></td>
                  <td class="num" style="font-weight:700;color:${g.gap > 0 ? "#b45309" : "#096f09"}">${g.gap > 0 ? "+" + g.gap : g.gap}</td>
                </tr>`).join("")}
            </tbody>
          </table>
          <div>
            <div class="kv"><span>Predicted IB points</span><b>${d.predicted} / ${d.maxPoints}</b></div>
            <div class="kv"><span>Subject points</span><b>${d.subjectPoints} / ${d.grades.length * 7}</b></div>
            <div class="kv"><span>Core points (TOK ${esc(d.tokGrade || "—")} + EE ${esc(d.eeGrade || "—")})</span><b>${d.failing ? "Failing condition" : d.corePoints ?? "—"} / 3</b></div>
            <div class="kv"><span>Average subject grade</span><b>${d.avgGrade ?? "—"}</b></div>
          </div>
        </div>` : `<p class="muted">No grades recorded yet — add current and target grades on the Grades page to unlock this section.</p>`}

      <h2>Next deadlines</h2>
      ${d.deadlines.length ? d.deadlines.map((dl) => `
        <div class="dl">
          <div><div class="t">${esc(dl.label)}</div><div class="k">${esc(dl.kind)}</div></div>
          <div><div class="d">${esc(D.fmtMed(dl.date))}</div><div class="in">in ${D.diffDays(d.today, dl.date)} day${D.diffDays(d.today, dl.date) === 1 ? "" : "s"}</div></div>
        </div>`).join("") : `<p class="muted">No upcoming deadlines on record.</p>`}

      <h2>Coach's Corner</h2>
      <div class="coach">
        ${corner.map((p) => `<p>${esc(p)}</p>`).join("")}
      </div>

      <div class="foot">
        <span>Generated locally by ${esc(App.state().settings.appName || "IB Tracker")} — data never leaves this computer.</span>
        <span>${esc(D.fmtMed(d.today))}</span>
      </div>
    </body></html>`;
  };

  /* ============================================================
     Print via a hidden iframe (offline-safe, no popup blockers)
     ============================================================ */
  let printFrame = null;
  R.print = function (from, to) {
    const html = R.buildHTML(R.collect(from, to));
    if (printFrame) printFrame.remove();
    printFrame = document.createElement("iframe");
    printFrame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(printFrame);
    printFrame.onload = () => {
      const w = printFrame.contentWindow;
      w.onafterprint = () => { if (printFrame) { printFrame.remove(); printFrame = null; } };
      setTimeout(() => { w.focus(); w.print(); }, 60);
    };
    printFrame.srcdoc = html;
  };

  /* ============================================================
     Range-picker modal
     ============================================================ */
  R.openModal = function () {
    const today = D.today();
    const presets = [
      ["7", "Last 7 days", "tactical weekly report"],
      ["30", "Last 30 days", "habits & consistency"],
      ["90", "Last 90 days", "long-term growth trends"],
      ["all", "All time", "the whole journey"],
      ["custom", "Custom range", "pick exact dates"],
    ];
    App.ui.openModal({
      title: "Progress Report",
      body: `
        <p class="muted small mb-3" style="line-height:1.5">
          Builds a professional progress report for the chosen period — highlights, study activity,
          grade snapshot, upcoming deadlines and a Coach's Corner. Your browser's print dialog opens:
          choose <strong>“Save as PDF”</strong> to download it.
        </p>
        <div class="stack-sm" data-report-presets>
          ${presets.map(([v, label, hint], i) => `
            <label class="report-preset ${i === 1 ? "active" : ""}">
              <input type="radio" name="range" value="${v}" ${i === 1 ? "checked" : ""}>
              <span style="flex:1"><strong>${label}</strong> <span class="muted small">— ${hint}</span></span>
            </label>`).join("")}
        </div>
        <div class="form-row mt-3" data-custom-range hidden>
          <div class="field"><label>From</label><input class="input" type="date" name="from" value="${D.addDays(today, -30)}"></div>
          <div class="field"><label>To</label><input class="input" type="date" name="to" value="${today}"></div>
        </div>`,
      foot: `<button class="btn btn-outline" data-close>Cancel</button>
             <button class="btn btn-primary" data-generate>${App.icon("fileText")} Generate report</button>`,
      onMount(el, handle) {
        const customRow = el.querySelector("[data-custom-range]");
        el.querySelectorAll('input[name="range"]').forEach((r) =>
          r.addEventListener("change", () => {
            customRow.hidden = r.value !== "custom" || !r.checked;
            el.querySelectorAll(".report-preset").forEach((lbl) =>
              lbl.classList.toggle("active", lbl.querySelector("input").checked));
          }));
        el.querySelector("[data-generate]").addEventListener("click", () => {
          const v = el.querySelector('input[name="range"]:checked').value;
          let from, to = today;
          if (v === "all") from = earliestDataDate();
          else if (v === "custom") {
            from = el.querySelector('input[name="from"]').value;
            to = el.querySelector('input[name="to"]').value;
            if (!from || !to) { App.toast("Pick both dates", "error"); return; }
            if (to < from) { App.toast("The end date is before the start date", "error"); return; }
          } else {
            from = D.addDays(today, -(parseInt(v) - 1));
          }
          handle.close();
          R.print(from, to);
          App.toast("Report ready — choose “Save as PDF” in the print dialog");
        });
      },
    });
  };
})();
