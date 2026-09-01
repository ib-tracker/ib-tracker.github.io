/* timer.js — floating task timer + tick loop. State persists, so a page
   refresh never loses a running session (the original app lost it). */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const T = (App.timer = {});
  const TU = (App.timerUI = {});

  /* ---------- shared math ---------- */
  T.elapsedSec = function (t) {
    if (!t) return 0;
    const run = t.paused ? 0 : (Date.now() - t.startEpoch) / 1000;
    return Math.max(0, Math.floor((t.pausedAccumSec || 0) + run));
  };

  /* ---------- abandoned clocks -------------------------------------------
     Both clocks store an absolute startEpoch and nothing ever revisited it, so
     a timer left running overnight was still "running" the next morning with
     the whole night on it. Pressing Stop then banked a fourteen-hour study
     session, and logged minutes are not cosmetic: they drive XP, the streak,
     the weekly goal and every chart in Analytics.

     The fix is to refuse to guess. There is no way to know how long the person
     actually worked, so nothing is logged, the abandoned clock is dropped, and
     they are told plainly rather than left to discover a bad number later.

     The test is elapsed time, not "started on an earlier day": beginning at
     11pm and stopping at 1am is a real session that happens to cross midnight.
     A paused clock is left alone, because pausing freezes elapsed — someone
     who paused at thirty minutes and came back a week later still has thirty
     honest minutes waiting. */
  const STALE_AFTER_HOURS = 8;

  T.dropAbandoned = function () {
    const s = App.state();
    const dropped = [];

    const isStale = (clock) => clock && (T.elapsedSec(clock) / 3600) >= STALE_AFTER_HOURS;
    const hours = (clock) => Math.round(T.elapsedSec(clock) / 3600);

    const staleTimer = isStale(s.timer);
    const staleSession = isStale(s.studySession);
    if (staleTimer) dropped.push(`task timer (${hours(s.timer)}h)`);
    if (staleSession) dropped.push(`study session (${hours(s.studySession)}h)`);
    if (!dropped.length) return false;

    // system: whoever left it running may well be out of trial by now, and a
    // clock that cannot be cleared would keep offering to log a bogus session.
    App.update((st) => {
      if (staleTimer) st.timer = null;
      if (staleSession) st.studySession = null;
    }, { silent: true, system: true });

    App.toast(`Discarded a ${dropped.join(" and ")} left running. No study time was logged.`, "error");
    return true;
  };

  /* ---------- full screen ------------------------------------------------
     The same timer, larger. Deliberately not a third timer: it reads the same
     state.timer the floating widget does, so there is one clock, one elapsed
     count and one place to stop it.

     Kept in a module variable rather than the store, so a reload never leaves
     you stuck in a full-screen view you cannot remember opening. */
  let fullscreen = false;
  T.isFullscreen = () => fullscreen && !!App.state().timer;
  T.setFullscreen = function (on) {
    fullscreen = !!on && !!App.state().timer;
    TU.renderFloating();
  };

  // Escape is what everyone tries first.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && T.isFullscreen()) T.setFullscreen(false);
  });

  /* ---------- floating single-task timer ---------- */
  T.active = () => App.state().timer;

  T.start = function (taskId, taskTitle, estimatedMinutes) {
    if (App.state().timer) { App.toast("A timer is already running", "error"); return; }
    // Two independent clocks could run at once — this one and a Study Session —
    // each counting the same minutes and each logging its own session at the
    // end, so the time was banked twice and two clocks sat on screen.
    if (App.state().studySession) {
      App.toast("A study session is already running — stop that first", "error");
      return;
    }
    App.update((s) => {
      s.timer = {
        taskId: taskId || "", taskTitle: taskTitle || "Study Session",
        estimatedMinutes: estimatedMinutes || 0,
        startEpoch: Date.now(), pausedAccumSec: 0, paused: false,
        minimized: false, startISO: new Date().toISOString(),
      };
    });
  };

  T.pause = function () {
    App.update((s) => {
      const t = s.timer;
      if (!t || t.paused) return;
      t.pausedAccumSec = (t.pausedAccumSec || 0) + (Date.now() - t.startEpoch) / 1000;
      t.paused = true;
    });
  };

  T.resume = function () {
    App.update((s) => {
      const t = s.timer;
      if (!t || !t.paused) return;
      t.startEpoch = Date.now();
      t.paused = false;
    });
  };

  T.stop = function (markComplete) {
    const t = App.state().timer;
    if (!t) return;
    const elapsed = T.elapsedSec(t);
    const actualMin = Math.round(elapsed / 60);
    const task = t.taskId ? App.taskById(t.taskId) : null;
    const beforeLevel = App.xp.compute().level;
    App.logSession({
      task_id: t.taskId || "",
      task_title: t.taskTitle || "Study Session",
      subject_name: task ? task.subject_name || "" : "",
      estimated_minutes: t.estimatedMinutes || 0,
      overtime_minutes: t.estimatedMinutes ? actualMin - t.estimatedMinutes : 0,
    /* Derived from the counted elapsed, NOT from startISO. startISO is when
       the timer was first started, so a session that was paused banked the
       whole wall-clock span: pause for a fifty-minute lunch and the lunch was
       logged as study. The clock had it right all along — pausedAccumSec is
       exactly the time that should not count. Study Session already logged
       this way; the task timer did not. */
      start_time: new Date(Date.now() - elapsed * 1000).toISOString(),
      end_time: new Date().toISOString(),
    });
    if (markComplete && t.taskId && task && !task.completed) {
      App.toggleTask(t.taskId);
      App.confetti();
    }
    App.xp.checkLevelUp(beforeLevel);
    App.update((s) => { s.timer = null; });
    // markComplete already sounded the task cue via App.toggleTask above.
    if (!markComplete) App.sfx("session");
    App.toast(markComplete ? "Task completed & session logged" : `${App.xp.sessionEncouragement()} · ${App.fmtMinutes(actualMin)} logged`);
  };

  /* Bank what has been worked so far and keep the clock running.

     Stop already logged the time, but it also ended the sitting, so a long
     stretch on one task could not be recorded in pieces: you either stopped
     — ending it — or carried the whole lot in one lump that existed nowhere
     until you did. This is the task timer's version of the study session's
     "Log & move on".

     The clock restarts from zero afterwards and re-aims at what is now left,
     exactly as T.start does. Without the restart the next Stop would log from
     the original start and bank these minutes a second time. */
  T.logProgress = function () {
    const t = App.state().timer;
    if (!t) return;
    const elapsed = T.elapsedSec(t);
    if (elapsed < 60) {
      App.toast("Nothing to log yet — less than a minute on the clock", "error");
      return;
    }
    const mins = Math.round(elapsed / 60);
    const task = t.taskId ? App.taskById(t.taskId) : null;
    App.logSession({
      task_id: t.taskId || "",
      task_title: t.taskTitle || "Study Session",
      subject_name: task ? task.subject_name || "" : "",
      estimated_minutes: t.estimatedMinutes || 0,
      overtime_minutes: t.estimatedMinutes ? mins - t.estimatedMinutes : 0,
      start_time: new Date(Date.now() - elapsed * 1000).toISOString(),
      end_time: new Date().toISOString(),
    });
    App.update((s) => {
      if (!s.timer) return;
      s.timer.startEpoch = Date.now();
      s.timer.pausedAccumSec = 0;
      s.timer.startISO = new Date().toISOString();
      // Re-aim at the remainder now that these minutes count towards the task.
      if (task) s.timer.estimatedMinutes = App.taskMinutesLeft(App.taskById(task.id));
    });
    App.sfx("session");
    App.toast(`${App.fmtMinutes(mins)} logged — timer still running`);
  };

  T.toggleMinimize = function () {
    App.update((s) => { if (s.timer) s.timer.minimized = !s.timer.minimized; });
  };

  /* What the big number says.

     In overtime it now shows the OVERAGE rather than the running total. The
     total was prefixed with "+" and sat directly under "over your estimate",
     so a 2h 15m sitting that had run fifteen minutes long announced itself as
     "+2:30:01" — read as two and a half hours over. The total has not gone
     away; it moved to the line underneath, where it isn't wearing a plus
     sign. */
  function clockText(elapsed, estSec, overtime) {
    if (!estSec) return App.fmtClock(elapsed);
    return App.fmtClock(overtime ? elapsed - estSec : estSec - elapsed);
  }

  function subText(t, elapsed, estSec, overtime) {
    if (overtime) return `over ${App.fmtMinutes(t.estimatedMinutes)} · ${App.fmtMinutes(Math.round(elapsed / 60))} total`;
    return estSec > 0 ? `of ${App.fmtMinutes(t.estimatedMinutes)}` : "elapsed";
  }

  /* Task-level progress for the timer views: minutes already banked plus the
     minutes on the clock right now.

     The sitting's own countdown aims at what was LEFT when it started, so on a
     three-hour task with forty-five minutes done it counts down from 2h 15m
     and fills its bar when the sitting ends — nothing on screen said the
     earlier forty-five minutes existed at all.

     Counted live because a bar that only moves once you stop is no use on a
     screen you sit and stare at while you work. The minutes become real on
     Stop or Finish, and a clock left running overnight is discarded rather
     than banked, so nothing is claimed here that cannot be earned. */
  function taskProgress(t, elapsedSec) {
    if (!t.taskId) return null;
    const task = App.taskById(t.taskId);
    if (!task || !task.estimated_minutes) return null;
    const done = App.taskMinutesLogged(task.id) + Math.round(elapsedSec / 60);
    return { done, est: task.estimated_minutes, pct: App.clamp((done / task.estimated_minutes) * 100, 0, 100) };
  }

  /* ---------- floating widget ---------- */
  TU.renderFloating = function () {
    const root = document.getElementById("floating-timer");
    if (!root) return;
    const t = App.state().timer;
    if (!t) { root.innerHTML = ""; return; }

    const elapsed = T.elapsedSec(t);
    const estSec = (t.estimatedMinutes || 0) * 60;
    const overtime = estSec > 0 && elapsed > estSec;
    const tp = taskProgress(t, elapsed);

    if (fullscreen) {
      const display = clockText(elapsed, estSec, overtime);
      const pct = estSec > 0 ? App.clamp((elapsed / estSec) * 100, 0, 100) : 0;
      root.innerHTML = `
        <div class="ftimer-full ${overtime ? "overtime" : ""}" role="dialog" aria-label="Timer">
          <button class="icon-btn ftimer-exit" data-ft-exit title="Exit full screen (Esc)" aria-label="Exit full screen">${App.icon("minimize")}</button>
          <div class="ff-task">${esc(t.taskTitle || "Study Session")}</div>
          <div class="ff-clock" data-ft-time>${overtime ? "+" : ""}${display}</div>
          <div class="ff-sub" data-ft-sub>${subText(t, elapsed, estSec, overtime)}</div>
          ${estSec > 0 ? `<div class="ff-bar"><span data-ft-bar style="width:${pct}%"></span></div>` : ""}
          ${tp ? `
            <div class="ff-taskprog">
              <div class="ff-tp-label">
                <span data-ft-tptext>${App.fmtMinutes(tp.done)} of ${App.fmtMinutes(tp.est)} on this task</span>
                <span data-ft-tppct>${Math.round(tp.pct)}%</span>
              </div>
              <div class="ff-bar task"><span data-ft-taskbar style="width:${tp.pct}%"></span></div>
            </div>` : ""}
          <div class="ff-controls">
            ${t.paused
              ? `<button class="btn btn-primary btn-lg" data-ft-resume>${App.icon("play")} Resume</button>`
              : `<button class="btn btn-outline btn-lg" data-ft-pause>${App.icon("pause")} Pause</button>`}
            ${t.taskId ? `<button class="btn btn-outline btn-lg" data-ft-log
                    title="Bank the time so far and keep going">${App.icon("save")} Log progress</button>` : ""}
            <button class="btn btn-outline btn-lg" data-ft-stop>${App.icon("square")} Log &amp; stop</button>
            ${t.taskId ? `<button class="btn btn-good btn-lg" data-ft-finish>${App.icon("check")} Finish</button>` : ""}
          </div>
        </div>`;
      const qf = (sel) => root.querySelector(sel);
      qf("[data-ft-exit]").addEventListener("click", () => T.setFullscreen(false));
      if (qf("[data-ft-pause]")) qf("[data-ft-pause]").addEventListener("click", () => T.pause());
      if (qf("[data-ft-resume]")) qf("[data-ft-resume]").addEventListener("click", () => T.resume());
      if (qf("[data-ft-log]")) qf("[data-ft-log]").addEventListener("click", () => T.logProgress());
      if (qf("[data-ft-stop]")) qf("[data-ft-stop]").addEventListener("click", () => { T.setFullscreen(false); T.stop(false); });
      if (qf("[data-ft-finish]")) qf("[data-ft-finish]").addEventListener("click", () => { T.setFullscreen(false); T.stop(true); });
      return;
    }

    if (t.minimized) {
      root.innerHTML = `
        <button class="ftimer-mini ${overtime ? "overtime" : ""}" data-ft-expand title="Open timer">
          ${App.icon("timer")}
          <span class="mini-time" data-ft-time>${App.fmtClock(elapsed)}</span>
        </button>`;
      root.querySelector("[data-ft-expand]").addEventListener("click", () => T.toggleMinimize());
      return;
    }

    const display = clockText(elapsed, estSec, overtime);
    root.innerHTML = `
      <div class="ftimer-panel">
        <div class="ftimer-title">
          <span class="name">${esc(t.taskTitle || "Study Session")}</span>
          <button class="icon-btn" data-ft-full title="Full screen">${App.icon("target")}</button>
          <button class="icon-btn" data-ft-min title="Minimize">${App.icon("minimize")}</button>
        </div>
        <div class="ftimer-time ${overtime ? "overtime" : ""}" data-ft-timewrap>
          <div class="big"><span data-ft-time>${overtime ? "+" : ""}${display}</span></div>
          ${overtime
            ? `<div class="ot-label" data-ft-sub>over est. · ${App.fmtMinutes(Math.round(elapsed / 60))} total</div>`
            : estSec > 0 ? `<div class="est">est. ${App.fmtMinutes(t.estimatedMinutes)}</div>` : ""}
          ${tp ? `<div class="est task" data-ft-tpline>${App.fmtMinutes(tp.done)} / ${App.fmtMinutes(tp.est)} on task</div>` : ""}
        </div>
        <div class="ftimer-controls">
          ${t.paused
            ? `<button class="btn btn-primary btn-sm" data-ft-resume>${App.icon("play")} Resume</button>`
            : `<button class="btn btn-outline btn-sm" data-ft-pause>${App.icon("pause")} Pause</button>`}
          ${t.taskId ? `<button class="btn btn-outline btn-sm" data-ft-log
                  title="Log progress and keep going" aria-label="Log progress and keep going">${App.icon("save")}</button>` : ""}
          <button class="btn btn-outline btn-sm" data-ft-stop>${App.icon("square")} Log &amp; stop</button>
          ${t.taskId ? `<button class="btn btn-good btn-sm" data-ft-finish>${App.icon("check")} Finish</button>` : ""}
        </div>
      </div>`;

    const q = (sel) => root.querySelector(sel);
    if (q("[data-ft-min]")) q("[data-ft-min]").addEventListener("click", () => T.toggleMinimize());
    if (q("[data-ft-full]")) q("[data-ft-full]").addEventListener("click", () => T.setFullscreen(true));
    if (q("[data-ft-pause]")) q("[data-ft-pause]").addEventListener("click", () => T.pause());
    if (q("[data-ft-resume]")) q("[data-ft-resume]").addEventListener("click", () => T.resume());
    if (q("[data-ft-log]")) q("[data-ft-log]").addEventListener("click", () => T.logProgress());
    if (q("[data-ft-stop]")) q("[data-ft-stop]").addEventListener("click", () => T.stop(false));
    if (q("[data-ft-finish]")) q("[data-ft-finish]").addEventListener("click", () => T.stop(true));
  };

  /* ---------- tick loop (targeted DOM updates only) ---------- */
  let lastOvertime = null;
  setInterval(() => {
    const t = App.state().timer;
    if (t) {
      const elapsed = T.elapsedSec(t);
      const estSec = (t.estimatedMinutes || 0) * 60;
      const overtime = estSec > 0 && elapsed > estSec;
      if (lastOvertime !== overtime) {
        const wasSet = lastOvertime !== null;
        lastOvertime = overtime;
        if (overtime && wasSet) {
          App.chime(); // reached the estimated time
          App.notify("Time's up ⏱", `${t.taskTitle || "Your session"} has hit its ${t.estimatedMinutes}-minute estimate.`);
        }
        TU.renderFloating();
      }
      else if (!t.paused) {
        const node = document.querySelector("#floating-timer [data-ft-time]");
        if (node) node.textContent = (overtime ? "+" : "") + clockText(elapsed, estSec, overtime);
        /* The overtime sub-line carries the running total, so it has to move
           with the clock rather than wait for the next full re-render. */
        const sub = document.querySelector("#floating-timer [data-ft-sub]");
        if (sub && overtime) {
          sub.textContent = sub.classList.contains("ot-label")
            ? `over est. · ${App.fmtMinutes(Math.round(elapsed / 60))} total`
            : subText(t, elapsed, estSec, overtime);
        }
        // The full-screen view has a progress bar the small one doesn't.
        const bar = document.querySelector("#floating-timer [data-ft-bar]");
        if (bar && estSec > 0) bar.style.width = App.clamp((elapsed / estSec) * 100, 0, 100) + "%";

        /* The task bar counts live, so it is driven from here rather than left
           to the next full re-render — which only happens when the sitting
           crosses into overtime, i.e. almost never while you are working. */
        const tp = taskProgress(t, elapsed);
        if (tp) {
          const tBar = document.querySelector("#floating-timer [data-ft-taskbar]");
          if (tBar) tBar.style.width = tp.pct + "%";
          const tPct = document.querySelector("#floating-timer [data-ft-tppct]");
          if (tPct) tPct.textContent = Math.round(tp.pct) + "%";
          const tText = document.querySelector("#floating-timer [data-ft-tptext]");
          if (tText) tText.textContent = `${App.fmtMinutes(tp.done)} of ${App.fmtMinutes(tp.est)} on this task`;
          const tLine = document.querySelector("#floating-timer [data-ft-tpline]");
          if (tLine) tLine.textContent = `${App.fmtMinutes(tp.done)} / ${App.fmtMinutes(tp.est)} on task`;
        }
      }
    } else {
      lastOvertime = null;
    }
    // page-level tick hook (study session ring etc.)
    if (App.pageTick) { try { App.pageTick(); } catch (e) { console.error(e); } }
  }, 1000);
})();
