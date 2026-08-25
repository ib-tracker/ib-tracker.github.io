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
      start_time: t.startISO,
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

  T.toggleMinimize = function () {
    App.update((s) => { if (s.timer) s.timer.minimized = !s.timer.minimized; });
  };

  /* ---------- floating widget ---------- */
  TU.renderFloating = function () {
    const root = document.getElementById("floating-timer");
    if (!root) return;
    const t = App.state().timer;
    if (!t) { root.innerHTML = ""; return; }

    const elapsed = T.elapsedSec(t);
    const estSec = (t.estimatedMinutes || 0) * 60;
    const overtime = estSec > 0 && elapsed > estSec;

    if (fullscreen) {
      const display = estSec > 0 && !overtime ? App.fmtClock(estSec - elapsed) : App.fmtClock(elapsed);
      const pct = estSec > 0 ? App.clamp((elapsed / estSec) * 100, 0, 100) : 0;
      root.innerHTML = `
        <div class="ftimer-full ${overtime ? "overtime" : ""}" role="dialog" aria-label="Timer">
          <button class="icon-btn ftimer-exit" data-ft-exit title="Exit full screen (Esc)" aria-label="Exit full screen">${App.icon("minimize")}</button>
          <div class="ff-task">${esc(t.taskTitle || "Study Session")}</div>
          <div class="ff-clock" data-ft-time>${overtime ? "+" : ""}${display}</div>
          <div class="ff-sub">${overtime ? "over your estimate" : estSec > 0 ? `of ${App.fmtMinutes(t.estimatedMinutes)}` : "elapsed"}</div>
          ${estSec > 0 ? `<div class="ff-bar"><span data-ft-bar style="width:${pct}%"></span></div>` : ""}
          <div class="ff-controls">
            ${t.paused
              ? `<button class="btn btn-primary btn-lg" data-ft-resume>${App.icon("play")} Resume</button>`
              : `<button class="btn btn-outline btn-lg" data-ft-pause>${App.icon("pause")} Pause</button>`}
            <button class="btn btn-outline btn-lg" data-ft-stop>${App.icon("square")} Stop</button>
            ${t.taskId ? `<button class="btn btn-good btn-lg" data-ft-finish>${App.icon("check")} Finish</button>` : ""}
          </div>
        </div>`;
      const qf = (sel) => root.querySelector(sel);
      qf("[data-ft-exit]").addEventListener("click", () => T.setFullscreen(false));
      if (qf("[data-ft-pause]")) qf("[data-ft-pause]").addEventListener("click", () => T.pause());
      if (qf("[data-ft-resume]")) qf("[data-ft-resume]").addEventListener("click", () => T.resume());
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

    const display = estSec > 0 && !overtime ? App.fmtClock(estSec - elapsed) : App.fmtClock(elapsed);
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
            ? `<div class="ot-label">Overtime</div>`
            : estSec > 0 ? `<div class="est">est. ${App.fmtMinutes(t.estimatedMinutes)}</div>` : ""}
        </div>
        <div class="ftimer-controls">
          ${t.paused
            ? `<button class="btn btn-primary btn-sm" data-ft-resume>${App.icon("play")} Resume</button>`
            : `<button class="btn btn-outline btn-sm" data-ft-pause>${App.icon("pause")} Pause</button>`}
          <button class="btn btn-outline btn-sm" data-ft-stop>${App.icon("square")} Stop</button>
          ${t.taskId ? `<button class="btn btn-good btn-sm" data-ft-finish>${App.icon("check")} Finish</button>` : ""}
        </div>
      </div>`;

    const q = (sel) => root.querySelector(sel);
    if (q("[data-ft-min]")) q("[data-ft-min]").addEventListener("click", () => T.toggleMinimize());
    if (q("[data-ft-full]")) q("[data-ft-full]").addEventListener("click", () => T.setFullscreen(true));
    if (q("[data-ft-pause]")) q("[data-ft-pause]").addEventListener("click", () => T.pause());
    if (q("[data-ft-resume]")) q("[data-ft-resume]").addEventListener("click", () => T.resume());
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
        if (node) {
          const display = estSec > 0 && !overtime ? App.fmtClock(estSec - elapsed) : App.fmtClock(elapsed);
          node.textContent = (overtime ? "+" : "") + display;
        }
        // The full-screen view has a progress bar the small one doesn't.
        const bar = document.querySelector("#floating-timer [data-ft-bar]");
        if (bar && estSec > 0) bar.style.width = App.clamp((elapsed / estSec) * 100, 0, 100) + "%";
      }
    } else {
      lastOvertime = null;
    }
    // page-level tick hook (study session ring etc.)
    if (App.pageTick) { try { App.pageTick(); } catch (e) { console.error(e); } }
  }, 1000);
})();
