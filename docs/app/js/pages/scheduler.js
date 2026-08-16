/* pages/scheduler.js — weekly/monthly planner with drag & drop,
   busy blocks, date-range blockouts and the auto-scheduler */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = App.ui;
  const D = App.dates;

  let viewMode = "week"; // 'week' | 'month'
  let weekStart = D.mondayOf(D.today());
  let monthAnchor = D.today().slice(0, 7) + "-01";
  let selectedTaskId = null;
  let drag = null; // {taskId, blockId?, duration}

  const SLOT_H = 46;

  function weekDates() {
    const out = [];
    for (let i = 0; i < 7; i++) out.push(D.addDays(weekStart, i));
    return out;
  }
  function monthDates() {
    const anchor = D.parse(monthAnchor);
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
    const gridStart = new Date(y, m, 1 - firstDow);
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      out.push(D.toStr(d));
    }
    return out;
  }

  function unscheduledTasks() {
    return App.sortedTasks().filter((t) => !t.completed && !(t.scheduled_blocks || []).length);
  }

  function capacityStats(dates) {
    const s = App.state().settings;
    let scheduled = 0, available = 0;
    const dateSet = new Set(dates);
    for (const t of App.state().tasks) {
      if (App.isArchived(t)) continue;
      for (const b of t.scheduled_blocks || []) {
        if (dateSet.has(b.date)) scheduled += b.duration;
      }
    }
    for (const ds of dates) {
      const dayName = App.DAY_KEYS[(D.dayOfWeek(ds) + 6) % 7];
      available += (s.hours_per_day[dayName] || 0) * 60;
    }
    return { scheduled, available };
  }

  /* ---------- modals ---------- */
  const DOW_LABELS = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 0]];
  const REPEAT_PRESETS = [["Every day", [0, 1, 2, 3, 4, 5, 6]], ["Weekdays", [1, 2, 3, 4, 5]], ["Weekends", [0, 6]]];

  const minToTimeValue = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const timeValueToMin = (t) => { const [h, m] = String(t).split(":").map(Number); return (h || 0) * 60 + (m || 0); };

  // Add / edit a busy block. A block is either a one-off on a date or a weekly
  // repeat on any set of days; either way it can carry a commute on each side.
  function openBusyBlockModal(defaultDate, existing) {
    const b = existing || null;
    const repeats = b ? b.kind === "weekly" : false;
    const days = b && b.kind === "weekly" ? App.busyDays(b) : [D.dayOfWeek(defaultDate || D.today())];
    const daySet = new Set(days);
    const travel = b ? App.busyTravel(b) : { before: 0, after: 0 };
    const startMin = b ? b.start_min : 16 * 60;
    const endMin = b ? b.end_min : 17 * 60;

    UI.openModal({
      title: b ? "Edit busy block" : "Add busy block",
      body: `
        <div class="form-row">
          <div class="field"><label>Title</label>
            <input class="input" name="title" value="${esc(b ? b.title : "")}" placeholder="e.g. School, Football practice"></div>
          <div class="field"><label>Category</label>
            ${UI.selectHTML("category", [["personal","Personal"],["class","Class"],["commute","Commute"],["other","Other"]], (b && b.category) || "personal")}
          </div>
        </div>

        <div class="form-row">
          <div class="field"><label>Start time</label><input class="input" type="time" name="start" value="${minToTimeValue(startMin)}"></div>
          <div class="field"><label>End time</label><input class="input" type="time" name="end" value="${minToTimeValue(endMin)}"></div>
        </div>

        <div class="field">
          <label>Repeat</label>
          <div class="seg-toggle mb-2" data-repeat-toggle>
            <button type="button" class="${repeats ? "" : "active"}" data-repeat="once">Just once</button>
            <button type="button" class="${repeats ? "active" : ""}" data-repeat="weekly">Every week</button>
          </div>

          <div data-once-fields ${repeats ? "hidden" : ""}>
            <input class="input" type="date" name="date" value="${esc(b && b.kind !== "weekly" ? b.date : (defaultDate || D.today()))}">
          </div>

          <div data-weekly-fields ${repeats ? "" : "hidden"}>
            <div class="day-chips" data-day-chips>
              ${DOW_LABELS.map(([label, d]) => `
                <button type="button" class="day-chip ${daySet.has(d) ? "on" : ""}" data-day="${d}">${label}</button>`).join("")}
            </div>
            <div class="row wrap mt-2" style="gap:6px">
              ${REPEAT_PRESETS.map(([label, set]) => `
                <button type="button" class="btn btn-ghost btn-sm" data-preset="${set.join(",")}">${label}</button>`).join("")}
            </div>
            <div class="form-row mt-2">
              <div class="field"><label>Starts <span class="lbl-opt">optional</span></label>
                <input class="input" type="date" name="from" value="${esc((b && b.from) || "")}"></div>
              <div class="field"><label>Until <span class="lbl-opt">blank = forever</span></label>
                <input class="input" type="date" name="until" value="${esc((b && b.until) || "")}"></div>
            </div>
          </div>
        </div>

        <div class="field">
          <label>Travel time <span class="lbl-opt">the commute either side</span></label>
          <div class="row" style="gap:8px;align-items:center">
            <input class="input" type="number" min="0" max="240" step="5" name="travel_before" value="${travel.before || ""}" placeholder="0" style="width:76px" aria-label="Travel minutes before">
            <span class="small muted">min before</span>
            <input class="input" type="number" min="0" max="240" step="5" name="travel_after" value="${travel.after || ""}" placeholder="0" style="width:76px" aria-label="Travel minutes after">
            <span class="small muted">min after</span>
          </div>
          <p class="hint" data-span-preview></p>
        </div>`,
      footSplit: !!b,
      foot: `${b ? `<button class="btn btn-danger-ghost" data-remove>${App.icon("trash")} Delete</button>` : ""}
             <div class="row" style="gap:8px">
               <button class="btn btn-outline" data-close>Cancel</button>
               <button class="btn btn-primary" data-save>${b ? "Save" : "Add block"}</button>
             </div>`,
      onMount(el, handle) {
        let mode = repeats ? "weekly" : "once";
        const selected = new Set(days);
        const chipsWrap = el.querySelector("[data-day-chips]");
        const preview = el.querySelector("[data-span-preview]");

        const renderChips = () => chipsWrap.querySelectorAll("[data-day]").forEach((c) =>
          c.classList.toggle("on", selected.has(Number(c.dataset.day))));

        // "8:00 AM – 3:30 PM · 7:15 AM – 4:15 PM with travel"
        const renderPreview = () => {
          const f = UI.readForm(el);
          const s = timeValueToMin(f.start), e = timeValueToMin(f.end);
          const tb = App.clamp(Number(f.travel_before) || 0, 0, 240);
          const ta = App.clamp(Number(f.travel_after) || 0, 0, 240);
          if (e <= s) { preview.textContent = ""; return; }
          preview.textContent = (tb || ta)
            ? `${D.minToLabel(s)} – ${D.minToLabel(e)} · blocks ${D.minToLabel(App.clamp(s - tb, 0, 1440))} – ${D.minToLabel(App.clamp(e + ta, 0, 1440))} with travel`
            : `${D.minToLabel(s)} – ${D.minToLabel(e)}`;
        };

        el.querySelectorAll("[data-repeat]").forEach((btn) =>
          btn.addEventListener("click", () => {
            mode = btn.dataset.repeat;
            el.querySelectorAll("[data-repeat]").forEach((x) => x.classList.toggle("active", x === btn));
            el.querySelector("[data-once-fields]").hidden = mode !== "once";
            el.querySelector("[data-weekly-fields]").hidden = mode !== "weekly";
          }));

        chipsWrap.querySelectorAll("[data-day]").forEach((c) =>
          c.addEventListener("click", () => {
            const d = Number(c.dataset.day);
            if (selected.has(d)) selected.delete(d); else selected.add(d);
            renderChips();
          }));

        el.querySelectorAll("[data-preset]").forEach((btn) =>
          btn.addEventListener("click", () => {
            selected.clear();
            btn.dataset.preset.split(",").forEach((d) => selected.add(Number(d)));
            renderChips();
          }));

        el.querySelectorAll("input").forEach((i) => i.addEventListener("input", renderPreview));
        renderPreview();

        el.querySelector("[data-save]").addEventListener("click", () => {
          const f = UI.readForm(el);
          if (!String(f.title || "").trim()) { App.toast("Give the block a title", "error"); return; }
          if (!f.start || !f.end) { App.toast("Start and end times are required", "error"); return; }
          const s = timeValueToMin(f.start), e = timeValueToMin(f.end);
          if (e <= s) { App.toast("End time must be after start time", "error"); return; }
          if (mode === "weekly" && !selected.size) { App.toast("Pick at least one day", "error"); return; }
          if (mode === "once" && !f.date) { App.toast("Pick a date", "error"); return; }
          if (mode === "weekly" && f.from && f.until && f.until < f.from) {
            App.toast("“Until” must be after “Starts”", "error"); return;
          }

          const payload = {
            title: f.title.trim(),
            category: f.category,
            start_min: s,
            end_min: e,
            travel_before: App.clamp(Math.round(Number(f.travel_before) || 0), 0, 240),
            travel_after: App.clamp(Math.round(Number(f.travel_after) || 0), 0, 240),
          };
          if (mode === "weekly") {
            Object.assign(payload, {
              kind: "weekly",
              days: [...selected].sort((x, y) => x - y),
              from: f.from || "",
              until: f.until || "",
              date: undefined,
            });
          } else {
            Object.assign(payload, { kind: "time", date: f.date, days: undefined, from: undefined, until: undefined });
          }

          if (b) { App.updateBusyBlock(b.id, payload); App.toast("Busy block updated"); }
          else { App.createBusyBlock(payload); App.toast("Busy block added"); }
          handle.close();
        });

        const remove = el.querySelector("[data-remove]");
        if (remove) remove.addEventListener("click", () => {
          App.deleteBusyBlock(b.id);
          App.toast("Busy block deleted");
          handle.close();
        });
      },
    });
  }

  function openDateRangeModal() {
    const today = D.today();
    UI.openModal({
      title: "Block Out Days",
      body: `
        <div class="field"><label>Title</label><input class="input" name="title" placeholder="e.g. Vacation, Mock exams, Travel"></div>
        <div class="form-row">
          <div class="field"><label>Start date</label><input class="input" type="date" name="start" value="${today}"></div>
          <div class="field"><label>End date</label><input class="input" type="date" name="end" value="${today}"></div>
        </div>
        <div class="field"><label>Category</label>
          ${UI.selectHTML("category", [["personal","Personal"],["class","Class"],["commute","Commute"],["other","Other"]], "personal")}
        </div>
        <p class="muted small" data-day-count></p>`,
      foot: `<button class="btn btn-outline" data-close>Cancel</button>
             <button class="btn btn-primary" data-save>Block Out</button>`,
      onMount(el, handle) {
        const upd = () => {
          const f = UI.readForm(el);
          const n = f.start && f.end && f.end >= f.start ? D.diffDays(f.start, f.end) + 1 : 0;
          el.querySelector("[data-day-count]").textContent =
            n > 0 ? `Blocking ${n} day${n > 1 ? "s" : ""} — nothing will be auto-scheduled during this period.` : "";
        };
        el.querySelectorAll("input[type=date]").forEach((i) => i.addEventListener("change", upd));
        upd();
        el.querySelector("[data-save]").addEventListener("click", () => {
          const f = UI.readForm(el);
          if (!String(f.title || "").trim() || !f.start || !f.end) { App.toast("Title and dates are required", "error"); return; }
          if (f.end < f.start) { App.toast("End date must be on or after the start date", "error"); return; }
          App.createBusyBlock({ title: f.title.trim(), category: f.category, kind: "range", start_date: f.start, end_date: f.end });
          App.toast("Days blocked out");
          handle.close();
        });
      },
    });
  }

  function openAutoScheduleModal() {
    const count = unscheduledTasks().length;
    UI.openModal({
      title: "Auto-Schedule",
      body: `
        <div data-as-config>
          <p class="muted small mb-3">${count} unscheduled task${count === 1 ? "" : "s"} will be arranged across this week, respecting busy blocks, work hours, daily capacity and task predecessors.</p>
          <div class="form-row">
            <div class="field">
              <label>Max focus session (min)</label>
              <input class="input" type="number" name="maxSession" min="15" step="15" value="90">
              <p class="hint">Longer tasks get split into multiple sessions.</p>
            </div>
            <div class="field">
              <label>Break between sessions (min)</label>
              <input class="input" type="number" name="breakMinutes" min="5" step="5" value="15">
            </div>
          </div>
          <label class="check-row"><input type="checkbox" name="includeBreaks" checked> Leave breaks between split sessions</label>
        </div>
        <div data-as-result hidden></div>`,
      foot: `<button class="btn btn-outline" data-close>Cancel</button>
             <button class="btn btn-primary" data-run ${count === 0 ? "disabled" : ""}>${App.icon("zap")} Run Auto-Schedule</button>`,
      onMount(el, handle) {
        el.querySelector("[data-run]").addEventListener("click", () => {
          const f = UI.readForm(el);
          const res = App.autoSchedule({
            weekStart,
            maxSession: Number(f.maxSession) || 90,
            breakMinutes: Number(f.breakMinutes) || 15,
            includeBreaks: !!f.includeBreaks,
          });
          el.querySelector("[data-as-config]").hidden = true;
          el.querySelector("[data-run]").style.display = "none";
          const cancelBtn = el.querySelector(".modal-foot [data-close]");
          if (cancelBtn) cancelBtn.textContent = "Close";
          const resEl = el.querySelector("[data-as-result]");
          resEl.hidden = false;
          resEl.innerHTML = autoScheduleResultHTML(res);
          resEl.querySelector("[data-close]").addEventListener("click", () => handle.close());
        });
      },
    });
  }

  // clean, day-grouped summary of what Auto-Schedule just did
  function autoScheduleResultHTML(res) {
    const placed = res.placed || [];
    const sessions = [];
    let totalMin = 0;
    for (const p of placed) {
      const meta = p.subject_name ? App.subjectMeta(p.subject_name) : null;
      for (const b of p.blocks) {
        sessions.push({ date: b.date, start_min: b.start_min, duration: b.duration, title: p.title, meta });
        totalMin += b.duration;
      }
    }
    sessions.sort((a, b) => a.date.localeCompare(b.date) || (a.start_min - b.start_min));
    const byDay = new Map();
    for (const s2 of sessions) {
      if (!byDay.has(s2.date)) byDay.set(s2.date, []);
      byDay.get(s2.date).push(s2);
    }

    const ok = res.scheduled_count > 0;
    const hero = ok ? `
      <div class="as-hero">
        <div class="as-hero-icon">${App.icon("checkCircle")}</div>
        <div class="as-hero-count">${res.scheduled_count} task${res.scheduled_count === 1 ? "" : "s"} scheduled</div>
        <div class="as-hero-sub">${sessions.length} session${sessions.length === 1 ? "" : "s"} · ${App.fmtMinutes(totalMin)} planned · ${byDay.size} day${byDay.size === 1 ? "" : "s"}</div>
      </div>` : `
      <div class="as-hero none">
        <div class="as-hero-icon">${App.icon("alertCircle")}</div>
        <div class="as-hero-count">Nothing could be scheduled</div>
        <div class="as-hero-sub">The reasons are listed below — freeing up busy blocks or raising daily hours usually helps</div>
      </div>`;

    const dayList = ok ? `
      <div class="as-days">
        ${[...byDay.entries()].map(([date, items]) => `
          <div class="as-day">
            <div class="as-day-head">
              <span>${D.fmtLong(date)}</span>
              <span class="muted">${App.fmtMinutes(items.reduce((s2, x) => s2 + x.duration, 0))}</span>
            </div>
            ${items.map((s2) => `
              <div class="as-session" style="${s2.meta ? `border-left-color:${s2.meta.color}` : ""}">
                <span class="as-time">${D.minToLabel(s2.start_min)}</span>
                <span class="as-title">${s2.meta && s2.meta.emoji ? s2.meta.emoji + " " : ""}${esc(s2.title)}</span>
                <span class="as-dur">${App.fmtMinutes(s2.duration)}</span>
              </div>`).join("")}
          </div>`).join("")}
      </div>` : "";

    const issues = res.error_count ? `
      <div class="as-issues">
        <div class="as-issues-head">${App.icon("alertCircle")} ${res.error_count} couldn't be placed</div>
        ${res.errors.map((e) => `
          <div class="as-issue"><strong>${esc(e.title)}</strong><span>${esc(e.reason)}</span></div>`).join("")}
      </div>` : "";

    return `${hero}${dayList}${issues}
      <button class="btn btn-primary btn-block mt-4" data-close>Done</button>`;
  }

  function openEditBlockModal(task, block) {
    const s = App.state().settings;
    const startHour = s.work_start_hour || 8, endHour = s.work_end_hour || 22;
    const timeOpts = [];
    for (let m = startHour * 60; m < endHour * 60; m += 30) timeOpts.push([String(m), D.minToLabel(m)]);
    const blocks = task.scheduled_blocks || [];
    UI.openModal({
      title: "Edit Scheduled Session",
      body: `
        <p style="font-weight:600;font-size:13.5px" class="mb-3">${esc(task.title)}</p>
        ${blocks.length > 1 ? `<p class="muted small mb-3">This task has ${blocks.length} scheduled sessions — you're editing the one you clicked.</p>` : ""}
        <div class="field"><label>Date</label><input class="input" type="date" name="date" value="${esc(block.date)}"></div>
        <div class="form-row">
          <div class="field"><label>Start time</label>${UI.selectHTML("start", timeOpts, String(block.start_min))}</div>
          <div class="field"><label>Duration (min)</label><input class="input" type="number" name="duration" min="15" step="15" value="${block.duration}"></div>
        </div>`,
      footSplit: true,
      foot: `
        <button class="btn btn-danger-ghost" data-unsched>${App.icon("calendarX")} Unschedule</button>
        <span class="grp">
          <button class="btn btn-outline" data-close>Cancel</button>
          <button class="btn btn-primary" data-save>Save</button>
        </span>`,
      onMount(el, handle) {
        el.querySelector("[data-unsched]").addEventListener("click", () => {
          App.removeScheduledBlock(task.id, block.id);
          App.toast("Session unscheduled");
          handle.close();
        });
        el.querySelector("[data-save]").addEventListener("click", () => {
          const f = UI.readForm(el);
          if (!f.date) { App.toast("Pick a date", "error"); return; }
          const res = App.scheduleTaskAt(task.id, f.date, Number(f.start), {
            duration: Number(f.duration) || 30, moveBlockId: block.id,
          });
          if (!res.ok) { App.toast(res.reason, "error"); return; }
          App.toast("Session updated");
          handle.close();
        });
      },
    });
  }

  /* ---------- drop handling ---------- */
  function dropOn(dateStr, minute) {
    if (!drag) return;
    const res = App.scheduleTaskAt(drag.taskId, dateStr, minute, drag.blockId ? { moveBlockId: drag.blockId, duration: drag.duration } : {});
    if (!res.ok) App.toast(res.reason, "error");
    drag = null;
    selectedTaskId = null;
  }
  function clickSlot(dateStr, minute) {
    if (!selectedTaskId) return;
    const res = App.scheduleTaskAt(selectedTaskId, dateStr, minute, {});
    if (!res.ok) { App.toast(res.reason, "error"); return; }
    selectedTaskId = null;
    App.toast("Task scheduled");
  }

  /* ---------- week view ---------- */
  function weekViewHTML() {
    const s = App.state().settings;
    const startHour = s.work_start_hour || 8, endHour = s.work_end_hour || 22;
    const hours = [];
    for (let h = startHour; h < endHour; h++) hours.push(h);
    const dates = weekDates();
    const todayStr = D.today();
    const dayMax = (endHour - startHour) * 60;

    const colHTML = (ds) => {
      const items = [];
      for (const { task, block } of App.scheduledBlocksOn(ds)) {
        items.push({ type: "task", task, block, start: block.start_min, end: block.start_min + block.duration });
      }
      for (const seg of App.busyOnDate(ds)) {
        items.push({ type: "busy", block: seg.block, start: seg.start_min, end: seg.end_min, seg });
      }
      const rel = (m) => ((m - startHour * 60) / 60) * SLOT_H;

      return `
        <div class="week-day-col" data-day="${ds}" style="height:${hours.length * SLOT_H}px">
          ${hours.map((h) => `
            <div class="week-slot ${selectedTaskId ? "droppable" : ""}" data-slot="${h * 60}" style="height:${SLOT_H}px"></div>`).join("")}
          ${items.map((it) => {
            const top = Math.max(0, rel(it.start));
            const height = Math.max(15, Math.min(rel(it.end), dayMax / 60 * SLOT_H) - top);
            if (it.type === "busy") {
              const seg = it.seg;
              const repeat = App.busyRepeatLabel(it.block);
              // Travel is drawn as hatched bands inside the block. Measure them
              // in px off the same scale as the block itself — a block that
              // starts before the visible work window is clipped, so a % of the
              // drawn height would put the band in the wrong place.
              const bandTop = App.clamp(rel(seg.core_start) - top, 0, height);
              const bandBottom = App.clamp((top + height) - rel(seg.core_end), 0, height);
              const tip = [
                it.block.title,
                `${D.minToLabel(seg.core_start)} – ${D.minToLabel(seg.core_end)}`,
                (seg.travel_before || seg.travel_after)
                  ? `+ travel (${D.minToLabel(seg.start_min)} – ${D.minToLabel(seg.end_min)})` : "",
                repeat,
              ].filter(Boolean).join(" · ");
              return `
                <div class="week-item busy" style="top:${top}px;height:${height}px" title="${esc(tip)}"
                  data-edit-busy="${esc(it.block.id)}" role="button" tabindex="0">
                  ${bandTop > 0.5 ? `<span class="wi-travel top" style="height:${bandTop}px"></span>` : ""}
                  ${bandBottom > 0.5 ? `<span class="wi-travel bottom" style="height:${bandBottom}px"></span>` : ""}
                  <span class="wi-title"${bandTop > 4 && height - bandTop > 18 ? ` style="margin-top:${bandTop - 2}px"` : ""}>${esc(it.block.title)}</span>
                  <button class="wi-x" data-del-busy="${esc(it.block.id)}" title="Delete busy block">${App.icon("x")}</button>
                </div>`;
            }
            const meta = it.task.subject_name ? App.subjectMeta(it.task.subject_name) : null;
            const tint = meta && !it.task.completed
              ? `border-left-color:${meta.color};background:color-mix(in srgb, ${meta.color} 14%, var(--surface));color:color-mix(in srgb, ${meta.color} 58%, var(--ink) 42%)`
              : "";
            return `
              <div class="week-item task ${it.task.completed ? "done" : ""}" draggable="true"
                data-sched-task="${esc(it.task.id)}" data-sched-block="${esc(it.block.id)}"
                style="top:${top}px;height:${height}px;${tint}" title="${esc(it.task.title)}">
                <span class="wi-title">${meta && meta.emoji ? meta.emoji + " " : ""}${esc(it.task.title)}</span>
                ${height > 30 ? `<span class="wi-dur">${App.fmtMinutes(it.block.duration)}</span>` : ""}
                <button class="wi-x" data-unsched-block title="Unschedule">${App.icon("x")}</button>
              </div>`;
          }).join("")}
        </div>`;
    };

    return `
      <div class="card week-grid">
        <div class="week-head">
          <div class="gutter"></div>
          ${dates.map((ds, i) => `
            <div class="wh-day">
              <div class="wh-dow">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i]}</div>
              <div class="wh-num ${ds === todayStr ? "today" : ""}">${D.parse(ds).getDate()}</div>
            </div>`).join("")}
        </div>
        <div class="week-body">
          <div class="week-gutter">
            ${hours.map((h) => `<div class="g-hour" style="height:${SLOT_H}px"><span>${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}</span></div>`).join("")}
          </div>
          ${dates.map(colHTML).join("")}
        </div>
      </div>`;
  }

  /* ---------- month view ---------- */
  function monthViewHTML() {
    const dates = monthDates();
    const anchorMonth = D.parse(monthAnchor).getMonth();
    const todayStr = D.today();
    return `
      <div class="card" style="overflow:hidden">
        <div class="month-grid" style="border-bottom:1px solid var(--grid)">
          ${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => `
            <div class="cal-dow" style="padding:8px 0">${d}</div>`).join("")}
        </div>
        <div class="month-grid">
          ${dates.map((ds) => {
            const inMonth = D.parse(ds).getMonth() === anchorMonth;
            const dayTasks = App.scheduledBlocksOn(ds);
            const busy = App.busyOnDate(ds);
            // count what actually got left out, per list — a day can hold more
            // busy blocks than tasks (or the other way round)
            const busyShown = busy.slice(0, 1);
            const tasksShown = dayTasks.slice(0, 2);
            const extra = (busy.length - busyShown.length) + (dayTasks.length - tasksShown.length);
            return `
              <div class="month-cell ${inMonth ? "" : "other"} ${selectedTaskId ? "droppable" : ""}" data-mday="${ds}">
                <span class="m-num ${ds === todayStr ? "today" : ""}">${D.parse(ds).getDate()}</span>
                ${busyShown.map((seg) => {
                  const times = `${D.minToLabel(seg.core_start)} – ${D.minToLabel(seg.core_end)}`;
                  const withTravel = (seg.travel_before || seg.travel_after)
                    ? ` (${D.minToLabel(seg.start_min)} – ${D.minToLabel(seg.end_min)} with travel)` : "";
                  return `
                  <span class="month-pill busy" title="${esc(seg.block.title + " · " + times + withTravel)}">${esc(seg.block.title)}</span>`;
                }).join("")}
                ${tasksShown.map(({ task, block }) => {
                  const meta = task.subject_name ? App.subjectMeta(task.subject_name) : null;
                  const tint = meta && !task.completed
                    ? `background:color-mix(in srgb, ${meta.color} 15%, var(--surface));color:color-mix(in srgb, ${meta.color} 58%, var(--ink) 42%);border-left:3px solid ${meta.color}`
                    : "";
                  return `
                  <span class="month-pill task ${task.completed ? "done" : ""}" draggable="true"
                    data-sched-task="${esc(task.id)}" data-sched-block="${esc(block.id)}"
                    style="${tint}" title="${esc(task.title)}">${meta && meta.emoji ? meta.emoji + " " : ""}${esc(task.title)}</span>`;
                }).join("")}
                ${extra > 0 ? `<span class="month-more">+${extra} more</span>` : ""}
              </div>`;
          }).join("")}
        </div>
      </div>`;
  }

  /* ---------- page ---------- */
  App.pages.scheduler = {
    title: "Scheduler",
    // always open on the current week/month when navigating in
    onEnter() {
      weekStart = D.mondayOf(D.today());
      monthAnchor = D.today().slice(0, 7) + "-01";
    },
    render() {
      const dates = viewMode === "week" ? weekDates() : monthDates();
      const { scheduled, available } = capacityStats(dates);
      const ratio = available > 0 ? scheduled / available : 0;
      const capColor = ratio < 0.8 ? "var(--good)" : ratio < 1 ? "var(--warning)" : "var(--danger)";
      const unsched = unscheduledTasks();
      const anyScheduled = App.state().tasks.some((t) => !App.isArchived(t) && (t.scheduled_blocks || []).length);
      const label = viewMode === "week"
        ? `${D.fmtShort(weekStart)} – ${D.fmtShort(D.addDays(weekStart, 6))}`
        : D.fmtMonthYear(monthAnchor);

      return `
        <div class="page wide">
          ${UI.pageHead("Scheduler", "Drag a task onto the calendar — or click a task, then a slot", `
            <div class="seg-toggle">
              <button class="${viewMode === "week" ? "active" : ""}" data-mode="week">Week</button>
              <button class="${viewMode === "month" ? "active" : ""}" data-mode="month">Month</button>
            </div>
            <div class="row" style="gap:6px">
              <button class="icon-btn" data-nav-prev>${App.icon("chevL")}</button>
              <span style="font-size:13px;font-weight:600;min-width:130px;text-align:center">${label}</span>
              <button class="icon-btn" data-nav-next>${App.icon("chevR")}</button>
              <button class="btn btn-ghost btn-sm" data-nav-today>Today</button>
            </div>`)}

          <div class="card card-pad mb-4" style="padding:14px 18px">
            <div class="row between wrap">
              <div class="capacity-bar">
                <span style="font-size:13px;font-weight:600">Workload</span>
                <div class="capacity-track"><span style="width:${Math.min(100, ratio * 100)}%;background:${capColor}"></span></div>
                <span class="muted small">${App.fmtMinutes(scheduled)} / ${App.fmtMinutes(available)}</span>
              </div>
              <div class="row wrap" style="gap:8px">
                <button class="btn btn-outline btn-sm" data-block-days>${App.icon("calendarX")} Block Out Days</button>
                <button class="btn btn-outline btn-sm" data-add-busy>${App.icon("clock")} Add Busy Block</button>
                ${anyScheduled ? `<button class="btn btn-danger-ghost btn-sm" data-clear-all>${App.icon("trash")} Clear All</button>` : ""}
                ${viewMode === "week" ? `<button class="btn btn-primary btn-sm" data-auto>${App.icon("zap")} Auto-Schedule</button>` : ""}
              </div>
            </div>
          </div>

          <div class="sched-layout">
            <div>
              <div class="section-label">Unscheduled <span class="count">· ${unsched.length}</span></div>
              <div class="unsched-list">
                ${unsched.map((t) => {
                  const meta = t.subject_name ? App.subjectMeta(t.subject_name) : null;
                  return `
                  <div class="unsched-card ${selectedTaskId === t.id ? "selected" : ""}" draggable="true" data-unsched-task="${esc(t.id)}"
                    style="${meta ? `border-left:3px solid ${meta.color}` : ""}">
                    <div class="u-title">${meta && meta.emoji ? meta.emoji + " " : ""}${esc(t.title)}</div>
                    <div class="u-meta">
                      ${UI.priorityChip(t.priority)}
                      ${t.estimated_minutes ? `<span class="t-mins">${App.fmtMinutes(t.estimated_minutes)}</span>` : ""}
                      ${t.due_date ? `<span class="t-mins">due ${D.fmtShort(t.due_date)}</span>` : ""}
                    </div>
                  </div>`;
                }).join("")}
                ${!unsched.length ? `<p class="muted small" style="text-align:center;padding:14px 4px">All tasks scheduled 🎉</p>` : ""}
              </div>
              ${selectedTaskId ? `<p class="small mt-3" style="color:var(--accent-soft-ink);font-weight:600">Now click a slot to place it →</p>` : ""}
            </div>
            ${viewMode === "week" ? weekViewHTML() : monthViewHTML()}
          </div>
        </div>`;
    },

    mount(el) {
      el.querySelectorAll("[data-mode]").forEach((b) =>
        b.addEventListener("click", () => { viewMode = b.dataset.mode; App.render(); }));
      el.querySelector("[data-nav-prev]").addEventListener("click", () => {
        if (viewMode === "week") weekStart = D.addDays(weekStart, -7);
        else monthAnchor = D.addMonths(monthAnchor, -1);
        App.render();
      });
      el.querySelector("[data-nav-next]").addEventListener("click", () => {
        if (viewMode === "week") weekStart = D.addDays(weekStart, 7);
        else monthAnchor = D.addMonths(monthAnchor, 1);
        App.render();
      });
      el.querySelector("[data-nav-today]").addEventListener("click", () => {
        weekStart = D.mondayOf(D.today());
        monthAnchor = D.today().slice(0, 7) + "-01";
        App.render();
      });
      el.querySelector("[data-add-busy]").addEventListener("click", () => openBusyBlockModal());
      el.querySelector("[data-block-days]").addEventListener("click", openDateRangeModal);
      const auto = el.querySelector("[data-auto]");
      if (auto) auto.addEventListener("click", openAutoScheduleModal);
      const clearAll = el.querySelector("[data-clear-all]");
      if (clearAll) clearAll.addEventListener("click", async () => {
        const n = App.state().tasks.filter((t) => (t.scheduled_blocks || []).length).length;
        const ok = await UI.confirm({
          title: "Clear all scheduled tasks?",
          message: `${n} task${n === 1 ? "" : "s"} will return to the unscheduled list. Nothing is deleted.`,
          confirmLabel: "Clear All",
        });
        if (ok) { App.clearAllSchedules(); App.toast("Schedule cleared"); }
      });

      // unscheduled cards: select + drag
      el.querySelectorAll("[data-unsched-task]").forEach((card) => {
        const id = card.dataset.unschedTask;
        card.addEventListener("click", () => {
          selectedTaskId = selectedTaskId === id ? null : id;
          App.render();
        });
        card.addEventListener("dragstart", (e) => {
          drag = { taskId: id };
          e.dataTransfer.effectAllowed = "move";
        });
        card.addEventListener("dragend", () => { drag = null; });
      });

      // scheduled items: drag to move, click to edit, x to unschedule
      el.querySelectorAll("[data-sched-task]").forEach((item) => {
        const taskId = item.dataset.schedTask;
        const blockId = item.dataset.schedBlock;
        item.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          const task = App.taskById(taskId);
          const blk = task && (task.scheduled_blocks || []).find((b) => b.id === blockId);
          drag = { taskId, blockId, duration: blk ? blk.duration : undefined };
          e.dataTransfer.effectAllowed = "move";
        });
        item.addEventListener("dragend", () => { drag = null; });
        item.addEventListener("click", (e) => {
          if (e.target.closest("[data-unsched-block]")) return;
          const task = App.taskById(taskId);
          const blk = task && (task.scheduled_blocks || []).find((b) => b.id === blockId);
          if (task && blk) openEditBlockModal(task, blk);
        });
        const x = item.querySelector("[data-unsched-block]");
        if (x) x.addEventListener("click", (e) => {
          e.stopPropagation();
          App.removeScheduledBlock(taskId, blockId);
        });
      });

      // busy edit (click the block itself)
      el.querySelectorAll("[data-edit-busy]").forEach((node) => {
        const open = (e) => {
          if (e.target.closest("[data-del-busy]")) return;
          const block = App.state().busyBlocks.find((x) => x.id === node.dataset.editBusy);
          if (block) openBusyBlockModal(null, block);
        };
        node.addEventListener("click", open);
        node.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(e); } });
      });

      // busy delete
      el.querySelectorAll("[data-del-busy]").forEach((b) =>
        b.addEventListener("click", async (e) => {
          e.stopPropagation();
          const block = App.state().busyBlocks.find((x) => x.id === b.dataset.delBusy);
          if (block && block.kind !== "time") {
            const ok = await UI.confirm({
              title: "Delete busy block?",
              message: block.kind === "weekly"
                ? `“${block.title}” repeats on ${App.busyRepeatLabel(block)} — deleting removes it from every one of those days.`
                : `“${block.title}” blocks ${D.fmtShort(block.start_date)} – ${D.fmtShort(block.end_date)}.`,
            });
            if (!ok) return;
          }
          App.deleteBusyBlock(b.dataset.delBusy);
        }));

      // week slots: drop + click-to-place
      el.querySelectorAll(".week-slot").forEach((slot) => {
        const ds = slot.closest("[data-day]").dataset.day;
        const minute = Number(slot.dataset.slot);
        slot.addEventListener("dragover", (e) => { e.preventDefault(); slot.classList.add("dragover"); });
        slot.addEventListener("dragleave", () => slot.classList.remove("dragover"));
        slot.addEventListener("drop", (e) => { e.preventDefault(); dropOn(ds, minute); });
        slot.addEventListener("click", () => clickSlot(ds, minute));
      });

      // month cells
      el.querySelectorAll("[data-mday]").forEach((cell) => {
        const ds = cell.dataset.mday;
        const startMin = (App.state().settings.work_start_hour || 8) * 60;
        cell.addEventListener("dragover", (e) => e.preventDefault());
        cell.addEventListener("drop", (e) => { e.preventDefault(); dropOn(ds, startMin); });
        cell.addEventListener("click", (e) => {
          if (e.target.closest("[data-sched-task]")) return;
          clickSlot(ds, startMin);
        });
      });
    },
  };
})();
