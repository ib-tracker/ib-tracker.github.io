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

  /* ---------- check-ins ---------------------------------------------------
     A clock left running is the usual way bad minutes get logged: you finish,
     wander off, and the timer keeps counting. The 8-hour discard above only
     catches the extreme case, and by throwing everything away.

     So a running clock asks. 15 minutes past its target — or every hour of
     counted time when there is no target, which includes pomodoro, whose
     rounds cycle on their own — a "Still studying?" prompt appears, with an
     OS banner if the app is in the background. "Yes" sets the next check-in an
     hour on. No answer within 10 minutes pauses the clock BACK-DATED to the
     moment the check-in was due, so the unattended time never counts.

     The due moment is computed from the clock itself, not from when anything
     noticed it. That is what makes a Mac that slept, or an app that was quit,
     come out right: on the next tick or launch the clock is found long past
     its check-in and paused there, keeping the honest minutes before it. Runs
     before dropAbandoned at launch, so such a clock is paused, not discarded.

     Both clocks share this — the task timer (state.timer) and the Study
     Session (state.studySession). Their elapsed is the same shape. */
  const CHECKIN_GRACE_MIN = 15;     // past the target before the first ask
  const CHECKIN_EVERY_MIN = 60;     // untargeted clocks, and after each "yes"
  const CHECKIN_ANSWER_MIN = 10;    // how long the prompt waits

  const CLOCKS = {
    timer: {
      get: () => App.state().timer,
      target: (c) => c.estimatedMinutes || 0,
      label: (c) => c.taskTitle || "your task",
    },
    studySession: {
      get: () => App.state().studySession,
      target: (c) => (c.pomo ? 0 : c.duration || 0),
      label: () => "your study session",
    },
  };

  // Counted seconds at which this clock next asks.
  function checkinDueSec(kind, c) {
    if (c.checkinNextSec) return c.checkinNextSec;
    const target = CLOCKS[kind].target(c);
    return (target ? target + CHECKIN_GRACE_MIN : CHECKIN_EVERY_MIN) * 60;
  }
  // The wall-clock moment a running clock reached `sec` counted seconds.
  function wallAt(c, sec) {
    return c.startEpoch + (sec - (c.pausedAccumSec || 0)) * 1000;
  }

  let checkin = null;   // { kind, dueSec, handle } — the prompt on screen

  function closeCheckin() {
    if (!checkin) return;
    const h = checkin.handle;
    checkin = null;
    if (h) h.close();
  }

  // Freeze the clock as it was at `dueSec`. system: the clock must be
  // stoppable even read-only, or an expired trial would keep counting.
  function autoPause(kind, dueSec) {
    const c = CLOCKS[kind].get();
    if (!c || c.paused) return;
    const at = wallAt(c, dueSec);
    App.update((s) => {
      const x = s[kind];
      if (!x || x.paused) return;
      x.pausedAccumSec = dueSec;
      if (kind === "studySession") {
        // The per-task clock inside a session runs alongside; cut it at the
        // same moment.
        x.taskPausedAccumSec = Math.max(0, (x.taskPausedAccumSec || 0) + (at - x.taskStartEpoch) / 1000);
        if (x.pomo && x.pomo.phase === "focus") {
          const total = x.pomo.focusMin * 60;
          x.pomo.frozenRemainingSec = App.clamp(total - (at - x.pomo.phaseStartEpoch) / 1000, 0, total);
        }
      }
      x.paused = true;
      // Resuming starts a fresh hour; left at dueSec it would ask at once.
      x.checkinNextSec = dueSec + CHECKIN_EVERY_MIN * 60;
    }, { system: true });
    // Found at launch it may well be yesterday's clock, so say which day.
    const atDate = new Date(at);
    const day = App.dates.toStr(atDate);
    const when = atDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      + (day === App.dates.today() ? "" : ` on ${App.dates.fmtShort(day)}`);
    App.announce(`Paused at ${when} — no answer to the check-in, so the time since wasn't counted`,
      `${CLOCKS[kind].label(c)} was paused. Resume it if you're still going.`);
  }

  function askCheckin(kind, c, dueSec) {
    App.chime();
    App.notify("Still studying?", `${CLOCKS[kind].label(c)} is still running. No answer in ${CHECKIN_ANSWER_MIN} min and it pauses.`);
    checkin = { kind, dueSec, handle: null };
    checkin.handle = App.ui.openModal({
      title: "Still studying?",
      size: "sm",
      body: `<p class="muted" style="font-size:13px;line-height:1.5">${esc(CLOCKS[kind].label(c))} has been running a while.
        If you've stopped, pause it — the time since this appeared won't count.
        No answer in ${CHECKIN_ANSWER_MIN} minutes and it pauses itself.</p>`,
      foot: `
        <button class="btn btn-outline" data-ci-pause>${App.icon("pause")} No, pause it</button>
        <button class="btn btn-primary" data-ci-yes>${App.icon("play")} Yes, still going</button>`,
      onMount(el) {
        el.querySelector("[data-ci-yes]").addEventListener("click", () => {
          const now = CLOCKS[kind].get();
          closeCheckin();
          if (!now) return;
          const next = T.elapsedSec(now) + CHECKIN_EVERY_MIN * 60;
          App.update((s) => { if (s[kind]) s[kind].checkinNextSec = next; }, { silent: true, system: true });
        });
        el.querySelector("[data-ci-pause]").addEventListener("click", () => {
          closeCheckin();
          autoPause(kind, dueSec);
        });
      },
      // Dismissing without answering leaves it pending; the 10 minutes still run.
      onClose() { if (checkin && checkin.kind === kind) checkin.handle = null; },
    });
  }

  T.runCheckins = function () {
    for (const kind of Object.keys(CLOCKS)) {
      const c = CLOCKS[kind].get();
      if (!c || c.paused) {
        if (checkin && checkin.kind === kind) closeCheckin();
        continue;
      }
      const dueSec = checkinDueSec(kind, c);
      if (T.elapsedSec(c) < dueSec) {
        if (checkin && checkin.kind === kind) closeCheckin();   // answered elsewhere
        continue;
      }
      if (Date.now() - wallAt(c, dueSec) >= CHECKIN_ANSWER_MIN * 60000) {
        if (checkin && checkin.kind === kind) closeCheckin();
        autoPause(kind, dueSec);
      } else if (!checkin) {
        askCheckin(kind, c, dueSec);
      }
    }
  };

  /* ---------- full screen ------------------------------------------------
     The same timer, larger. Deliberately not a third timer: it reads the same
     state.timer the floating widget does, so there is one clock, one elapsed
     count and one place to stop it.

     Kept in a module variable rather than the store, so a reload never leaves
     you stuck in a full-screen view you cannot remember opening. */
  let fullscreen = false;
  let fsEntering = false;   // animate the next render only — see .ff-enter
  T.isFullscreen = () => fullscreen && !!App.state().timer;
  T.setFullscreen = function (on) {
    const was = fullscreen;
    fullscreen = !!on && !!App.state().timer;
    fsEntering = fullscreen && !was;
    TU.renderFloating();
  };

  // Escape is what everyone tries first. A dialog open on top claims it first.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented && T.isFullscreen()) T.setFullscreen(false);
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
        /* Sessions banked mid-sitting, so Cancel can take them back out
           again. Without this the sitting has no identity once a checkpoint
           has written its minutes away into the shared sessions list. */
        loggedSessionIds: [],
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

     NOT dead code, despite having no button: the full-screen controls are
     Pause, Cancel, Log & stop and Finish, and a fifth crowded them. The
     mechanism is kept whole so it can be put back behind a shortcut or a
     menu without being rebuilt — and T.cancel depends on loggedSessionIds,
     which only this writes.

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
    const sess = App.logSession({
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
      if (sess && sess.id) s.timer.loggedSessionIds = (s.timer.loggedSessionIds || []).concat([sess.id]);
      s.timer.startEpoch = Date.now();
      s.timer.pausedAccumSec = 0;
      s.timer.startISO = new Date().toISOString();
      // Re-aim at the remainder now that these minutes count towards the task.
      if (task) s.timer.estimatedMinutes = App.taskMinutesLeft(App.taskById(task.id));
    });
    App.sfx("session");
    App.toast(`${App.fmtMinutes(mins)} logged — timer still running`);
  };

  /* Throw the sitting away: nothing logged, and anything already banked
     during it taken back out.

     "Cancel" has to mean the sitting never happened, or it is just Stop with a
     worse name. So it deletes the sessions this sitting wrote as well as
     discarding the clock — a checkpoint left behind would be a sitting you
     cancelled still showing up in your totals and on the task's progress bar.

     XP and streaks are derived from the sessions list rather than stored, so
     removing the rows is enough to unwind those too. */
  T.cancel = async function () {
    const t = App.state().timer;
    if (!t) return;
    const elapsed = T.elapsedSec(t);
    const ids = t.loggedSessionIds || [];
    const banked = App.state().sessions
      .filter((x) => ids.includes(x.id))
      .reduce((n, x) => n + App.sessionMinutes(x), 0);
    const onClock = Math.round(elapsed / 60);

    const parts = [];
    if (onClock) parts.push(`${App.fmtMinutes(onClock)} on the clock`);
    if (banked) parts.push(`${App.fmtMinutes(banked)} already logged this sitting`);
    const ok = await App.ui.confirm({
      title: "Cancel this session?",
      message: parts.length
        ? `${parts.join(" and ")} will be discarded. This can't be undone.`
        : "The timer will be discarded without logging anything.",
      confirmLabel: "Discard", danger: true,
    });
    if (!ok) return;

    const written = App.update((s) => {
      if (ids.length) {
        const drop = new Set(ids);
        s.sessions = s.sessions.filter((x) => !drop.has(x.id));
      }
      s.timer = null;
    });
    if (written === false) return;   // read-only refused it; don't claim otherwise
    T.setFullscreen(false);
    App.toast("Session cancelled — nothing logged");
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
      const enter = fsEntering;
      fsEntering = false;
      root.innerHTML = `
        <div class="ftimer-full ${enter ? "ff-enter" : ""} ${overtime ? "overtime" : ""}" role="dialog" aria-label="Timer">
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
            <button class="btn btn-outline btn-lg" data-ft-cancel
                    title="Discard this session without logging it">${App.icon("x")} Cancel</button>
            <button class="btn btn-outline btn-lg" data-ft-stop>${App.icon("square")} Log &amp; stop</button>
            ${t.taskId ? `<button class="btn btn-good btn-lg" data-ft-finish>${App.icon("check")} Finish</button>` : ""}
          </div>
        </div>`;
      const qf = (sel) => root.querySelector(sel);
      qf("[data-ft-exit]").addEventListener("click", () => T.setFullscreen(false));
      if (qf("[data-ft-pause]")) qf("[data-ft-pause]").addEventListener("click", () => T.pause());
      if (qf("[data-ft-resume]")) qf("[data-ft-resume]").addEventListener("click", () => T.resume());
      if (qf("[data-ft-cancel]")) qf("[data-ft-cancel]").addEventListener("click", () => T.cancel());
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
          <button class="btn btn-outline btn-sm" data-ft-cancel
                  title="Discard this session without logging it" aria-label="Cancel session">${App.icon("x")}</button>
          <button class="btn btn-outline btn-sm" data-ft-stop>${App.icon("square")} Log &amp; stop</button>
          ${t.taskId ? `<button class="btn btn-good btn-sm" data-ft-finish>${App.icon("check")} Finish</button>` : ""}
        </div>
      </div>`;

    const q = (sel) => root.querySelector(sel);
    if (q("[data-ft-min]")) q("[data-ft-min]").addEventListener("click", () => T.toggleMinimize());
    if (q("[data-ft-full]")) q("[data-ft-full]").addEventListener("click", () => T.setFullscreen(true));
    if (q("[data-ft-pause]")) q("[data-ft-pause]").addEventListener("click", () => T.pause());
    if (q("[data-ft-resume]")) q("[data-ft-resume]").addEventListener("click", () => T.resume());
    if (q("[data-ft-cancel]")) q("[data-ft-cancel]").addEventListener("click", () => T.cancel());
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
    try { T.runCheckins(); } catch (e) { console.error(e); }
    // page-level tick hook (study session ring etc.)
    if (App.pageTick) { try { App.pageTick(); } catch (e) { console.error(e); } }
  }, 1000);
})();
