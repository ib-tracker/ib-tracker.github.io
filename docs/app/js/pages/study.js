/* pages/study.js — focused study session with task queue.
   Session state persists in the store, so a refresh never loses it. */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = App.ui;
  const D = App.dates;
  const T = App.timer;

  // pre-start choices (ephemeral)
  let duration = 25;
  let selectedIds = [];
  let showMore = false;

  const RING_R = 120;
  const CIRC = 2 * Math.PI * RING_R;

  function sess() { return App.state().studySession; }

  /* ---------- pomodoro helpers ---------- */
  function pomoOn() { return App.state().settings.pomodoro_enabled === true; }
  function pomoFocus() { return App.clamp(App.state().settings.pomodoro_focus_min || 25, 5, 120); }
  function pomoBreak() { return App.clamp(App.state().settings.pomodoro_break_min || 5, 1, 60); }

  // phase countdown for a pomodoro session (uses real wall-clock since phase start)
  function phaseInfo(ss) {
    const p = ss.pomo;
    const total = (p.phase === "focus" ? p.focusMin : p.breakMin) * 60;
    const elapsed = Math.max(0, Math.floor((Date.now() - p.phaseStartEpoch) / 1000));
    return { phase: p.phase, total, elapsed, remaining: Math.max(0, total - elapsed) };
  }

  const chime = (up) => App.chime(up);

  // advance focus<->break; freezes the study clock during breaks so logged time is focus-only
  function advancePhase(ss) {
    const nowMs = Date.now();
    if (ss.pomo.phase === "focus") {
      App.update((s) => {
        const s2 = s.studySession; if (!s2) return;
        s2.pausedAccumSec += (nowMs - s2.startEpoch) / 1000;
        s2.taskPausedAccumSec += (nowMs - s2.taskStartEpoch) / 1000;
        s2.paused = true;
        s2.pomo.phase = "break";
        s2.pomo.phaseStartEpoch = nowMs;
      });
      chime(false);
      // Phase flips are the one thing that happens while you're off in another
      // app, so they get an OS banner too when the window isn't focused.
      App.announce(`Break time — ${pomoBreak()} min. Rest your eyes 👀`, "Your pomodoro focus block is done.");
    } else {
      App.update((s) => {
        const s2 = s.studySession; if (!s2) return;
        s2.startEpoch = nowMs; s2.taskStartEpoch = nowMs; s2.paused = false;
        s2.pomo.phase = "focus";
        s2.pomo.phaseStartEpoch = nowMs;
        s2.pomo.cycles = (s2.pomo.cycles || 0) + 1;
      });
      chime(true);
      App.announce("Back to focus 🎯", `Break over — ${pomoFocus()} min of focus starts now.`);
    }
  }

  function skipBreak() {
    const ss = sess();
    if (ss && ss.pomo && ss.pomo.phase === "break") advancePhase(ss);
  }

  function sessionElapsed(ss) {
    return T.elapsedSec({ startEpoch: ss.startEpoch, pausedAccumSec: ss.pausedAccumSec, paused: ss.paused });
  }
  function taskElapsed(ss) {
    return T.elapsedSec({ startEpoch: ss.taskStartEpoch, pausedAccumSec: ss.taskPausedAccumSec, paused: ss.paused });
  }

  function start() {
    const usePomo = pomoOn();
    const focusLen = usePomo ? pomoFocus() : duration;
    if (focusLen < 1) return;
    App.update((s) => {
      s.studySession = {
        duration: focusLen,
        startEpoch: Date.now(), pausedAccumSec: 0, paused: false,
        startISO: new Date().toISOString(),
        queueIds: [...selectedIds], currentIndex: 0, completed: [],
        taskStartEpoch: Date.now(), taskPausedAccumSec: 0,
        pomo: usePomo ? { focusMin: pomoFocus(), breakMin: pomoBreak(), phase: "focus", phaseStartEpoch: Date.now(), cycles: 0 } : null,
      };
    });
  }

  function pause() {
    App.update((s) => {
      const ss = s.studySession;
      if (!ss || ss.paused) return;
      const nowMs = Date.now();
      ss.pausedAccumSec += (nowMs - ss.startEpoch) / 1000;
      ss.taskPausedAccumSec += (nowMs - ss.taskStartEpoch) / 1000;
      ss.paused = true;
    });
  }

  function resume() {
    App.update((s) => {
      const ss = s.studySession;
      if (!ss || !ss.paused) return;
      ss.startEpoch = Date.now();
      ss.taskStartEpoch = Date.now();
      ss.paused = false;
    });
  }

  function reset() {
    App.update((s) => { s.studySession = null; });
  }

  function completeCurrentTask() {
    const ss = sess();
    if (!ss) return;
    const taskId = ss.queueIds[ss.currentIndex];
    const task = taskId && App.taskById(taskId);
    if (!task) return;
    const elapsed = taskElapsed(ss);
    const beforeLevel = App.xp.compute().level;
    App.logSession({
      task_id: task.id, task_title: task.title, subject_name: task.subject_name || "",
      estimated_minutes: task.estimated_minutes || 0, overtime_minutes: 0,
      start_time: new Date(Date.now() - elapsed * 1000).toISOString(),
      end_time: new Date().toISOString(),
    });
    if (!task.completed) App.toggleTask(task.id);
    App.confetti();
    App.xp.checkLevelUp(beforeLevel);
    App.update((s) => {
      const s2 = s.studySession;
      if (!s2) return;
      s2.completed.push({ id: task.id, title: task.title, elapsed });
      s2.currentIndex += 1;
      s2.taskStartEpoch = Date.now();
      s2.taskPausedAccumSec = 0;
    });
  }

  function stopAndLog() {
    const ss = sess();
    if (!ss) return;
    const elapsed = sessionElapsed(ss);
    const actualMin = Math.round(elapsed / 60);
    const queueTasks = ss.queueIds.map((id) => App.taskById(id)).filter(Boolean);
    const sameSubject = queueTasks.length && queueTasks.every((t) => t.subject_name === queueTasks[0].subject_name);
    App.logSession({
      task_title: ss.queueIds.length
        ? `Study Session (${ss.completed.length}/${ss.queueIds.length} tasks)`
        : (ss.pomo ? "Pomodoro Session" : "Study Session"),
      subject_name: sameSubject ? queueTasks[0].subject_name || "" : "",
      estimated_minutes: ss.pomo ? 0 : ss.duration,
      overtime_minutes: ss.pomo ? 0 : actualMin - ss.duration,
      start_time: ss.startISO,
      end_time: new Date().toISOString(),
    });
    reset();
    App.sfx("session");
    App.toast(`Session logged · ${App.fmtMinutes(actualMin)} focused`);
  }

  /* ---------- queue selector (pre-start) ---------- */
  function queueSelectorHTML() {
    const today = D.today();
    const taskMap = App.taskMap();
    const open = App.sortedTasks().filter((t) => !t.completed);
    const selSet = new Set(selectedIds);

    const isLockedForQueue = (t) => {
      if (!t.predecessor_id) return false;
      const pred = taskMap.get(t.predecessor_id);
      if (!pred || pred.completed) return false;
      return !selSet.has(t.predecessor_id); // unlocked if its predecessor is queued ahead of it
    };

    const scheduledToday = (t) => (t.scheduled_blocks || []).some((b) => b.date === today);
    const firstBlockToday = (t) => Math.min(...(t.scheduled_blocks || []).filter((b) => b.date === today).map((b) => b.start_min));

    const todays = open.filter((t) => scheduledToday(t) && !isLockedForQueue(t))
      .sort((a, b) => firstBlockToday(a) - firstBlockToday(b));
    const others = open.filter((t) => !scheduledToday(t) && t.due_date && !isLockedForQueue(t))
      .sort((a, b) => a.due_date.localeCompare(b.due_date));

    const row = (t) => {
      const sel = selSet.has(t.id);
      const overdue = App.isOverdue(t);
      const schedToday = scheduledToday(t);
      return `
        <div class="queue-row">
          <button class="sel-check ${sel ? "checked" : ""}" data-q-toggle="${esc(t.id)}" aria-label="Queue task">${App.icon("check")}</button>
          <span class="q-title" data-q-toggle="${esc(t.id)}">${esc(t.title)}</span>
          <span class="q-meta">
            ${schedToday ? `<span class="chip chip-accent">${App.icon("calendar")} ${D.minToLabel(firstBlockToday(t))}</span>` : ""}
            ${t.due_date ? `<span class="${overdue ? "chip chip-danger" : ""}">${overdue ? "Overdue · " : ""}${D.fmtShort(t.due_date)}</span>` : ""}
            ${t.estimated_minutes ? `<span>${App.fmtMinutes(t.estimated_minutes)}</span>` : ""}
          </span>
        </div>`;
    };

    if (!todays.length && !others.length) {
      return `<p class="muted small" style="text-align:center;padding:14px 0">No open tasks available — add some first</p>`;
    }
    return `
      <div style="max-height:260px;overflow-y:auto">
        ${todays.map(row).join("")}
        ${others.length ? `
          <button class="btn btn-ghost btn-sm btn-block" data-q-more>
            ${showMore ? App.icon("chevU") : App.icon("chevD")} ${showMore ? "Show less" : `See more (${others.length})`}
          </button>
          ${showMore ? others.map(row).join("") : ""}` : ""}
      </div>
      ${selectedIds.length ? `
        <hr class="divider">
        <p class="muted small mb-2">Queue order</p>
        ${selectedIds.map((id, i) => {
          const t = App.taskById(id);
          return t ? `
            <div class="queue-row">
              <span class="chip chip-accent" style="width:22px;justify-content:center">${i + 1}</span>
              <span class="q-title">${esc(t.title)}</span>
            </div>` : "";
        }).join("")}` : ""}`;
  }

  /* ---------- ring ---------- */
  function ringHTML(ss) {
    // pomodoro: the ring shows the current phase countdown
    if (ss && ss.pomo) {
      const pi = phaseInfo(ss);
      const isBreak = pi.phase === "break";
      const progress = pi.total > 0 ? Math.min(1, pi.elapsed / pi.total) : 0;
      const offset = CIRC - progress * CIRC;
      const currentTask = ss.queueIds.length && ss.currentIndex < ss.queueIds.length
        ? App.taskById(ss.queueIds[ss.currentIndex]) : null;
      return `
        <div class="study-ring-wrap">
          <div class="study-ring">
            <svg class="ring" viewBox="0 0 260 260">
              <circle cx="130" cy="130" r="${RING_R}" fill="none" stroke="var(--surface-3)" stroke-width="7"/>
              <circle cx="130" cy="130" r="${RING_R}" fill="none"
                stroke="${isBreak ? "var(--good)" : "var(--accent)"}" stroke-width="7"
                stroke-dasharray="${CIRC}" stroke-dashoffset="${offset}" stroke-linecap="round"
                data-ss-ring style="transition:stroke-dashoffset 1s linear"/>
            </svg>
            <div class="ring-center">
              <span class="time" data-ss-time>${App.fmtClock(pi.remaining)}</span>
              <span class="sub" data-ss-sub>${isBreak ? "break" : "focus"}${ss.pomo.cycles ? " · round " + (ss.pomo.cycles + 1) : ""}</span>
              ${!isBreak && currentTask ? `<span class="now-task">▶ ${esc(currentTask.title)}</span>` : ""}
              ${isBreak ? `<span class="now-task">☕ take a breather</span>` : ""}
            </div>
          </div>
        </div>`;
    }

    const previewMin = pomoOn() ? pomoFocus() : duration;
    let remaining = previewMin * 60, progress = 0, overtime = false, elapsed = 0;
    if (ss) {
      elapsed = sessionElapsed(ss);
      const totalSec = ss.duration * 60;
      overtime = elapsed > totalSec;
      remaining = Math.max(0, totalSec - elapsed);
      progress = totalSec > 0 ? Math.min(1, elapsed / totalSec) : 0;
    }
    const offset = CIRC - progress * CIRC;
    const currentTask = ss && ss.queueIds.length && ss.currentIndex < ss.queueIds.length
      ? App.taskById(ss.queueIds[ss.currentIndex]) : null;
    return `
      <div class="study-ring-wrap">
        <div class="study-ring">
          <svg class="ring" viewBox="0 0 260 260">
            <circle cx="130" cy="130" r="${RING_R}" fill="none" stroke="var(--surface-3)" stroke-width="7"/>
            <circle cx="130" cy="130" r="${RING_R}" fill="none"
              stroke="${overtime ? "var(--danger)" : "var(--accent)"}" stroke-width="7"
              stroke-dasharray="${CIRC}" stroke-dashoffset="${offset}" stroke-linecap="round"
              data-ss-ring style="transition:stroke-dashoffset 1s linear"/>
          </svg>
          <div class="ring-center">
            <span class="time ${overtime ? "overtime" : ""}" data-ss-time>${overtime ? "+" + App.fmtClock(elapsed - ss.duration * 60) : App.fmtClock(ss ? remaining : previewMin * 60)}</span>
            <span class="sub" data-ss-sub>${ss ? (overtime ? "overtime" : ss.paused ? "paused" : "remaining") : (pomoOn() ? "focus / break" : "ready")}</span>
            ${currentTask ? `<span class="now-task">▶ ${esc(currentTask.title)}</span>` : ""}
          </div>
        </div>
      </div>`;
  }

  App.pages.study = {
    title: "Study Session",
    render() {
      const ss = sess();

      if (!ss) {
        return `
          <div class="page narrow">
            ${UI.pageHead("Study Session", "Focused timer with a task queue")}
            <div class="stack">
              <div class="card card-pad" style="text-align:center">
                <div class="row" style="justify-content:center;gap:8px;margin-bottom:14px">
                  <button class="btn ${!pomoOn() ? "btn-primary" : "btn-outline"} btn-sm" data-ss-mode="simple">${App.icon("timer")} Simple</button>
                  <button class="btn ${pomoOn() ? "btn-primary" : "btn-outline"} btn-sm" data-ss-mode="pomodoro">${App.icon("coffee")} Pomodoro</button>
                </div>
                ${pomoOn() ? `
                  <div class="row" style="justify-content:center;gap:16px">
                    <div class="field" style="max-width:118px;margin:0"><label style="text-align:center">Focus (min)</label><input class="input" type="number" min="5" max="120" data-pomo-focus value="${pomoFocus()}" style="text-align:center;font-weight:600"></div>
                    <div class="field" style="max-width:118px;margin:0"><label style="text-align:center">Break (min)</label><input class="input" type="number" min="1" max="60" data-pomo-break value="${pomoBreak()}" style="text-align:center;font-weight:600"></div>
                  </div>
                  <p class="hint" style="margin-top:8px">Focus, then a short break, on repeat. Break time isn't counted as study.</p>
                ` : `
                  <div class="field" style="max-width:180px;margin:0 auto 4px">
                    <label style="text-align:center">Session duration (minutes)</label>
                    <input class="input" type="number" min="1" max="480" data-ss-duration value="${duration}" style="text-align:center;font-size:16px;font-weight:600">
                  </div>
                  <div class="duration-presets">
                    ${[15, 25, 45, 60].map((m) => `
                      <button class="btn ${duration === m ? "btn-primary" : "btn-outline"} btn-sm" data-ss-preset="${m}">${m}m</button>`).join("")}
                  </div>
                `}
              </div>
              <div class="card card-pad">
                <div class="row between mb-2">
                  <span class="card-title">Tasks to complete</span>
                  <span class="muted small">${selectedIds.length} selected</span>
                </div>
                <div data-queue-selector>${queueSelectorHTML()}</div>
              </div>
              ${ringHTML(null)}
              <div class="row" style="justify-content:center">
                <button class="btn btn-primary btn-lg" data-ss-start>${App.icon("play")} Start Session</button>
              </div>
            </div>
          </div>`;
      }

      const currentTask = ss.queueIds.length && ss.currentIndex < ss.queueIds.length
        ? App.taskById(ss.queueIds[ss.currentIndex]) : null;
      const allDone = ss.queueIds.length > 0 && ss.currentIndex >= ss.queueIds.length;

      return `
        <div class="page narrow">
          ${UI.pageHead("Study Session", ss.pomo ? (ss.pomo.phase === "break" ? "On a break — back soon" : "Focus round — stay with it") : (ss.paused ? "Paused" : "In session — stay focused"))}
          ${ringHTML(ss)}
          ${ss.queueIds.length ? `
            <div class="card card-pad mb-4">
              <div class="row between mb-2">
                <span class="card-title">Task queue</span>
                <span class="muted small">${ss.completed.length}/${ss.queueIds.length} done</span>
              </div>
              ${currentTask && !allDone ? `
                <div class="now-card mb-3">
                  <div class="row between">
                    <div style="flex:1;min-width:0">
                      <div class="now-label">Now working on</div>
                      <div class="now-title">${esc(currentTask.title)}</div>
                      ${currentTask.estimated_minutes ? `<div class="muted small">est. ${App.fmtMinutes(currentTask.estimated_minutes)}</div>` : ""}
                    </div>
                    <div class="now-elapsed" data-ss-task-elapsed>${App.fmtClock(taskElapsed(ss))}</div>
                  </div>
                  <button class="btn btn-good btn-block mt-3" data-ss-complete>${App.icon("checkCircle")} Complete Task</button>
                </div>` : ""}
              ${allDone ? `
                <div style="text-align:center;padding:10px 0 14px">
                  <span style="color:var(--good)">${App.icon("checkCircle")}</span>
                  <p style="font-weight:650;margin-top:4px">All queued tasks completed!</p>
                </div>` : ""}
              ${ss.queueIds.map((id, i) => {
                const t = App.taskById(id);
                const title = t ? t.title : "(deleted task)";
                const done = i < ss.currentIndex;
                const current = i === ss.currentIndex && !allDone;
                return `
                  <div class="queue-row ${done ? "done" : ""} ${current ? "current" : ""}">
                    ${done ? `<span style="color:var(--good);display:flex">${App.icon("checkCircle")}</span>` : `<span style="color:var(--ink-3);display:flex">${App.icon("clock")}</span>`}
                    <span class="q-title">${esc(title)}</span>
                    ${current ? `<span class="chip chip-accent">current</span>` : ""}
                    ${done && ss.completed[i] ? `<span class="q-meta">${App.fmtClock(ss.completed[i].elapsed)}</span>` : ""}
                  </div>`;
              }).join("")}
            </div>` : ""}
          <div class="row" style="justify-content:center">
            ${ss.pomo
              ? (ss.pomo.phase === "break"
                  ? `<button class="btn btn-primary btn-lg" data-ss-skip-break>${App.icon("play")} Skip break</button>`
                  : "")
              : (ss.paused
                  ? `<button class="btn btn-primary btn-lg" data-ss-resume>${App.icon("play")} Resume</button>`
                  : `<button class="btn btn-outline btn-lg" data-ss-pause>${App.icon("pause")} Pause</button>`)}
            <button class="btn btn-outline btn-lg" data-ss-reset>${App.icon("rotate")} Reset</button>
            <button class="btn btn-primary btn-lg" data-ss-stop>${App.icon("square")} Stop & Log</button>
          </div>
        </div>`;
    },

    mount(el) {
      const ss = sess();
      if (!ss) {
        el.querySelectorAll("[data-ss-mode]").forEach((b) =>
          b.addEventListener("click", () => {
            App.update((s) => { s.settings.pomodoro_enabled = b.dataset.ssMode === "pomodoro"; });
          }));
        const dur = el.querySelector("[data-ss-duration]");
        if (dur) dur.addEventListener("change", () => {
          duration = App.clamp(parseInt(dur.value) || 25, 1, 480);
          App.render();
        });
        el.querySelectorAll("[data-ss-preset]").forEach((b) =>
          b.addEventListener("click", () => { duration = parseInt(b.dataset.ssPreset); App.render(); }));
        const pf = el.querySelector("[data-pomo-focus]");
        if (pf) pf.addEventListener("change", () => {
          App.update((s) => { s.settings.pomodoro_focus_min = App.clamp(parseInt(pf.value) || 25, 5, 120); }, { silent: true });
        });
        const pb = el.querySelector("[data-pomo-break]");
        if (pb) pb.addEventListener("change", () => {
          App.update((s) => { s.settings.pomodoro_break_min = App.clamp(parseInt(pb.value) || 5, 1, 60); }, { silent: true });
        });
        el.querySelector("[data-ss-start]").addEventListener("click", start);

        const selWrap = el.querySelector("[data-queue-selector]");
        selWrap.addEventListener("click", (e) => {
          const more = e.target.closest("[data-q-more]");
          if (more) { showMore = !showMore; App.render(); return; }
          const tgl = e.target.closest("[data-q-toggle]");
          if (tgl) {
            const id = tgl.dataset.qToggle;
            if (selectedIds.includes(id)) selectedIds = selectedIds.filter((x) => x !== id);
            else selectedIds.push(id);
            App.render();
          }
        });
        App.pageTick = null;
        return;
      }

      const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.addEventListener("click", fn); };
      on("[data-ss-pause]", pause);
      on("[data-ss-resume]", resume);
      on("[data-ss-skip-break]", skipBreak);
      on("[data-ss-stop]", stopAndLog);
      on("[data-ss-complete]", completeCurrentTask);
      on("[data-ss-reset]", async () => {
        const ok = await UI.confirm({
          title: "Reset session?",
          message: "The timer will be discarded without logging anything.",
          confirmLabel: "Reset", danger: true,
        });
        if (ok) { selectedIds = []; reset(); }
      });

      // per-second updates
      let wasOvertime = null;
      App.pageTick = function () {
        const s2 = sess();
        if (!s2) return;

        // pomodoro: drive phase countdown + transitions
        if (s2.pomo) {
          const pi = phaseInfo(s2);
          if (pi.elapsed >= pi.total) { advancePhase(s2); return; } // advancePhase re-renders
          const timeEl = el.querySelector("[data-ss-time]");
          if (timeEl) timeEl.textContent = App.fmtClock(pi.remaining);
          const ring = el.querySelector("[data-ss-ring]");
          if (ring) {
            const progress = pi.total > 0 ? Math.min(1, pi.elapsed / pi.total) : 0;
            ring.setAttribute("stroke-dashoffset", CIRC - progress * CIRC);
          }
          if (s2.pomo.phase === "focus") {
            const te = el.querySelector("[data-ss-task-elapsed]");
            if (te) te.textContent = App.fmtClock(taskElapsed(s2));
          }
          return;
        }

        if (s2.paused) return;
        const elapsed = sessionElapsed(s2);
        const totalSec = s2.duration * 60;
        const overtime = elapsed > totalSec;
        if (wasOvertime === null) wasOvertime = overtime;
        if (overtime !== wasOvertime) {
          const wasPrev = wasOvertime;
          wasOvertime = overtime;
          if (overtime && wasPrev === false) {
            App.chime();
            App.notify("Session complete ⏱", `You've reached your ${s2.duration}-minute target.`);
          }
          App.render();
          return;
        }
        const timeEl = el.querySelector("[data-ss-time]");
        if (timeEl) timeEl.textContent = overtime ? "+" + App.fmtClock(elapsed - totalSec) : App.fmtClock(totalSec - elapsed);
        const ring = el.querySelector("[data-ss-ring]");
        if (ring) {
          const progress = totalSec > 0 ? Math.min(1, elapsed / totalSec) : 0;
          ring.setAttribute("stroke-dashoffset", CIRC - progress * CIRC);
        }
        const te = el.querySelector("[data-ss-task-elapsed]");
        if (te) te.textContent = App.fmtClock(taskElapsed(s2));
      };
    },
  };
})();
