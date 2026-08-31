/* pages/focus.js — distraction-free "just work" view.
   Hides the app chrome (see #app.focus-active CSS), shows today's priorities,
   today's plan and a big timer driven by the shared App.timer.
   Also a "distraction shield": an allow-list of sites/apps you permit yourself,
   a lock-in mode that commits you to Focus, and a counter of how many times you
   leave. (It locks THIS tracker and counts leaves — it can't force-close other
   apps; macOS gives no app a safe way to do that.) */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = App.ui;
  const D = App.dates;
  const T = App.timer;

  function todaysPriorities() {
    const today = D.today();
    const taskMap = App.taskMap();
    const open = App.state().tasks.filter((t) => !t.completed);
    const actionable = open.filter((t) => !App.isLocked(t, taskMap));
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    const score = (t) => {
      let s = 0;
      if (t.due_date && t.due_date < today) s -= 1000;            // overdue first
      else if (t.due_date === today) s -= 500;                    // due today
      if ((t.scheduled_blocks || []).some((b) => b.date === today)) s -= 200; // planned today
      s += (rank[t.priority] ?? 2) * 10;
      s += t.due_date ? D.diffDays(today, t.due_date) : 60;
      return s;
    };
    return actionable.sort((a, b) => score(a) - score(b));
  }

  function shieldHTML(f) {
    const locked = f.locked;
    const items = f.allowlist || [];
    return `
      <div class="card card-pad focus-shield ${locked ? "locked" : ""}">
        <div class="row between" style="align-items:flex-start;gap:12px">
          <div>
            <div class="section-label" style="margin-bottom:2px">${App.icon("lock")} Distraction shield</div>
            <p class="muted small" style="margin:0;max-width:46ch">${locked
              ? "Locked in. Only what's on your allow list belongs here right now — everything else can wait."
              : "List the sites and apps you actually need, then lock in. This tracker locks to Focus and counts every time you leave. It can't force-close other apps — it keeps you honest."}</p>
          </div>
          ${locked ? `
            <div class="focus-leaves">
              <div class="fl-num" data-focus-leaves>${f.leaves}</div>
              <div class="fl-label">times left</div>
            </div>` : ""}
        </div>

        <div class="allow-wrap">
          ${items.length ? items.map((a) => `
            <span class="allow-chip">${esc(a.label)}${locked ? "" : `<button class="allow-x" data-allow-del="${esc(a.id)}" title="Remove" type="button">${App.icon("x")}</button>`}</span>`).join("")
            : `<span class="muted small">No allowed sites or apps yet${locked ? "." : " — add the ones you truly need (e.g. Google Docs, Desmos)."}</span>`}
        </div>

        ${locked ? `
          <button class="btn btn-outline btn-block" data-focus-end style="margin-top:12px">${App.icon("check")} End focus session</button>
        ` : `
          <div class="row" style="gap:8px;margin-top:10px">
            <input class="input" data-allow-input placeholder="Add a site or app you allow…" style="flex:1">
            <button class="btn btn-outline" data-allow-add type="button">${App.icon("plus")} Allow</button>
          </div>
          <button class="btn btn-primary btn-block" data-focus-lock style="margin-top:10px">${App.icon("lock")} Lock in</button>
        `}
      </div>`;
  }

  App.pages.focus = {
    title: "Focus",
    render() {
      const t = App.state().timer;
      const f = App.state().focus;
      const locked = f.locked;
      const priorities = todaysPriorities();
      const plan = App.scheduledBlocksOn(D.today()).filter(({ task }) => !task.completed);
      const top = priorities[0] || null;

      const timerCard = t
        ? `
          <div class="focus-timer running">
            <div class="focus-now-label">Now focusing on</div>
            <div class="focus-now-title">${esc(t.taskTitle || "Study Session")}</div>
            <div class="focus-clock ${t.paused ? "paused" : ""}" data-focus-clock>${App.fmtClock(T.elapsedSec(t))}</div>
            <div class="focus-clock-sub">${t.paused ? "paused" : t.estimatedMinutes ? "est. " + App.fmtMinutes(t.estimatedMinutes) : "keep going"}</div>
            <div class="row" style="justify-content:center;gap:8px;margin-top:6px">
              ${t.paused
                ? `<button class="btn btn-primary" data-f-resume>${App.icon("play")} Resume</button>`
                : `<button class="btn btn-outline" data-f-pause>${App.icon("pause")} Pause</button>`}
              <button class="btn btn-outline" data-f-stop>${App.icon("square")} Stop</button>
              ${t.taskId ? `<button class="btn btn-good" data-f-finish>${App.icon("check")} Finish</button>` : ""}
            </div>
          </div>`
        : `
          <div class="focus-timer idle">
            ${top ? `
              <div class="focus-now-label">Up next</div>
              <div class="focus-now-title">${top.subject_name ? App.subjectMeta(top.subject_name).emoji + " " : ""}${esc(top.title)}</div>
              <div class="focus-clock-sub">${[esc(top.subject_name), top.due_date ? "due " + D.fmtShort(top.due_date) : "", top.estimated_minutes ? App.fmtMinutes(top.estimated_minutes) : ""].filter(Boolean).join(" · ") || "Ready when you are"}</div>
              <button class="btn btn-primary btn-lg" style="margin-top:14px" data-f-start="${esc(top.id)}">${App.icon("play")} Start focus</button>
              <div style="margin-top:10px"><button class="btn btn-ghost btn-sm" data-f-start-free>Just start a timer</button></div>
            ` : `
              <div class="focus-now-title">Nothing pressing right now</div>
              <div class="focus-clock-sub">Add a task, or just start a timer and dig into anything.</div>
              <button class="btn btn-primary btn-lg" style="margin-top:14px" data-f-start-free>${App.icon("timer")} Start a timer</button>
            `}
          </div>`;

      return `
        <div class="focus-view">
          <div class="focus-topbar">
            <div>
              <div class="focus-kicker">${locked ? "🔒 Locked in" : "Focus mode"}</div>
              <div class="focus-date">${esc(D.fmtLong(D.today()))}</div>
            </div>
            ${locked
              ? `<div class="focus-lockpill">${App.icon("lock")} <span data-focus-leaves>${f.leaves}</span> left</div>`
              : `<button class="btn btn-outline" data-f-exit>${App.icon("x")} Exit focus</button>`}
          </div>

          ${timerCard}

          ${shieldHTML(f)}

          <div class="focus-cols">
            <div class="card card-pad">
              <div class="section-label">Today’s priorities</div>
              ${priorities.length ? `
                <div class="focus-list">
                  ${priorities.slice(0, 6).map((t2) => {
                    const meta = App.subjectMeta(t2.subject_name);
                    return `
                      <div class="focus-task" style="border-left:3px solid ${t2.subject_name ? meta.color : "var(--accent)"}">
                        <div class="ft-main">
                          <div class="ft-title">${esc(t2.title)}</div>
                          <div class="ft-sub">${[esc(t2.subject_name), t2.due_date ? (App.isOverdue(t2) ? "Overdue · " : "") + D.fmtShort(t2.due_date) : "", t2.estimated_minutes ? App.fmtMinutes(t2.estimated_minutes) : ""].filter(Boolean).join(" · ")}</div>
                        </div>
                        <button class="icon-btn" data-f-start="${esc(t2.id)}" title="Start focusing on this">${App.icon("play")}</button>
                      </div>`;
                  }).join("")}
                </div>` : `<p class="muted small">You’re all caught up — nothing actionable right now.</p>`}
            </div>

            <div class="card card-pad">
              <div class="section-label">Today’s plan</div>
              ${plan.length ? `
                <div class="focus-list">
                  ${plan.map(({ task, block }) => {
                    const meta = App.subjectMeta(task.subject_name);
                    return `
                      <div class="focus-task" style="border-left:3px solid ${task.subject_name ? meta.color : "var(--accent)"}">
                        <div class="ft-time">${D.minToLabel(block.start_min)}</div>
                        <div class="ft-main"><div class="ft-title">${esc(task.title)}</div></div>
                        <button class="icon-btn" data-f-start="${esc(task.id)}" title="Start focusing on this">${App.icon("play")}</button>
                      </div>`;
                  }).join("")}
                </div>` : `<p class="muted small">Nothing scheduled today. Plan your day in the Scheduler.</p>`}
            </div>
          </div>
        </div>`;
    },

    mount(el) {
      const startTask = (id) => {
        const t = App.taskById(id);
        if (t) T.start(t.id, t.title, App.taskMinutesLeft(t));
      };
      el.querySelectorAll("[data-f-start]").forEach((b) =>
        b.addEventListener("click", () => startTask(b.dataset.fStart)));
      const free = el.querySelector("[data-f-start-free]");
      if (free) free.addEventListener("click", () => T.start("", "Focus Session", 0));

      const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.addEventListener("click", fn); };
      on("[data-f-pause]", () => T.pause());
      on("[data-f-resume]", () => T.resume());
      on("[data-f-stop]", () => T.stop(false));
      on("[data-f-finish]", () => T.stop(true));
      on("[data-f-exit]", () => App.navigate("dashboard"));

      // ----- distraction shield -----
      const allowInput = el.querySelector("[data-allow-input]");
      const addAllowed = () => {
        if (!allowInput) return;
        const v = allowInput.value.trim();
        if (!v) return;
        App.addAllowed(v);
        allowInput.value = "";
      };
      on("[data-allow-add]", addAllowed);
      if (allowInput) allowInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addAllowed(); });
      el.querySelectorAll("[data-allow-del]").forEach((b) =>
        b.addEventListener("click", () => App.removeAllowed(b.dataset.allowDel)));

      on("[data-focus-lock]", () => { App.startFocusLock(); App.toast("Locked in — go get it"); });
      on("[data-focus-end]", async () => {
        const f = App.state().focus;
        const ok = await UI.confirm({
          title: "End focus session?",
          message: f.leaves ? `You left ${f.leaves} time${f.leaves === 1 ? "" : "s"} this session. Ready to stop?` : "Ready to stop this focus session?",
          confirmLabel: "End session", danger: false,
        });
        if (ok) App.endFocusLock();
      });

      // Count every time the app loses focus during a locked session.
      // Attached once, globally; it self-gates on the locked flag so it never
      // stacks across re-renders.
      if (!App._focusLeaveHooked) {
        App._focusLeaveHooked = true;
        window.addEventListener("blur", () => {
          if (!App.state().focus.locked) return;
          App.recordFocusLeave();
          const n = App.state().focus.leaves;
          document.querySelectorAll("[data-focus-leaves]").forEach((c) => { c.textContent = n; });
        });
      }

      // live clock without a full re-render
      App.pageTick = function () {
        const t = App.state().timer;
        const node = el.querySelector("[data-focus-clock]");
        if (t && node && !t.paused) node.textContent = App.fmtClock(T.elapsedSec(t));
      };
    },
  };
})();
