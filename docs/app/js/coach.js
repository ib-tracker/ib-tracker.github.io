/* coach.js — the study coach.
   Two brains behind one chat:
   - Offline engine (default, no key/internet): advice grounded in the student's
     data, plus a command parser for clearly-worded actions ("set all BM tasks
     to high priority", pasted task lists, "schedule my Math IA for tomorrow").
   - AI mode (header toggle + API key): full Claude conversation with tool use.
   Either way, the coach NEVER changes data directly — every action becomes a
   preview card in the chat that the student confirms or cancels. */
(function () {
  "use strict";
  const App = window.App;
  const D = App.dates;
  const C = (App.coach = {});
  const CU = (App.coachUI = {});

  C.pending = false; // a reply is being composed (drives the typing indicator)

  /* ---- short-term conversational memory (resets on reload; powers follow-ups) ----
     The offline engine has no LLM to hold context, so we remember the last few
     things the student and coach talked about: which tasks were just listed,
     which subject, and what topic — so "schedule it", "the second one", "why?"
     and "tell me more" all resolve to something sensible. */
  const convo = { taskIds: [], subject: null, topic: null, topicArg: null, ts: 0 };
  function rememberTasks(tasks) {
    if (Array.isArray(tasks)) {
      const seen = new Set();
      convo.taskIds = tasks.filter((t) => t && t.id && !seen.has(t.id) && seen.add(t.id)).map((t) => t.id);
    }
    convo.ts = Date.now();
  }
  function rememberTopic(topic, arg) { convo.topic = topic || null; convo.topicArg = arg == null ? null : arg; convo.ts = Date.now(); }
  function rememberSubject(name) { if (name) { convo.subject = name; convo.ts = Date.now(); } }
  C._convo = convo; // exposed for tests

  /* The models offered in Settings. These are OpenRouter IDs and OpenRouter
     retires them, so they are not set-and-forget: an ID that goes away turns
     into an opaque API error at request time. Check them against
     https://openrouter.ai/api/v1/models when touching this list, and add
     anything removed to RETIRED_MODELS in core.js so saved copies get remapped
     rather than silently breaking.

     Ordered cheapest-capable first within each family — the student is paying
     for these on their own key, and the coach is mostly short exchanges. */
  const MODEL_LABELS = {
    "anthropic/claude-sonnet-5": "Claude Sonnet 5 — recommended",
    "anthropic/claude-opus-5": "Claude Opus 5 — strongest, priciest",
    "anthropic/claude-haiku-4.5": "Claude Haiku 4.5 — fastest, cheapest",
    "openai/gpt-4o": "GPT-4o",
    "deepseek/deepseek-r1": "DeepSeek R1",
    "google/gemini-2.5-flash": "Gemini 2.5 Flash",
  };
  const PRESET_MODELS = Object.keys(MODEL_LABELS);
  C.isCustomModel = (m) => !!m && !PRESET_MODELS.includes(m);
  C.modelLabel = (m) => MODEL_LABELS[m] || m || "Custom model";
  C.MODEL_LABELS = MODEL_LABELS;

  C.hasKey = () => !!(App.state().settings.ai_api_key || "").trim();
  C.tone = () => (App.state().settings.coach_tone === "direct" ? "direct" : "warm");
  C.model = () => App.state().settings.ai_model || App.DEFAULT_AI_MODEL;
  C.aiEnabled = () => App.state().settings.coach_ai_enabled !== false;
  C.aiActive = () => C.aiEnabled() && C.hasKey();

  C.toggleAI = function () {
    if (!C.aiEnabled() && !C.hasKey()) {
      App.toast("Add an OpenRouter API key in Settings first", "error");
      return false;
    }
    App.update((s) => { s.settings.coach_ai_enabled = !C.aiEnabled(); });
    return true;
  };

  /* ============================================================
     Analysis — one snapshot of the student's situation
     ============================================================ */
  C.analyze = function () {
    const s = App.state();
    const today = D.today();
    const taskMap = App.taskMap();
    const open = s.tasks.filter((t) => !t.completed);
    const actionable = open.filter((t) => !App.isLocked(t, taskMap));

    const overdue = open.filter((t) => t.due_date && t.due_date < today)
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    const dueToday = actionable.filter((t) => t.due_date === today);
    const dueTomorrow = actionable.filter((t) => t.due_date === D.addDays(today, 1));
    const dueWeek = open.filter((t) => t.due_date && t.due_date > today && t.due_date <= D.addDays(today, 7))
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    const unscheduledSoon = actionable.filter((t) =>
      t.due_date && t.due_date <= D.addDays(today, 7) && !(t.scheduled_blocks || []).length);

    const todayPlan = App.scheduledBlocksOn(today).filter(({ task }) => !task.completed);

    const sessDays = new Set(s.sessions.map((x) => D.isoToDateStr(x.start_time)).filter(Boolean));
    let streak = 0;
    for (let i = 0; i < 730; i++) {
      if (sessDays.has(D.addDays(today, -i))) streak++;
      else if (i > 0) break;
    }
    const minsBetween = (from, to) => s.sessions
      .filter((x) => { const ds = D.isoToDateStr(x.start_time); return ds && ds >= from && ds <= to; })
      .reduce((sum, x) => sum + App.sessionMinutes(x), 0);
    const focus7 = minsBetween(D.addDays(today, -6), today);
    const focusPrev7 = minsBetween(D.addDays(today, -13), D.addDays(today, -7));

    const completed7 = s.tasks.filter((t) =>
      t.completed && t.completed_at && (D.isoToDateStr(t.completed_at) || "") >= D.addDays(today, -6)).length;

    const gradeGaps = s.grades
      .map((g) => ({ subject: g.subject_name, current: g.current_grade, target: g.target_grade, gap: (g.target_grade || 0) - (g.current_grade || 0) }))
      .filter((g) => g.gap > 0)
      .sort((a, b) => b.gap - a.gap);

    const coreCats = { tok: "TOK", extended_essay: "Extended Essay", cas: "CAS" };
    const core = {};
    for (const [key, label] of Object.entries(coreCats)) {
      const items = open.filter((t) => t.category === key);
      const nearest = items.filter((t) => t.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
      core[key] = { label, open: items.length, nearestDue: nearest ? nearest.due_date : null, nearestTitle: nearest ? nearest.title : null };
    }

    const uniDeadlines = [];
    for (const c of s.courses) {
      const add = (type, date) => { if (date && date >= today && date <= D.addDays(today, 60)) uniDeadlines.push({ uni: c.university_name, course: c.course_name, type, date }); };
      add("application deadline", c.application_deadline);
      add("entrance exam", c.entrance_exam_date);
      add("interview", c.interview_date);
    }
    uniDeadlines.sort((a, b) => a.date.localeCompare(b.date));

    const subjTime = {};
    for (const sess of s.sessions) {
      const ds = D.isoToDateStr(sess.start_time);
      if (!ds || ds < D.addDays(today, -6)) continue;
      const key = sess.subject_name || "";
      if (key) subjTime[key] = (subjTime[key] || 0) + App.sessionMinutes(sess);
    }
    const neglected = gradeGaps.filter((g) => (subjTime[g.subject] || 0) < 30).slice(0, 3);

    const quickWin = actionable
      .filter((t) => (t.estimated_minutes || 0) > 0)
      .sort((a, b) => (a.estimated_minutes || 999) - (b.estimated_minutes || 999))[0] || null;

    const priRank = { critical: 0, high: 1, medium: 2, low: 3 };
    const topPriority = [...(overdue.length ? overdue : dueToday.length ? dueToday : actionable)]
      .sort((a, b) =>
        (a.due_date || "9999").localeCompare(b.due_date || "9999") ||
        ((priRank[a.priority] ?? 2) - (priRank[b.priority] ?? 2)))[0] || null;

    return {
      today, openCount: open.length, open, actionable, overdue, dueToday, dueTomorrow, dueWeek,
      unscheduledSoon, todayPlan, streak, focus7, focusPrev7, completed7,
      gradeGaps, core, uniDeadlines, subjTime, neglected, quickWin, topPriority,
      lockedCount: open.length - actionable.length,
      tokGrade: s.settings.tok_grade, eeGrade: s.settings.ee_grade,
      subjects: s.subjects.map((x) => x.name),
    };
  };

  /* ============================================================
     Actions — proposed in chat, applied only after Confirm
     ============================================================ */
  const fmtMin = App.fmtMinutes;
  const PRIORITIES = ["low", "medium", "high", "critical"];

  function resolveTasks(ids) {
    const map = App.taskMap();
    const found = [], missing = [];
    for (const id of ids || []) {
      const t = map.get(id);
      if (t) found.push(t); else missing.push(id);
    }
    return { found, missing };
  }

  function cleanTaskSpec(spec) {
    const t = spec || {};
    const title = String(t.title || "").trim().slice(0, 200);
    if (!title) return null;
    const subjects = App.state().subjects.map((x) => x.name);
    return {
      title,
      category: App.CATEGORIES[t.category] ? t.category : "subject_task",
      subject_name: subjects.includes(t.subject_name) ? t.subject_name : (t.subject_name || ""),
      priority: PRIORITIES.includes(t.priority) ? t.priority : "medium",
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(t.due_date || "") ? t.due_date : "",
      estimated_minutes: Math.max(0, Math.min(24 * 60, parseInt(t.estimated_minutes) || 0)),
    };
  }

  const SUMMARIZERS = {
    create_tasks(p) {
      const specs = (p.tasks || []).map(cleanTaskSpec).filter(Boolean).slice(0, 500);
      if (!specs.length) return { lines: ["Add tasks — but none of them had a usable title."], valid: false };
      const lines = [`Add ${specs.length} task${specs.length > 1 ? "s" : ""}:`];
      specs.slice(0, 8).forEach((t) => lines.push(`• ${t.title}${t.estimated_minutes ? ` · ${fmtMin(t.estimated_minutes)}` : ""}${t.due_date ? ` · due ${D.fmtShort(t.due_date)}` : ""}${t.subject_name ? ` · ${t.subject_name}` : ""}`));
      if (specs.length > 8) lines.push(`…and ${specs.length - 8} more`);
      const newSubs = [...new Set(specs.map((t) => t.subject_name).filter((n) => n && !App.state().subjects.some((x) => x.name === n)))];
      if (newSubs.length) lines.push(`New subject${newSubs.length > 1 ? "s" : ""} will be created: ${newSubs.join(", ")}`);
      return { lines, valid: true };
    },
    update_tasks(p) {
      const { found, missing } = resolveTasks(p.task_ids);
      const ch = p.changes || {};
      const parts = [];
      if (PRIORITIES.includes(ch.priority)) parts.push(`priority → ${ch.priority}`);
      if (/^\d{4}-\d{2}-\d{2}$/.test(ch.due_date || "")) parts.push(`due date → ${D.fmtShort(ch.due_date)}`);
      if (App.CATEGORIES[ch.category]) parts.push(`category → ${App.CATEGORIES[ch.category].label}`);
      if (typeof ch.subject_name === "string" && ch.subject_name) parts.push(`subject → ${ch.subject_name}`);
      if (typeof ch.estimated_minutes === "number") parts.push(`estimate → ${fmtMin(ch.estimated_minutes)}`);
      if (ch.completed === true) parts.push(`mark complete`);
      if (ch.completed === false) parts.push(`mark incomplete`);
      // Only clearing is accepted, so the test is === "" rather than a truthy
      // string check — an empty value is the whole point of this one.
      if (ch.predecessor_id === "") parts.push(`no longer waits on another task`);
      if (!found.length || !parts.length) return { lines: ["Update tasks — but nothing valid to change."], valid: false };
      const lines = [`Update ${found.length} task${found.length > 1 ? "s" : ""} (${parts.join(", ")}):`];
      found.slice(0, 8).forEach((t) => lines.push(`• ${t.title}`));
      if (found.length > 8) lines.push(`…and ${found.length - 8} more`);
      if (missing.length) lines.push(`(${missing.length} couldn't be found and will be skipped)`);
      return { lines, valid: true };
    },
    delete_tasks(p) {
      const { found, missing } = resolveTasks(p.task_ids);
      if (!found.length) return { lines: ["Delete tasks — but none of them could be found."], valid: false };
      const lines = [`⚠ Permanently delete ${found.length} task${found.length > 1 ? "s" : ""} (and their sub-tasks):`];
      found.slice(0, 8).forEach((t) => lines.push(`• ${t.title}`));
      if (found.length > 8) lines.push(`…and ${found.length - 8} more`);
      if (missing.length) lines.push(`(${missing.length} couldn't be found)`);
      return { lines, valid: true };
    },
    schedule_task(p) {
      const t = App.taskById(p.task_id);
      if (!t) return { lines: ["Schedule a task — but it couldn't be found."], valid: false };
      const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : D.today();
      const startMin = typeof p.start_hour === "number"
        ? App.clamp(Math.round(p.start_hour * 60), 0, 23 * 60)
        : (App.state().settings.work_start_hour || 8) * 60;
      const dur = Math.max(15, Math.min(8 * 60, parseInt(p.duration_minutes) || t.estimated_minutes || 30));
      return {
        lines: [`Schedule “${t.title}” on ${D.fmtLong(date)} around ${D.minToLabel(startMin)} for ${fmtMin(dur)} (it slots into the first free gap).`],
        valid: true,
      };
    },
    run_auto_schedule() {
      const n = App.state().tasks.filter((t) => !t.completed && !(t.scheduled_blocks || []).length).length;
      return {
        lines: [`Run Auto-Schedule for this week — ${n} unscheduled task${n === 1 ? "" : "s"} get placed around your busy blocks and daily hours.`],
        valid: n > 0,
      };
    },
    unschedule_tasks(p) {
      const { found } = resolveTasks(p.task_ids);
      const withBlocks = found.filter((t) => (t.scheduled_blocks || []).length);
      if (!withBlocks.length) return { lines: ["Take tasks off the calendar — but none of them are scheduled."], valid: false };
      const lines = [`Remove ${withBlocks.length} task${withBlocks.length > 1 ? "s" : ""} from the calendar (they go back to the unscheduled list, nothing is deleted):`];
      withBlocks.slice(0, 8).forEach((t) => lines.push(`• ${t.title}`));
      return { lines, valid: true };
    },
    clear_schedule() {
      const n = App.state().tasks.filter((t) => (t.scheduled_blocks || []).length).length;
      return { lines: [`Clear the whole calendar — ${n} scheduled task${n === 1 ? "" : "s"} return to the unscheduled list. Nothing is deleted.`], valid: n > 0 };
    },
    reschedule_overdue() {
      const today = D.today();
      const n = App.state().tasks.filter((t) => !t.completed && t.due_date && t.due_date < today).length;
      return { lines: [`Spread your ${n} overdue task${n === 1 ? "" : "s"} across the coming week — most urgent first — so each gets a realistic new due date.`], valid: n > 0 };
    },
    add_subtasks(p) {
      const t = App.taskById(p.task_id);
      const subs = (p.subtasks || []).map((s) => String(s.title || "").trim()).filter(Boolean).slice(0, 20);
      if (!t || !subs.length) return { lines: ["Add sub-tasks — but I couldn't tell which task, or there were no sub-tasks."], valid: false };
      const lines = [`Add ${subs.length} sub-task${subs.length > 1 ? "s" : ""} to “${t.title}”:`];
      subs.slice(0, 8).forEach((s) => lines.push(`• ${s}`));
      return { lines, valid: true };
    },
    split_task(p) {
      const t = App.taskById(p.task_id);
      const parts = App.clamp(parseInt(p.parts) || 0, 2, 12);
      if (!t || parts < 2) return { lines: ["Split a task — but I couldn't tell which task, or into how many parts."], valid: false };
      const each = t.estimated_minutes ? Math.round(t.estimated_minutes / parts) : 0;
      return { lines: [`Break “${t.title}” into ${parts} smaller sub-tasks${each ? ` of about ${fmtMin(each)} each` : ""}, so it's easier to start and schedule.`], valid: true };
    },
  };

  const EXECUTORS = {
    create_tasks(p) {
      const specs = (p.tasks || []).map(cleanTaskSpec).filter(Boolean).slice(0, 500);
      // create any named subject that doesn't exist yet, so the tasks link to a real subject
      const existing = new Set(App.state().subjects.map((x) => x.name));
      const newSubs = [...new Set(specs.map((t) => t.subject_name).filter((n) => n && !existing.has(n)))];
      newSubs.forEach((n) => App.createSubject(n));
      App.createTasks(specs); // one batched update — no per-task re-render
      return `Added ${specs.length} task${specs.length > 1 ? "s" : ""}${newSubs.length ? ` and created ${newSubs.length} new subject${newSubs.length > 1 ? "s" : ""}` : ""}.`;
    },
    update_tasks(p) {
      const { found } = resolveTasks(p.task_ids);
      const ch = p.changes || {};
      const nowISO = new Date().toISOString();
      let ticked = 0;
      App.update((s) => {
        for (const ref of found) {
          const t = s.tasks.find((x) => x.id === ref.id);
          if (!t) continue;
          if (PRIORITIES.includes(ch.priority)) t.priority = ch.priority;
          if (/^\d{4}-\d{2}-\d{2}$/.test(ch.due_date || "")) t.due_date = ch.due_date;
          if (App.CATEGORIES[ch.category]) t.category = ch.category;
          if (typeof ch.subject_name === "string" && ch.subject_name) t.subject_name = ch.subject_name;
          if (typeof ch.estimated_minutes === "number") t.estimated_minutes = Math.max(0, Math.round(ch.estimated_minutes));
          if (ch.completed === true && !t.completed) { t.completed = true; t.completed_at = nowISO; t.progress = 100; ticked++; }
          if (ch.completed === false && t.completed) { t.completed = false; t.completed_at = null; }
          // Clearing a dependency only. Pointing one task at another is a
          // different decision — which task, and is it in the same subject —
          // so that stays a deliberate edit in the task form.
          if (ch.predecessor_id === "") t.predecessor_id = "";
          t.updated_at = nowISO;
        }
      });
      if (ticked) App.sfx("task"); // ticking off through the coach still counts
      return `Updated ${found.length} task${found.length > 1 ? "s" : ""}.`;
    },
    delete_tasks(p) {
      const { found } = resolveTasks(p.task_ids);
      found.forEach((t) => App.deleteTask(t.id));
      return `Deleted ${found.length} task${found.length > 1 ? "s" : ""}.`;
    },
    schedule_task(p) {
      const t = App.taskById(p.task_id);
      if (!t) return "Couldn't schedule — the task no longer exists.";
      const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : D.today();
      const startMin = typeof p.start_hour === "number"
        ? App.clamp(Math.round(p.start_hour * 60), 0, 23 * 60)
        : (App.state().settings.work_start_hour || 8) * 60;
      const dur = Math.max(15, Math.min(8 * 60, parseInt(p.duration_minutes) || t.estimated_minutes || 30));
      const res = App.scheduleTaskAt(t.id, date, startMin, { duration: dur });
      return res.ok
        ? `Scheduled “${t.title}” on ${D.fmtShort(date)} at ${D.minToLabel(res.start_min)}.`
        : `Couldn't schedule “${t.title}”: ${res.reason}`;
    },
    run_auto_schedule() {
      const res = App.autoSchedule({ weekStart: D.mondayOf(D.today()), maxSession: 90, breakMinutes: 15, includeBreaks: true });
      let line = `Auto-scheduled ${res.scheduled_count} task${res.scheduled_count === 1 ? "" : "s"}.`;
      if (res.error_count) line += ` ${res.error_count} couldn't fit — see the Scheduler for details.`;
      return line;
    },
    unschedule_tasks(p) {
      const { found } = resolveTasks(p.task_ids);
      const withBlocks = found.filter((t) => (t.scheduled_blocks || []).length);
      withBlocks.forEach((t) => App.unscheduleTask(t.id));
      return `Took ${withBlocks.length} task${withBlocks.length === 1 ? "" : "s"} off the calendar.`;
    },
    clear_schedule() {
      const n = App.state().tasks.filter((t) => (t.scheduled_blocks || []).length).length;
      App.clearAllSchedules();
      return `Cleared the calendar — ${n} task${n === 1 ? "" : "s"} back on the unscheduled list.`;
    },
    reschedule_overdue() {
      const today = D.today();
      const priRank = { critical: 0, high: 1, medium: 2, low: 3 };
      const overdue = App.state().tasks
        .filter((t) => !t.completed && t.due_date && t.due_date < today)
        .sort((x, y) => (priRank[x.priority] ?? 2) - (priRank[y.priority] ?? 2) || x.due_date.localeCompare(y.due_date));
      if (!overdue.length) return "No overdue tasks to reschedule.";
      const perDay = Math.max(1, Math.ceil(overdue.length / 7));
      const nowISO = new Date().toISOString();
      App.update((s) => {
        overdue.forEach((t, i) => {
          const nt = s.tasks.find((x) => x.id === t.id);
          if (nt) { nt.due_date = D.addDays(today, 1 + Math.floor(i / perDay)); nt.updated_at = nowISO; }
        });
      });
      return `Rescheduled ${overdue.length} overdue task${overdue.length === 1 ? "" : "s"} across the next week.`;
    },
    add_subtasks(p) {
      const t = App.taskById(p.task_id);
      const subs = (p.subtasks || []).map((s) => ({ title: String(s.title || "").trim(), estimated_minutes: Math.max(0, parseInt(s.estimated_minutes) || 0) })).filter((s) => s.title).slice(0, 20);
      if (!t || !subs.length) return "Couldn't add sub-tasks — the task or the list was missing.";
      subs.forEach((s) => App.createSubtask(t.id, s.title, s.estimated_minutes));
      return `Added ${subs.length} sub-task${subs.length === 1 ? "" : "s"} to “${t.title}”.`;
    },
    split_task(p) {
      const t = App.taskById(p.task_id);
      const parts = App.clamp(parseInt(p.parts) || 0, 2, 12);
      if (!t || parts < 2) return "Couldn't split — the task or part-count was missing.";
      const each = t.estimated_minutes ? Math.round(t.estimated_minutes / parts) : 0;
      for (let i = 1; i <= parts; i++) App.createSubtask(t.id, `Part ${i} of ${parts}`, each);
      return `Split “${t.title}” into ${parts} sub-tasks${each ? ` (~${fmtMin(each)} each)` : ""}.`;
    },
  };

  function buildAction(items) {
    const summary = [];
    let anyValid = false;
    const kept = [];
    for (const item of items) {
      const summarize = SUMMARIZERS[item.type];
      if (!summarize) continue;
      const s2 = summarize(item.payload || {});
      summary.push(...s2.lines);
      if (s2.valid) { anyValid = true; kept.push(item); }
    }
    if (!anyValid) return null;
    return { id: App.uid(), items: kept, summary, status: "pending" };
  }

  function findPendingAction() {
    const msgs = App.state().coach.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].action && msgs[i].action.status === "pending") return msgs[i].action;
    }
    return null;
  }
  C.pendingAction = findPendingAction;

  C.confirmAction = function (actionId) {
    const msgs = App.state().coach.messages;
    const msg = msgs.find((m) => m.action && m.action.id === actionId && m.action.status === "pending");
    if (!msg) return;
    const results = [];
    for (const item of (Array.isArray(msg.action.items) ? msg.action.items : [])) {
      // hasOwnProperty, not a bare lookup: item.type comes from persisted state,
      // and "constructor" or "toString" would otherwise resolve up the prototype
      // chain to a real function and get called — printing "[object Object]" at
      // the user. An unrecognised type is a message, never a raw TypeError.
      const run = Object.prototype.hasOwnProperty.call(EXECUTORS, item.type) ? EXECUTORS[item.type] : null;
      if (typeof run !== "function") {
        results.push("One change was of a kind this version doesn't recognise, so it was skipped.");
        continue;
      }
      try { results.push(run(item.payload || {})); }
      catch (e) { console.error(e); results.push(`Something went wrong with one change: ${e.message}`); }
    }
    App.update((s) => {
      const m = s.coach.messages.find((x) => x.action && x.action.id === actionId);
      if (m) m.action.status = "done";
      s.coach.messages.push({
        role: "coach", ts: Date.now(), via: "action",
        text: results.join("\n") + (C.tone() === "warm" ? "\nAnything else?" : ""),
      });
    });
  };

  C.cancelAction = function (actionId, silent) {
    App.update((s) => {
      const m = s.coach.messages.find((x) => x.action && x.action.id === actionId);
      if (m) m.action.status = "cancelled";
      if (!silent) {
        s.coach.messages.push({
          role: "coach", ts: Date.now(), via: "action",
          text: C.tone() === "warm" ? "No problem — I haven't changed anything." : "Cancelled. Nothing changed.",
        });
      }
    }, { silent: !!silent });
  };

  /* ============================================================
     Offline engine — advice
     ============================================================ */
  const taskLine = (t) => `• ${t.title}${t.due_date ? ` (due ${D.fmtShort(t.due_date)}` : "("}${t.estimated_minutes ? `${t.due_date ? ", " : ""}${fmtMin(t.estimated_minutes)}` : ""})`.replace(" ()", "");

  function planReply(a) {
    const lines = [];
    if (a.overdue.length) {
      lines.push(C.tone() === "warm" ? `Let's clear the backlog first — ${a.overdue.length} task${a.overdue.length > 1 ? "s are" : " is"} overdue:` : `${a.overdue.length} overdue. Clear these first:`);
      a.overdue.slice(0, 3).forEach((t) => lines.push(taskLine(t)));
      if (a.overdue.length > 3) lines.push(`…and ${a.overdue.length - 3} more on the Timeline.`);
    }
    if (a.dueToday.length) {
      lines.push(`Due today:`);
      a.dueToday.slice(0, 4).forEach((t) => lines.push(taskLine(t)));
    }
    if (a.todayPlan.length) {
      lines.push(`On today's schedule:`);
      a.todayPlan.slice(0, 4).forEach(({ task, block }) => lines.push(`• ${D.minToLabel(block.start_min)} — ${task.title} (${fmtMin(block.duration)})`));
    }
    if (!lines.length) {
      if (a.dueWeek.length) {
        lines.push(C.tone() === "warm" ? `Nothing urgent today — nice position to be in. Get ahead on this week:` : `Nothing due today. Get ahead:`);
        a.dueWeek.slice(0, 3).forEach((t) => lines.push(taskLine(t)));
      } else if (a.openCount) {
        lines.push(`No deadlines pressing. Pick something meaningful from the Timeline${a.quickWin ? `, or knock out a quick win: ${a.quickWin.title} (${fmtMin(a.quickWin.estimated_minutes)})` : ""}.`);
      } else {
        lines.push(`Your task list is empty. Add what's on your plate (or paste a list of tasks right here) and I can help you plan it.`);
      }
    }
    // work side-by-side with the scheduler: offer to place the top task
    let action = null;
    const top = a.topPriority;
    if (top && !(top.scheduled_blocks || []).length && !top.completed) {
      lines.push(`Should I add “${top.title}” to today's schedule?`);
      action = buildAction([{ type: "schedule_task", payload: { task_id: top.id, date: a.today } }]);
    } else {
      lines.push(C.tone() === "warm" ? `When you're ready, open Study Session, queue the first task, and just start — 25 minutes is enough to get going.` : `Open Study Session, queue the top task, start a 25-minute block. Go.`);
    }
    rememberTopic("plan");
    rememberTasks([a.topPriority, ...a.overdue, ...a.dueToday, ...a.dueWeek].filter(Boolean));
    return { text: lines.join("\n"), action };
  }

  function tomorrowReply(a) {
    const tmr = D.addDays(a.today, 1);
    const lines = [];
    if (a.dueTomorrow.length) {
      lines.push(C.tone() === "warm" ? `Here's what's due tomorrow (${D.fmtLong(tmr)}):` : `Due tomorrow (${D.fmtLong(tmr)}):`);
      a.dueTomorrow.slice(0, 5).forEach((t) => lines.push(taskLine(t)));
    } else {
      lines.push(a.overdue.length
        ? `Nothing new is due tomorrow — but ${a.overdue.length} task${a.overdue.length === 1 ? " is" : "s are"} already overdue, so tomorrow's a good day to clear ${a.overdue.length === 1 ? "it" : "some"}.`
        : (C.tone() === "warm" ? `Nothing is due tomorrow — a good chance to get ahead.` : `Nothing due tomorrow. Get ahead.`));
    }
    const planned = App.scheduledBlocksOn(tmr).filter(({ task }) => !task.completed);
    if (planned.length) {
      lines.push(`Already on tomorrow's schedule:`);
      planned.slice(0, 5).forEach(({ task, block }) => lines.push(`• ${D.minToLabel(block.start_min)} — ${task.title} (${fmtMin(block.duration)})`));
    }
    let action = null;
    const firstUnsched = a.dueTomorrow.find((t) => !(t.scheduled_blocks || []).length);
    if (firstUnsched && !planned.length) {
      lines.push(`Want me to block time for “${firstUnsched.title}” tomorrow?`);
      action = buildAction([{ type: "schedule_task", payload: { task_id: firstUnsched.id, date: tmr } }]);
    }
    rememberTopic("tomorrow");
    rememberTasks(a.dueTomorrow);
    return { text: lines.join("\n"), action };
  }

  function weekendReply(a) {
    // next Saturday + Sunday (or today/tomorrow if we're already in the weekend)
    const dow = D.dayOfWeek(a.today); // 0=Sun..6=Sat
    const satOffset = (6 - dow + 7) % 7;
    const sat = D.addDays(a.today, satOffset);
    const sun = D.addDays(sat, 1);
    const weekendSet = new Set([sat, sun, dow === 0 ? a.today : null].filter(Boolean));
    const items = a.open.filter((t) => t.due_date && weekendSet.has(t.due_date))
      .sort((x, y) => x.due_date.localeCompare(y.due_date));
    const lines = [];
    if (items.length) {
      lines.push(`Due this weekend (${D.fmtShort(sat)}–${D.fmtShort(sun)}):`);
      items.slice(0, 5).forEach((t) => lines.push(taskLine(t)));
    } else {
      lines.push(C.tone() === "warm"
        ? `Nothing is due this weekend — protect some rest, and maybe get a head-start on next week's biggest task.`
        : `Nothing due this weekend. Bank time on your hardest task or rest deliberately.`);
    }
    rememberTopic("weekend");
    rememberTasks(items);
    return { text: lines.join("\n") };
  }

  function weekReply(a) {
    const lines = [];
    const load = a.dueWeek.reduce((s2, t) => s2 + (t.estimated_minutes || 0), 0);
    lines.push(`This week: ${a.dueWeek.length} task${a.dueWeek.length === 1 ? "" : "s"} due${load ? ` (~${fmtMin(load)} of estimated work)` : ""}${a.overdue.length ? `, plus ${a.overdue.length} overdue to catch up on` : ""}.`);
    a.dueWeek.slice(0, 5).forEach((t) => lines.push(taskLine(t)));
    let action = null;
    if (a.unscheduledSoon.length) {
      lines.push(`${a.unscheduledSoon.length} of the tasks due within a week ${a.unscheduledSoon.length === 1 ? "isn't" : "aren't"} on your calendar yet. Want me to run Auto-Schedule for the week?`);
      action = buildAction([{ type: "run_auto_schedule", payload: {} }]);
    } else if (a.dueWeek.length || a.overdue.length) {
      lines.push(`Everything urgent is already scheduled — stick to the calendar and you're covered.`);
    }
    rememberTopic("week");
    rememberTasks([...a.dueWeek, ...a.overdue]);
    return { text: lines.join("\n"), action };
  }

  function statsReply(a) {
    const lines = [];
    const trend = a.focusPrev7 > 0 ? Math.round(((a.focus7 - a.focusPrev7) / a.focusPrev7) * 100) : null;
    lines.push(`Last 7 days: ${fmtMin(a.focus7)} of focused study, ${a.completed7} task${a.completed7 === 1 ? "" : "s"} completed.`);
    if (a.streak > 1) lines.push(`You're on a ${a.streak}-day study streak${C.tone() === "warm" ? " — genuinely impressive, keep it alive!" : ". Don't break it."}`);
    else if (a.streak === 1) lines.push(`You studied today — day 1 of a new streak.`);
    else lines.push(C.tone() === "warm" ? `No session logged yet today — even a short one keeps the rhythm.` : `Nothing logged today. Fix that.`);
    if (trend !== null && Math.abs(trend) >= 15) {
      lines.push(trend > 0 ? `That's ${trend}% more study time than the week before.` : `That's ${Math.abs(trend)}% less than the week before${C.tone() === "warm" ? " — worth a look at what got in the way." : ". Course-correct."}`);
    }
    if (a.overdue.length) lines.push(`Open items: ${a.openCount} tasks, ${a.overdue.length} overdue.`);
    else lines.push(`Open items: ${a.openCount} tasks, nothing overdue${a.openCount ? "" : " — clean slate"}.`);
    const goalH = App.state().settings.weekly_goal_hours || 0;
    if (goalH > 0) {
      const doneMin = App.weekMinutes(), goalMin = goalH * 60;
      if (doneMin >= goalMin) lines.push(`Weekly goal: ${App.fmtMinutes(doneMin)} of ${goalH}h — hit it. ${C.tone() === "warm" ? "Nice." : "Good."}`);
      else lines.push(`Weekly goal: ${App.fmtMinutes(doneMin)} of ${goalH}h — ${App.fmtMinutes(goalMin - doneMin)} to go before Monday.`);
    }
    lines.push(`The Analytics page has the full picture — charts, streak and time by subject.`);
    rememberTopic("stats");
    return { text: lines.join("\n") };
  }

  function gradesReply(a) {
    const pp = App.predictedPoints();
    const lines = [];
    if (!a.gradeGaps.length && !a.tokGrade && !a.eeGrade && !pp.gradesCount) {
      return { text: `No grades recorded yet. Add your current and target grades on the Grades page and I'll track your predicted score and where to focus.` };
    }
    if (pp.gradesCount) {
      const core = pp.failing ? "a failing core condition" : `${pp.corePoints ?? "—"} core point${pp.corePoints === 1 ? "" : "s"}`;
      lines.push(`Predicted total: ${pp.totalPoints}/${pp.maxPoints} — ${pp.subjectPoints} from subjects plus ${core} (TOK+EE).`);
    }
    if (a.gradeGaps.length) {
      lines.push(`Biggest gaps to target:`);
      a.gradeGaps.slice(0, 3).forEach((g) => lines.push(`• ${g.subject}: ${g.current} now, aiming for ${g.target} (+${g.gap})`));
      if (a.neglected.length) {
        lines.push(`${a.neglected.map((g) => g.subject).join(", ")} ${a.neglected.length === 1 ? "has" : "have"} a gap but little study time this week — that's where extra sessions pay off most.`);
      }
    } else if (pp.gradesCount) {
      lines.push(`Every subject is at or above target${C.tone() === "warm" ? " — brilliant work." : "."}`);
    }
    const cp = App.getCorePoints(a.tokGrade, a.eeGrade);
    if (cp !== null) lines.push(`TOK ${a.tokGrade} + EE ${a.eeGrade} = ${cp}/3 core points.`);
    rememberTopic("grades");
    return { text: lines.join("\n") };
  }

  function coreReply(a, key) {
    const c = a.core[key];
    rememberTopic("core", key);
    const lines = [];
    if (!c.open) {
      lines.push(`No open ${c.label} tasks right now${C.tone() === "warm" ? " — you're on top of it." : "."}`);
      lines.push(`If there's upcoming ${c.label} work, add it early — core deadlines sneak up.`);
    } else {
      lines.push(`${c.open} open ${c.label} task${c.open === 1 ? "" : "s"}.`);
      if (c.nearestDue) lines.push(`Next up: ${c.nearestTitle}, due ${D.fmtMed(c.nearestDue)} (${D.diffDays(a.today, c.nearestDue)} days away).`);
      lines.push(`The Core Requirements page shows the full ${c.label} picture.`);
    }
    return { text: lines.join("\n") };
  }

  function uniReply(a) {
    if (!a.uniDeadlines.length) return { text: `No university deadlines in the next 60 days. The University page tracks applications, offers and materials when you need it.` };
    const lines = [`Upcoming university dates:`];
    a.uniDeadlines.slice(0, 4).forEach((d) =>
      lines.push(`• ${d.uni} — ${d.type} on ${D.fmtMed(d.date)} (${D.diffDays(a.today, d.date)} days)`));
    lines.push(`Check the application tracker checklists on the University page so nothing slips.`);
    return { text: lines.join("\n") };
  }

  function subjectReply(a, name) {
    const s = App.state();
    const tasks = s.tasks.filter((t) => t.subject_name === name && !t.completed)
      .sort((x, y) => (x.due_date || "9999").localeCompare(y.due_date || "9999"));
    const grade = s.grades.find((g) => g.subject_name === name);
    const time7 = a.subjTime[name] || 0;
    const lines = [];
    lines.push(`${name}: ${tasks.length} open task${tasks.length === 1 ? "" : "s"}${grade ? `, grade ${grade.current_grade} → target ${grade.target_grade}` : ""}${time7 ? `, ${fmtMin(time7)} studied this week` : ", no study time logged this week"}.`);
    tasks.slice(0, 4).forEach((t) => lines.push(taskLine(t)));
    if (grade && grade.target_grade > grade.current_grade && time7 < 60) {
      lines.push(C.tone() === "warm" ? `To close that grade gap, try booking two focused sessions this week — the Scheduler makes it painless.` : `Grade gap + no study time = schedule two sessions this week. Now.`);
    }
    rememberSubject(name);
    rememberTopic("subject", name);
    rememberTasks(tasks);
    return { text: lines.join("\n") };
  }

  function overwhelmedReply(a) {
    const lines = [];
    if (C.tone() === "warm") lines.push(`That feeling is real, and it's also very fixable. Let's shrink the mountain into one step.`);
    else lines.push(`Overwhelm means too many open loops. Close one.`);
    if (a.quickWin) lines.push(`Smallest thing on your list: ${a.quickWin.title} — just ${fmtMin(a.quickWin.estimated_minutes)}. Do only that.`);
    else if (a.topPriority) lines.push(`Pick just one: ${a.topPriority.title}. Set a 25-minute timer and stop when it rings.`);
    lines.push(`Then take a real break — walk, water, no phone. One block done changes how the whole day feels.`);
    if (a.overdue.length > 3) lines.push(`Also: with ${a.overdue.length} overdue tasks, consider rescheduling the non-critical ones to realistic dates — just tell me "reschedule my overdue tasks to <a date>" and I'll set it up.`);
    return { text: lines.join("\n") };
  }

  function focusReply(a) {
    const lines = [];
    lines.push(C.tone() === "warm"
      ? `Focus is a skill you warm up, not a switch. The trick is starting stupidly small.`
      : `Stop negotiating with yourself. Shrink the task until starting is trivial.`);
    lines.push(`• Open Study Session and set 25 minutes — not 2 hours.`);
    if (a.quickWin) lines.push(`• Queue something tiny first: ${a.quickWin.title} (${fmtMin(a.quickWin.estimated_minutes)}).`);
    lines.push(`• Phone in another room. Seriously — it's the single biggest lever.`);
    if (a.streak > 2) lines.push(`You've studied ${a.streak} days in a row — the habit is already there. Today is just day ${a.streak + 1}.`);
    return { text: lines.join("\n") };
  }

  function summaryReply(a) {
    const bits = [];
    if (a.overdue.length) bits.push(`${a.overdue.length} overdue`);
    if (a.dueToday.length) bits.push(`${a.dueToday.length} due today`);
    if (a.dueWeek.length) bits.push(`${a.dueWeek.length} due this week`);
    const head = bits.length
      ? `Where you stand: ${bits.join(", ")}, ${a.openCount} open in total.`
      : `Where you stand: ${a.openCount} open task${a.openCount === 1 ? "" : "s"}, no pressing deadlines.`;
    return {
      text: [
        head,
        a.streak > 1 ? `Streak: ${a.streak} days. Focus this week: ${fmtMin(a.focus7)}.` : `Focus this week: ${fmtMin(a.focus7)}.`,
        ``,
        `Ask me for advice:`,
        `• "What should I work on now?" · "Plan my week" · "How are my grades?"`,
        `• Any subject by name, or "How's my EE going?"`,
        `And I can make changes for you (you confirm first):`,
        `• "Set all Chemistry tasks to high priority"`,
        `• Paste a list of tasks to add them all at once`,
        `• "Schedule my Math IA for tomorrow" · "Auto-schedule my week"`,
      ].join("\n"),
    };
  }

  // fuzzy subject detection: full name, a base word (HL/SL stripped), or an abbreviation
  const SUBJECT_ABBR = [
    ["maths", /math/i], ["math", /math/i], ["chem", /chem/i], ["phys", /phys/i],
    ["bio", /bio/i], ["econ", /econ/i], ["eng", /english/i], ["hist", /histor/i],
    ["geo", /geog/i], ["psych", /psych/i], ["cs", /comp|comp sci|computer/i],
    ["compsci", /comp|computer/i], ["span", /spanish/i], ["fren", /french/i],
    ["bm", /business|management/i], ["ess", /environmenta|ess/i],
  ];
  function matchSubject(q) {
    const ql = q.toLowerCase();
    const subs = App.state().subjects.map((s) => s.name);
    for (const n of subs) if (ql.includes(n.toLowerCase())) return n;
    for (const n of subs) {
      const base = App.parseSubjectLevel(n).base.toLowerCase();
      for (const w of base.split(/\s+/)) {
        if (w.length >= 4 && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(ql)) return n;
      }
    }
    for (const [ab, rx] of SUBJECT_ABBR) {
      if (new RegExp(`\\b${ab}\\b`).test(ql)) { const m = subs.find((x) => rx.test(x)); if (m) return m; }
    }
    return null;
  }

  function predictedReply() {
    const pp = App.predictedPoints();
    if (!pp.gradesCount) {
      return { text: `No grades yet, so I can't project a score. Add your current grades on the Grades page — the diploma is out of 45 (six subjects at 1–7 = 42, plus up to 3 core points from TOK + EE).` };
    }
    const target = App.state().settings.target_points || 40;
    const core = pp.failing ? "a failing core condition (an E in TOK or EE)" : `${pp.corePoints ?? "—"} core point${pp.corePoints === 1 ? "" : "s"}`;
    const lines = [`You're on track for a predicted ${pp.totalPoints}/${pp.maxPoints} — ${pp.subjectPoints} from your ${pp.gradesCount} graded subject${pp.gradesCount === 1 ? "" : "s"} plus ${core}.`];
    if (pp.totalPoints >= target) lines.push(`That meets your ${target}-point goal — keep it steady.`);
    else lines.push(`Your goal is ${target}, so you're ${target - pp.totalPoints} short. The Grades page shows which subjects give the biggest gains.`);
    rememberTopic("predicted");
    return { text: lines.join("\n") };
  }

  function examCountdownReply() {
    rememberTopic("exam");
    const d = App.state().settings.exam_date;
    if (!d) return { text: `You haven't set your exam date yet — add it in Settings → IB exams and I'll count down to it (it also shows on your Dashboard).` };
    const days = D.diffDays(D.today(), d);
    if (days < 0) return { text: `Your exam session (${D.fmtMed(d)}) has already passed — hope it went well!` };
    if (days === 0) return { text: `Exams start today — ${D.fmtMed(d)}. Deep breath. You've prepared for this.` };
    const wk = Math.round(days / 7);
    const tail = days > 60 ? "Plenty of time to build a steady, unhurried revision routine."
      : days > 21 ? "Time to firm up a revision plan — topic by topic, past paper by past paper."
      : "Crunch time — prioritise past papers and your weakest topics over re-reading notes.";
    return { text: `${days} day${days === 1 ? "" : "s"} until your IB exams (${D.fmtMed(d)}) — about ${wk} week${wk === 1 ? "" : "s"}. ${tail}` };
  }

  function breakReply(a) {
    const lines = [];
    lines.push(C.tone() === "warm"
      ? `Breaks aren't slacking — they're how focus recovers. If you've been at it a while, take one.`
      : `Yes. Short breaks keep output up. Take one, then get back in.`);
    lines.push(`• Step away 5–10 min: stand up, water, look out a window — not your phone.`);
    lines.push(`• Then come back for one more focused block.`);
    if (!App.state().settings.pomodoro_enabled) lines.push(`• Tip: switch on Pomodoro in Study Session and breaks are built into the timer.`);
    if (a.streak > 0) lines.push(`Your ${a.streak}-day streak stays alive as long as you log something today.`);
    return { text: lines.join("\n") };
  }

  const STUDY_TIPS = [
    `Do past papers under timed conditions, then mark them against the IB markscheme. Your mistakes are your revision list.`,
    `Active recall beats re-reading: close the notes and write everything you remember, then fill the gaps.`,
    `Space it out — 4 × 30-min sessions across a week beat one 2-hour cram. Your brain consolidates in between.`,
    `For any IA, check every section against the assessment criteria as you write. That rubric is literally the mark scheme.`,
    `Teach it out loud to an empty room. If you can't explain it simply, that's the bit to review.`,
    `Make a one-page summary per topic. The act of condensing is where most of the learning happens.`,
    `Prioritise by weight: a Paper or IA worth 25% deserves more time than a low-stakes worksheet.`,
    `Attack your weakest topics first, while your energy is highest — not the ones you already enjoy.`,
    `Sleep is part of studying. An all-nighter before an exam usually costs more marks than it earns.`,
    `Interleave subjects in a session — switching Maths ↔ Bio keeps you sharper than hours on one.`,
  ];
  function tipsReply() {
    const t = STUDY_TIPS[Math.floor(Math.random() * STUDY_TIPS.length)];
    return { text: `${C.tone() === "warm" ? "Here's one that genuinely works:\n" : ""}${t}` };
  }

  /* ---------- IB knowledge base — durable process facts (not subject tutoring) ---------- */
  function isKnowledgeQuestion(q) {
    return /\b(what('?s| is| are| does| counts)|whats|explain|how (does|do|many|much|is|are|long|hard)|tell me about|meaning of|define|what.?s the difference|difference between|do i (need|have to)|is it true|how('?s| does) it work|\bvs\b|versus|\brules?\b)\b/.test(q)
      || /\bmax(imum)? points\b|\bpass(ing)?\b|\bfail(ing)?\b|\baverage (ib )?score\b|\bgood (ib )?score\b|\bgrade boundaries?\b|\bhow (is|are).*(scored|graded|marked|assessed|calculated)\b|\bwhat.?s a (good|bad|1|2|3|4|5|6|7)\b/.test(q);
  }
  const IB_FACTS = [
    { re: /theory of knowledge|\btok\b/, text: `TOK (Theory of Knowledge) is a core course about how knowledge is built and justified across areas like the sciences, history and the arts. It's assessed two ways: a ~1,600-word essay on one of six prescribed titles (externally marked), and an exhibition of three real objects answering an "IA prompt" (internally marked). It's graded A–E and, combined with the EE, contributes up to 3 points to your total.` },
    { re: /extended essay|\bee\b/, text: `The Extended Essay is a ~4,000-word independent research paper in a subject you choose, guided by a supervisor over roughly 40 hours. It's marked A–E on five criteria (focus & method, knowledge & understanding, critical thinking, presentation, and engagement via the RPPF reflections). With TOK it earns up to 3 core points; an E is a failing condition.` },
    { re: /\bcas\b|creativity,? ?activity,? ?(and )?service/, text: `CAS (Creativity, Activity, Service) runs across ~18 months. It isn't graded and earns no points — but it's required for the diploma. You plan experiences across the three strands, keep a portfolio, write reflections, and evidence 7 learning outcomes (including one longer CAS project). Skip it and the diploma isn't awarded, even with great grades.` },
    { re: /grade boundaries?/, always: true, text: `Grade boundaries (the mark needed for each 1–7) are set per subject, per level, per exam session — they shift a little each year with paper difficulty, so there's no fixed universal number. Work to the mark scheme and past-paper marks rather than a target percentage; a 7 is often somewhere around the low-to-mid 80s%, but it genuinely varies.` },
    { re: /core points|tok ?\+? ?ee|ee ?\+? ?tok|bonus points/, text: `Your TOK and EE grades combine in a fixed matrix to award 0–3 "core" points on top of your six subjects. Two A's give the full 3; solid B/C work gives 1–2; and an E in either TOK or the EE is a failing condition that can cost the diploma regardless of your other grades. Your current combination is on the Grades page.` },
    { re: /internal assessment|\bia\b|\bias\b/, text: `An Internal Assessment (IA) is coursework your teacher sets and marks, then the IB moderates — a lab report, maths exploration, essay, oral, etc. It's usually worth 20–30% of that subject's grade. Because these are marks you lock in before the exams, doing them carefully and early is some of the highest-value work in the whole diploma.` },
    { re: /higher level|standard level|\bhl\b|\bsl\b/, text: `HL (Higher Level) subjects go deeper — ~240 teaching hours; SL (Standard Level) ~150. You normally take 3 at HL and 3 at SL across the six groups. HL courses have extra content and usually an extra exam paper, so they carry more of your revision load — worth weighting your study time toward them.` },
    { re: /subject groups?|six groups|\bgroup [1-6]\b/, text: `The six subject groups: 1) Studies in Language & Literature, 2) Language Acquisition, 3) Individuals & Societies (history, econ, psych, geography…), 4) Sciences, 5) Mathematics, 6) The Arts (or a second subject from groups 1–4). You take one from each — three HL, three SL — plus the three core elements: TOK, the EE and CAS.` },
    { re: /how (is|are).*(scored|graded|marked|calculated|assessed)|how many points|max(imum)? points|out of 45|scored out of|total points|out of how (many|much)|out of what|it out of/, text: `The diploma is out of 45: six subjects each graded 1–7 (max 42) plus up to 3 core points from TOK + EE. You generally need 24+ to pass, subject to conditions. Rough map: ~30 is around the global average, 38–40 is strong, and 40+ is excellent — the level top universities often ask for.` },
    { re: /pass|fail|requirements? to (pass|graduate)|conditions? (to|for)|diploma awarded/, text: `To be awarded the diploma you generally need: 24+ points; no grade 1 anywhere; no more than two 2s and no more than three 3s (or below); at least 12 points across HL and 9 across SL; TOK and EE not both very weak (and neither an E); and CAS complete. Miss any of these and it's individual subject certificates rather than the full diploma.` },
    { re: /retake|resit|re-?sit|redo.*(exam|subject)|november session|may session|improve.*(grade|subject) (in|by)/, always: true, text: `You can resit exams in a later session (the two main ones are May and November) to improve a subject grade — usually only your best result counts. IAs can sometimes be revised and resubmitted. If you narrowly miss the diploma, a single retake in your weakest subject is often all it takes.` },
    { re: /predicted grades?/, text: `Predicted grades are your teachers' formal estimate of your final 1–7 in each subject, sent to universities with your application, based on coursework, mocks and IAs. So strong IA and mock performance now directly shapes the offers you'll get. (This app's "predicted points" is your own working estimate, not the official one.)` },
    { re: /\bucas\b|uk (uni|universit|application)|firm (and|&|\/|or) insurance|conditional offer|unconditional/, text: `UK universities apply through UCAS: up to five choices, one personal statement, a reference and predicted grades. Offers are usually conditional on final IB points and often specific HL grades, e.g. "38 points with 6,6,6 at HL". You later pick a firm choice and a lower insurance choice. Track each course's conditions on the University page.` },
    { re: /\b(us|american) (uni|college|application)|common app|\bsat\b|\bact\b|early (decision|action)/, text: `US applications (usually the Common App) are holistic: transcript, essays, recommendations, activities, often SAT/ACT — plus your IB predicted grades. There's no single points cutoff like the UK. Strong IB rigour (lots of HL) and consistent grades help, and many colleges grant credit for HL 6–7s.` },
    { re: /academic (honesty|integrity|misconduct)|plagiaris|malpractice|collusion|cheating/, always: true, text: `Academic honesty is taken very seriously: plagiarism, collusion or unauthorised material in coursework or exams counts as malpractice and can void a grade or the whole diploma. Cite every source in your IA/EE, keep your work your own, and if you're unsure whether collaboration is allowed, ask your teacher first.` },
    { re: /access arrangement|extra time|inclusive|special (needs|arrangement)|dyslexi|adhd/, always: true, text: `The IB offers inclusive access arrangements (extra time, rest breaks, assistive tech, etc.) for students with a documented need — your school's coordinator applies in advance with evidence. If you think you'd qualify, raise it early; these aren't approved last-minute.` },
    { re: /bilingual diploma/, always: true, text: `A bilingual diploma is awarded if you complete two group-1 language & literature subjects in different languages, or a group-3/4 subject in a language other than your group-1 one, at the required standard — a nice extra credential if your language choices line up for it.` },
    { re: /world studies/, always: true, text: `A World Studies EE is an Extended Essay written across two subjects on an issue of global significance (health, the environment, migration…). Same A–E scale — a good fit if your research question genuinely spans two disciplines.` },
    { re: /grade 1\b|grade 2\b|grade 3\b|what (does|is) a? ?[1-7]\b|what.?s a [1-7]\b/, text: `Subjects are graded 1 (lowest) to 7 (highest): 7 excellent, 6 very good, 5 good, 4 satisfactory, 3 mediocre, 2 poor, 1 very poor. A grade 1 anywhere is an automatic failing condition, and too many 2s/3s can also stop the diploma — so lifting your weakest subject to a safe 3–4 can matter as much as chasing 7s.` },
    { re: /exam (session|timetable|dates)|when are (the )?exams|exam schedule/, text: `IB exams run in two sessions — May (larger, Northern hemisphere) and November (Southern). Each subject has fixed paper dates set by the IB and released as a timetable months ahead. Set your session's start date in Settings and I'll count down to it on your Dashboard.` },
  ];
  function knowledgeReply(q) {
    const isQ = isKnowledgeQuestion(q);
    for (const f of IB_FACTS) if ((f.always || isQ) && f.re.test(q)) { rememberTopic("knowledge"); return { text: f.text }; }
    return null;
  }

  function helpReply() {
    rememberTopic("help");
    return { text: [
      `I'm your built-in coach — fully offline, and I already know your tasks, deadlines, grades and habits.`,
      `Ask me things:`,
      `• "What should I work on now?" · "Plan my week" · "What's due tomorrow / this weekend?"`,
      `• "How's Chemistry going?" · "How are my grades?" · "What's my predicted score?"`,
      `• "Can I still hit 40?" · "What do I need to average?" · "If Chemistry goes to 6?" · "Am I passing?"`,
      `• "What is the EE?" · "How is the diploma scored?" · "What are the failing conditions?"`,
      `• "I'm stressed" · "Help me focus" · "Give me a study tip" · "How long until exams?"`,
      `Tell me to do things (you always confirm first):`,
      `• "Set all Physics tasks to high" · "Make my Math IA critical" · "Finish the chem worksheet"`,
      `• "Schedule my Math IA for tomorrow" · "Auto-schedule my week" · "Reschedule my overdue tasks"`,
      `• "Split my EE into 4" · "Add steps to my IA: intro, method, analysis" · "Clear my schedule"`,
      `• Paste a whole list of tasks and I'll add them at once.`,
      `And follow up naturally — "why?", "tell me more", "schedule it", "the second one".`,
    ].join("\n") };
  }

  /* ---------- coach, not tutor: subject-content questions → study strategy ---------- */
  function isAcademicHelp(q) {
    return /\b(explain|teach me|help me (understand|with|solve|do|revise|study|learn|write|plan|structure|start|tackle|approach|figure out|prep(are)?|get through|work on)|how (do|can|would) i (solve|do|find|calculate|work out|answer|prove|derive|integrat|differenti|balance|memori[sz]e|learn|understand|revise|study|tackle|approach|write|structure|start)|what (is|are|does|caused|happened)|why (does|do|is|are|did)|prove|solve|derive|calculate|summari[sz]e|walk me through|i don'?t (understand|get|know how)|struggling with|stuck on|confused (about|by|with)|don'?t understand|help (me )?with my)\b/.test(q);
  }
  function studyStrategyReply(q, a) {
    const subj = matchSubject(q);
    let bucket = "general";
    if (/\b(essay|write|writing|analy|argument|thesis|paragraph|commentary|discuss|evaluate|literatur|poem|poetry|prose|source|historiograph|context|quotation)\b/.test(q)) bucket = "essay";
    else if (/\b(solve|proof|prove|equation|integrat|differenti|calculat|deriv|formula|problem|algebra|trig|calculus|mechanic|kinematic|stoichiometr|titration|balance|graph|vectors?)\b/.test(q)) bucket = "problem";
    else if (/\b(vocab|conjugat|grammar|tense|speak|oral|listening|translat|fluenc|pronunc)\b/.test(q)) bucket = "language";
    else if (/\b(memori[sz]|remember|definition|terms|dates|list|recall|flashcard|quotes?)\b/.test(q)) bucket = "memorize";
    else if (subj) {
      const base = App.parseSubjectLevel(subj).base.toLowerCase();
      if (/math|physics|chem/.test(base)) bucket = "problem";
      else if (/english|literat|histor|econ|business|psycholog|geograph|philosoph|politic/.test(base)) bucket = "essay";
      else if (/french|spanish|german|mandarin|chinese|japanese|italian|language|\bab initio\b/.test(base)) bucket = "language";
    }
    const tips = {
      essay: [`• Learn the mark scheme first — essays are graded against fixed criteria, so write to hit each one.`, `• Build a bank of arguments, quotes and examples you can reuse, then practise planning essays in 5 minutes.`, `• Write timed answers and compare them to exemplars — feedback beats re-reading.`],
      problem: [`• Do problems, don't just read them — work past-paper questions and mark them against the scheme.`, `• Keep an "error log" of every mistake; that becomes your revision list.`, `• Re-derive key formulae from scratch so you understand them, not just memorise them.`],
      language: [`• Little and often: 15 min of active vocab (spaced repetition) daily beats one long weekly session.`, `• Speak and write it, don't just read — record yourself, shadow audio, use new words in sentences.`, `• Practise past-paper reading/listening under timed conditions and learn the command words.`],
      memorize: [`• Active recall: close the notes and write what you remember, then fill the gaps.`, `• Space your reviews (today, tomorrow, +3 days, +1 week) — that's when memory sticks.`, `• Condense each topic to one page; the act of condensing is where the learning happens.`],
      general: [`• Active recall over re-reading: quiz yourself and mark honestly.`, `• Space it across days and do past-paper questions against the mark scheme.`, `• Teach the topic out loud — if you can't explain it simply, that's the bit to review.`],
    };
    const opener = C.tone() === "warm"
      ? `I'm your study coach rather than a subject tutor, so I won't work the ${subj ? subj + " " : ""}content itself — but here's how to actually get on top of a topic like that:`
      : `Not a subject tutor — I won't do the ${subj ? subj + " " : ""}content. Here's how to crack it:`;
    const lines = [opener, ...tips[bucket]];
    let action = null;
    if (subj) {
      lines.push(`Want me to add a focused ${subj} study task so it's on your plan?`);
      action = buildAction([{ type: "create_tasks", payload: { tasks: [{ title: `Study session — ${subj}`, subject_name: subj, category: "subject_task", estimated_minutes: 45 }] } }]);
      rememberSubject(subj);
    } else {
      lines.push(`Tell me the subject and I can add a study task or block time for it.`);
    }
    rememberTopic("strategy", subj || null);
    return { text: lines.join("\n"), action };
  }

  /* ---------- grade-scenario maths (read-only projections) ---------- */
  function isGradeScenario(q) {
    return /\b(can i (still )?(get|hit|reach|make|score)|is (it |a )?\d+ (possible|achievable|realistic|doable)|what (do i|would i|will i) need|need to average|average (do|of|i)|if (i (get|got|score|scored)|my|.* (goes|gets|drops|rises|jumps|falls) (up |down )?to)|am i (passing|failing|on track to pass|going to (pass|fail))|will i (pass|fail)|most i can (get|score)|highest i can|best i can (get|score)|max(imum)? i can|reach my (goal|target)|hit my (goal|target)|good enough to (pass|get))\b/.test(q)
      || /\bwhat.*need.*(for|to (get|hit|reach|score))\s*\d+/.test(q);
  }
  function gradeScenarioReply(q, a) {
    const pp = App.predictedPoints();
    rememberTopic("scenario");
    if (!pp.gradesCount) return { text: `I need some grades first — add your current and target grades on the Grades page and I can run "can I still hit 40?" style scenarios for you.` };
    const N = pp.gradesCount;
    const s = App.state();
    const coreCeiling = pp.failing ? 0 : (pp.corePoints != null ? pp.corePoints : 3);
    const ceiling = N * 7 + coreCeiling;

    // hypothetical: "if I get 6 in chemistry" / "if chemistry goes to 6"
    const hypo = q.match(/if (?:i (?:get|got|score|scored)\s*(?:a\s*)?([1-7])\s*(?:in|for|on)\s*(.+?)$|(.+?)\s*(?:goes|gets|rises|jumps|drops|falls|goes up|goes down)\s*(?:up|down)?\s*to\s*(?:a\s*)?([1-7]))/);
    if (hypo) {
      const grade = parseInt(hypo[1] || hypo[4], 10);
      const subjPhrase = (hypo[2] || hypo[3] || "").trim();
      const subj = matchSubject(subjPhrase);
      if (subj && grade >= 1 && grade <= 7) {
        const g = s.grades.find((x) => x.subject_name === subj);
        if (!g) return { text: `You don't have a grade recorded for ${subj} yet — add it on the Grades page and I'll factor it in.` };
        const delta = grade - (g.current_grade || 0);
        rememberSubject(subj);
        return { text: `If ${subj} went from ${g.current_grade} to ${grade}, your predicted total would ${delta === 0 ? "stay at" : delta > 0 ? "rise to" : "fall to"} ${pp.totalPoints + delta}/${pp.maxPoints} (${delta > 0 ? "+" : ""}${delta} point${Math.abs(delta) === 1 ? "" : "s"}).` };
      }
    }

    const goalM = q.match(/\b(2[4-9]|3\d|4[0-5])\b/); // a plausible IB total 24–45
    const target = goalM ? parseInt(goalM[1], 10) : (s.settings.target_points || 40);

    if (/average/.test(q)) {
      const needSubjectPts = target - coreCeiling;
      const needAvg = needSubjectPts / N;
      const curAvg = (pp.subjectPoints / N).toFixed(1);
      if (needAvg > 7) return { text: `To reach ${target} you'd need to average ${needAvg.toFixed(1)} across your ${N} subjects — above the maximum of 7, so ${target} isn't reachable with ${N} graded subjects${pp.failing ? " and your current TOK/EE" : ""}. Your realistic ceiling is ${ceiling}.` };
      return { text: `To reach ${target} points you'd need to average about ${needAvg.toFixed(1)}/7 across your ${N} subjects (on top of your ${coreCeiling} core point${coreCeiling === 1 ? "" : "s"}). You're currently averaging ${curAvg}.` };
    }
    if (/pass|fail/.test(q)) {
      const passes = pp.totalPoints >= 24 && !pp.failing;
      const lines = [`Predicted total: ${pp.totalPoints}/${pp.maxPoints}. The bar is 24+ with no failing conditions.`];
      if (pp.failing) lines.push(`⚠ Your TOK/EE combination is currently a failing condition — that has to be fixed regardless of points.`);
      lines.push(passes ? `On these numbers you're passing — keep it steady.` : (pp.totalPoints < 24 ? `You're ${24 - pp.totalPoints} point${24 - pp.totalPoints === 1 ? "" : "s"} short of 24 — lifting your weakest subject is the fastest fix.` : `You're above 24 on points; just clear the failing condition.`));
      return { text: lines.join("\n") };
    }
    if (/most|highest|best|max(imum)?|ceiling/.test(q) && !goalM) {
      return { text: `Your realistic ceiling is ${ceiling}/${pp.maxPoints} — every graded subject at 7 plus ${coreCeiling} core point${coreCeiling === 1 ? "" : "s"}. You're predicted ${pp.totalPoints} now, so there's ${ceiling - pp.totalPoints} point${ceiling - pp.totalPoints === 1 ? "" : "s"} of headroom.` };
    }
    // default: "can I still hit <target>?"
    if (target <= ceiling) {
      const gap = target - pp.totalPoints;
      if (gap <= 0) return { text: `Yes — you're already predicted ${pp.totalPoints}, at or above ${target}. Now it's about defending it: hold your strongest subjects and don't let any slip.` };
      const room = s.grades.map((g) => ({ name: g.subject_name, room: 7 - (g.current_grade || 0) })).filter((x) => x.room > 0).sort((x, y) => y.room - x.room);
      const where = room.length ? ` The most headroom is in ${room.slice(0, 3).map((x) => `${x.name} (+${x.room})`).join(", ")}.` : "";
      return { text: `Yes — ${target} is still reachable. You're at ${pp.totalPoints} and need ${gap} more point${gap === 1 ? "" : "s"}; your ceiling is ${ceiling}.` + where };
    }
    return { text: `${target} would need ${target}/${pp.maxPoints}, but your ceiling right now is ${ceiling} (every subject at 7 plus ${coreCeiling} core). To go higher you'd need more graded subjects or a stronger TOK/EE. You're predicted ${pp.totalPoints} today.` };
  }

  /* ---------- one task's status ---------- */
  function taskDetailReply(t, a) {
    rememberTasks([t]);
    rememberTopic("task", t.id);
    const map = App.taskMap();
    const status = t.completed ? "completed" : App.isOverdue(t) ? `overdue (was due ${D.fmtMed(t.due_date)})`
      : t.due_date ? `due ${D.fmtMed(t.due_date)} · ${D.diffDays(a.today, t.due_date)} day${D.diffDays(a.today, t.due_date) === 1 ? "" : "s"} away` : "no due date set";
    const meta = [App.CATEGORIES[t.category] ? App.CATEGORIES[t.category].label : null, `${t.priority} priority`, status, t.estimated_minutes ? `~${fmtMin(t.estimated_minutes)}` : null].filter(Boolean).join(" · ");
    const lines = [`“${t.title}”${t.subject_name ? ` — ${t.subject_name}` : ""}`, meta];
    const blocks = (t.scheduled_blocks || []).slice().sort((x, y) => x.date.localeCompare(y.date) || x.start_min - y.start_min);
    if (blocks.length) lines.push(`Scheduled: ${D.fmtMed(blocks[0].date)} at ${D.minToLabel(blocks[0].start_min)} (${fmtMin(blocks[0].duration)})${blocks.length > 1 ? `, +${blocks.length - 1} more session${blocks.length - 1 === 1 ? "" : "s"}` : ""}.`);
    else if (!t.completed) lines.push(`Not on your calendar yet.`);
    if (App.isLocked(t, map)) { const p = map.get(t.predecessor_id); lines.push(`Locked until you finish ${p ? `“${p.title}”` : "its predecessor"}.`); }
    const subs = App.subtasksOf(t.id);
    if (subs.length) lines.push(`Sub-tasks: ${subs.filter((x) => x.completed).length}/${subs.length} done.`);
    let action = null;
    if (!t.completed && !blocks.length) {
      action = buildAction([{ type: "schedule_task", payload: { task_id: t.id, date: t.due_date && t.due_date >= a.today ? t.due_date : a.today } }]);
      if (action) lines.push(`Want me to schedule it?`);
    }
    return { text: lines.join("\n"), action };
  }

  /* ---------- time-management coaching (grounded in capacity) ---------- */
  function timeManagementReply(a) {
    rememberTopic("time");
    const s = App.state();
    const weekly = App.DAY_KEYS.reduce((sum, k) => sum + (Number((s.settings.hours_per_day || {})[k]) || 0), 0);
    const dueLoad = [...a.dueWeek, ...a.overdue].reduce((sum, t) => sum + (t.estimated_minutes || 0), 0);
    const lines = [C.tone() === "warm" ? `Time management really comes down to three habits: plan the week, protect focused blocks, and review.` : `Three levers: plan the week, protect blocks, review.`];
    if (weekly) lines.push(`Your settings give ~${weekly}h of study capacity a week. This week's due + overdue work is about ${fmtMin(dueLoad)} of estimated effort${dueLoad > weekly * 60 ? " — that's tight, so triage hard by deadline and weighting." : dueLoad ? " — comfortably inside capacity if you start early." : "."}`);
    lines.push(`• Run Auto-Schedule so tasks land around your classes and free hours automatically.`);
    lines.push(`• Work in focused 25–50 min blocks (Study Session / Pomodoro), one task at a time.`);
    lines.push(`• Front-load IAs and the EE — they're big and marked before the exams.`);
    let action = a.unscheduledSoon.length ? buildAction([{ type: "run_auto_schedule", payload: {} }]) : null;
    if (action) lines.push(`Want me to auto-schedule this week now?`);
    return { text: lines.join("\n"), action };
  }

  /* ---------- motivation / wellbeing extras ---------- */
  function motivationReply(a) {
    rememberTopic("motivation");
    const lines = [C.tone() === "warm" ? `You've got this — and you're further along than it feels.` : `Enough doubt. Here's the reality.`];
    if (a.completed7) lines.push(`In the last 7 days you finished ${a.completed7} task${a.completed7 === 1 ? "" : "s"} and studied ${fmtMin(a.focus7)} — that's momentum, not luck.`);
    if (a.streak > 1) lines.push(`${a.streak} days in a row studying — that streak is proof you can do this.`);
    lines.push(a.topPriority ? `The trick isn't motivation, it's starting. Do one thing now: ${a.topPriority.title}. Just 25 minutes.` : `The trick isn't motivation, it's starting. Pick one task, give it 25 minutes.`);
    lines.push(C.tone() === "warm" ? `Motivation follows action, not the other way round. Start small and it shows up.` : `Motivation follows action. Start.`);
    if (a.topPriority) rememberTasks([a.topPriority]);
    return { text: lines.join("\n") };
  }
  function sleepReply(a) {
    rememberTopic("sleep");
    const lines = [C.tone() === "warm" ? `Short version: sleep is part of studying, not a break from it.` : `Sleep. Not optional.`];
    lines.push(`• An all-nighter usually costs more marks than the extra hours earn — memory consolidates while you sleep.`);
    lines.push(`• Better to study hard to a sane cut-off, sleep 7–8 hours, and review in the morning.`);
    lines.push(`• Cramming tonight? Do active recall on your weakest topics, not passive re-reading — then stop and rest.`);
    const ex = App.state().settings.exam_date;
    if (ex && D.diffDays(a.today, ex) >= 0 && D.diffDays(a.today, ex) <= 2) lines.push(`With exams this close, protecting sleep is one of the highest-value things you can do.`);
    return { text: lines.join("\n") };
  }
  function reassuranceReply(a, kind) {
    rememberTopic("reassurance");
    const lines = [];
    if (kind === "compare") {
      lines.push(C.tone() === "warm" ? `Comparison is a trap — you only see other people's highlight reel, not their struggle.` : `Stop comparing. You see their results, not their reality.`);
      lines.push(`The only useful comparison is you vs. you last week.${a.focus7 ? ` This week: ${fmtMin(a.focus7)} studied, ${a.completed7} done — that's your race.` : ""}`);
    } else {
      lines.push(C.tone() === "warm" ? `Done beats perfect. A finished B-grade essay scores more than a flawless one still in your head.` : `Perfect is the enemy of done. Ship it.`);
      lines.push(`Set a time limit per task, hit "good enough", move on — refine later only if it matters.`);
    }
    if (a.quickWin) { lines.push(`Prove it with one small win now: ${a.quickWin.title} (${fmtMin(a.quickWin.estimated_minutes)}).`); rememberTasks([a.quickWin]); }
    return { text: lines.join("\n") };
  }

  /* ---------- follow-ups: "why", "tell me more", "schedule it", "the second one" ---------- */
  function deepen(a) {
    switch (convo.topic) {
      case "plan": case "tomorrow": case "week": case "weekend": {
        const lines = [`The reasoning: I rank by deadline first (overdue, then soonest), then by priority, and I flag anything not yet on your calendar.`];
        if (a.overdue.length) lines.push(`Overdue work drags on everything, so it comes first — clearing even one lightens the whole week.`);
        if (a.unscheduledSoon.length) lines.push(`${a.unscheduledSoon.length} task${a.unscheduledSoon.length === 1 ? " is" : "s are"} due within a week but unscheduled — those are the real risk, which is why I keep offering to schedule them.`);
        lines.push(`Want me to auto-schedule the week, or dig into a specific subject?`);
        return { text: lines.join("\n"), action: a.unscheduledSoon.length ? buildAction([{ type: "run_auto_schedule", payload: {} }]) : null };
      }
      case "grades": case "predicted": case "scenario": {
        const pp = App.predictedPoints();
        if (!pp.gradesCount) return { text: `Nothing more to break down yet — add grades on the Grades page first.` };
        const lines = [`The maths: six subjects give up to 42 (each 1–7) plus 0–3 core points from TOK+EE. You're at ${pp.subjectPoints} from subjects${pp.corePoints != null ? ` and ${pp.corePoints} core` : ""}, so ${pp.totalPoints}/${pp.maxPoints}.`];
        const gaps = a.gradeGaps.slice(0, 3);
        lines.push(gaps.length ? `Biggest gains sit where the gap to target is largest: ${gaps.map((g) => `${g.subject} (+${g.gap})`).join(", ")} — one grade there is one whole point on your total.` : `No subject is below target, so the play is defending what you have.`);
        return { text: lines.join("\n") };
      }
      case "subject": { const name = convo.topicArg || convo.subject; if (name) return subjectReply(a, name); return null; }
      case "stats": return statsReply(a);
      case "exam": return examCountdownReply();
      case "core": return coreReply(a, convo.topicArg || "extended_essay");
      case "task": { const t = convo.topicArg && App.taskById(convo.topicArg); return t ? taskDetailReply(t, a) : null; }
      default: return null;
    }
  }
  const ORDINALS = { first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2, fourth: 3, "4th": 3, fifth: 4, "5th": 4, last: -1 };
  // Returns {task, strong}: ordinals ("the second one") are strong referents;
  // bare pronouns ("it", "that one") are weak and need a task verb to act on.
  function referentFromMemory(q) {
    if (!convo.taskIds.length) return null;
    let idx = null, strong = false;
    const numM = q.match(/(?:#|number\s+|task\s+)(\d+)/) || q.match(/\bthe\s+(\d+)(?:st|nd|rd|th)?\b/);
    if (numM) { idx = parseInt(numM[1], 10) - 1; strong = true; }
    if (idx === null) { for (const w in ORDINALS) { if (new RegExp(`\\b${w}\\b`).test(q)) { idx = ORDINALS[w]; strong = true; break; } } }
    if (idx === null && /\b(it|that one|this one|that task|the task|them|those)\b/.test(q) && q.split(/\s+/).length <= 8) idx = 0;
    if (idx === null) return null;
    if (idx === -1 || idx >= convo.taskIds.length) idx = convo.taskIds.length - 1;
    if (idx < 0) idx = 0;
    const t = App.taskById(convo.taskIds[idx]);
    return t ? { task: t, strong } : null;
  }
  function resolveFollowUp(text, a) {
    const q = text.toLowerCase().trim();
    if (!q) return null;
    // "why / how come / tell me more / more / go on / elaborate / explain that"
    if (/^(why\??|why is that\??|how come\??|how so\??|explain( that| more)?\??|tell me more|more( please| detail)?\??|go on|elaborate|in more detail|expand( on that)?\??|and\??|so\?|meaning\??)$/.test(q)
      || /\b(tell me more|more detail|in more detail|elaborate on that|expand on that|explain that further|why is that)\b/.test(q)) {
      const d = deepen(a);
      if (d) return d;
    }
    const ref = referentFromMemory(q);
    if (!ref) return null;
    const t = ref.task;
    const hasTaskVerb = /\b(schedule|book|calendar|plan (it|that|this)|done|complete|completed|finish|finished|tick|check off|delete|remove|bin|get rid|unschedule|reschedule|move|push|when|due|deadline|how long|status|estimate|priority|high|low|critical|medium|tell me about|details?)\b/.test(q);
    if (!ref.strong && !hasTaskVerb) return null; // weak "it" with no task intent → let normal dispatch handle
    if (/\b(schedule|book|put (it|that|them) (on|in)|add (it|that|them)|calendar|plan (it|that|this))\b/.test(q)) {
      const date = parseDateToken(q) || (t.due_date && t.due_date >= a.today ? t.due_date : a.today);
      const action = buildAction([{ type: "schedule_task", payload: { task_id: t.id, date } }]);
      if (action) return { text: `Sure — scheduling “${t.title}”:`, action };
    }
    if (/\b(done|complete|completed|finish|finished|tick|check off)\b/.test(q)) {
      const action = buildAction([{ type: "update_tasks", payload: { task_ids: [t.id], changes: { completed: true } } }]);
      if (action) return { text: `Marking “${t.title}” complete:`, action };
    }
    if (/\b(delete|remove|bin|get rid)\b/.test(q)) {
      const action = buildAction([{ type: "delete_tasks", payload: { task_ids: [t.id] } }]);
      if (action) return { text: `Careful — deleting “${t.title}” for good:`, action };
    }
    // otherwise the student is just referring to one task — show its detail
    return taskDetailReply(t, a);
  }

  /* ---------- never-fail fallback ---------- */
  function richFallback(text, a) {
    const q = text.toLowerCase();
    const subj = matchSubject(q);
    if (subj) return subjectReply(a, subj);
    const date = parseDateToken(q);
    if (date) {
      const items = a.open.filter((t) => t.due_date === date);
      const planned = App.scheduledBlocksOn(date).filter(({ task }) => !task.completed);
      const lines = [`${D.fmtLong(date)}:`];
      if (items.length) items.slice(0, 6).forEach((t) => lines.push(taskLine(t))); else lines.push(`• nothing due`);
      if (planned.length) { lines.push(`Scheduled:`); planned.slice(0, 6).forEach(({ task, block }) => lines.push(`• ${D.minToLabel(block.start_min)} — ${task.title}`)); }
      rememberTasks(items);
      return { text: lines.join("\n") };
    }
    const task = fuzzyFindTask(text);
    if (task) return taskDetailReply(task, a);
    const bits = [];
    if (a.overdue.length) bits.push(`${a.overdue.length} overdue`);
    if (a.dueToday.length) bits.push(`${a.dueToday.length} due today`);
    if (a.dueWeek.length) bits.push(`${a.dueWeek.length} due this week`);
    const head = C.tone() === "warm"
      ? `I'm not totally sure what you meant — but here's where you stand: ${bits.length ? `${bits.join(", ")}, ${a.openCount} open in total` : `${a.openCount} open task${a.openCount === 1 ? "" : "s"}, nothing pressing`}.`
      : `Didn't quite parse that. Status: ${bits.length ? bits.join(", ") : `${a.openCount} open, nothing pressing`}.`;
    rememberTopic("plan");
    rememberTasks([a.topPriority, ...a.overdue, ...a.dueToday].filter(Boolean));
    return { text: [
      head,
      `Try one of these:`,
      `• "What should I work on now?" · "Plan my week" · "What's due tomorrow?"`,
      `• "How's ${a.subjects[0] || "Chemistry"} going?" · "How are my grades?" · "Can I still hit 40?"`,
      `• "I'm stressed" · "Help me focus" · "How long until exams?" · "What is the EE?"`,
      `• Or ask me to do something: "reschedule my overdue tasks", "auto-schedule my week", "clear my schedule", "split my EE into 4".`,
    ].join("\n") };
  }

  /* ============================================================
     Offline engine — command parser
     ============================================================ */
  function subjectKeys(name) {
    const lower = name.toLowerCase();
    const words = lower.split(/\s+/);
    const initials = words.filter((w) => w !== "hl" && w !== "sl").map((w) => w[0]).join("");
    const keys = [lower];
    const level = words.find((w) => w === "hl" || w === "sl");
    if (initials.length >= 2) {
      keys.push(initials);
      if (level) keys.push(initials + level, initials + " " + level);
    }
    return keys;
  }

  const CATEGORY_KEYS = [
    ["extended essay", "extended_essay"], ["ee", "extended_essay"],
    ["theory of knowledge", "tok"], ["tok", "tok"],
    ["cas", "cas"],
    ["internal assessment", "ia"], ["ia", "ia"],
    ["exam prep", "exam_prep"], ["exam", "exam_prep"], ["revision", "exam_prep"],
    ["university", "university_application"], ["uni", "university_application"],
  ];

  // phrase → {tasks, label} | null
  function resolveScope(phrase) {
    const p = (phrase || "").toLowerCase().replace(/\b(my|the|all|of|pending|open|incomplete|unfinished|remaining|active|current)\b/g, " ").replace(/\s+/g, " ").trim();
    const a = C.analyze();
    if (!p || p === "tasks" || p === "task") return { tasks: a.open, label: "all open tasks" };
    if (/\boverdue\b/.test(p)) return { tasks: a.overdue, label: "overdue tasks" };
    if (/\b(today|today's)\b/.test(p)) return { tasks: a.dueToday, label: "tasks due today" };
    if (/\bcompleted?\b|\bdone\b/.test(p)) return { tasks: App.state().tasks.filter((t) => t.completed), label: "completed tasks" };
    // subject by full name, base word ("chemistry"), or abbreviation ("bm")
    const subj = matchSubject(p);
    if (subj) return { tasks: a.open.filter((t) => t.subject_name === subj), label: `${subj} tasks` };
    for (const [key, cat] of CATEGORY_KEYS) {
      if (new RegExp(`(^|\\b)${key}(\\b|$)`).test(p)) {
        return { tasks: a.open.filter((t) => t.category === cat), label: `${App.CATEGORIES[cat].label} tasks` };
      }
    }
    return null;
  }

  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const monthIndex = (s) => ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(s.slice(0, 3));
  function parseDateToken(str) {
    const p = (str || "").toLowerCase().trim();
    const today = D.today();
    if (/^today$/.test(p) || /\btoday\b/.test(p)) return today;
    if (/^tomorrow$/.test(p) || /\btomorrow\b/.test(p)) return D.addDays(today, 1);
    if (/\bnext week\b/.test(p)) return D.addDays(today, 7);
    const iso = p.match(/\d{4}-\d{2}-\d{2}/);
    if (iso) return iso[0];
    // month-name dates: "August 9", "Aug 9th", "9 August", "aug 9 2027"
    let mo = p.match(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`));
    let mi = -1, day = 0, yr = null;
    if (mo) { mi = monthIndex(mo[1]); day = parseInt(mo[2]); yr = mo[3] ? parseInt(mo[3]) : null; }
    else {
      const mo2 = p.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?`));
      if (mo2) { day = parseInt(mo2[1]); mi = monthIndex(mo2[2]); yr = mo2[3] ? parseInt(mo2[3]) : null; }
    }
    if (mi >= 0 && day >= 1 && day <= 31) {
      const now = D.parse(today);
      let d = new Date(yr || now.getFullYear(), mi, day);
      if (!yr && D.toStr(d) < today) d = new Date(now.getFullYear() + 1, mi, day); // roll to next year if already past
      return D.toStr(d);
    }
    for (let i = 0; i < 7; i++) {
      if (p.includes(WEEKDAYS[i])) {
        let delta = (i - D.dayOfWeek(today) + 7) % 7;
        if (delta === 0) delta = 7; // "monday" said on a Monday = next Monday
        return D.addDays(today, delta);
      }
    }
    return null;
  }

  function fuzzyFindTask(phrase) {
    const p = phrase.toLowerCase().trim();
    if (!p) return null;
    const open = App.state().tasks.filter((t) => !t.completed);
    let best = null, bestScore = 0;
    for (const t of open) {
      const title = t.title.toLowerCase();
      let score = 0;
      if (title === p) score = 100;
      else if (title.includes(p)) score = 80;
      else if (p.includes(title)) score = 70;
      else {
        const words = p.split(/\s+/).filter((w) => w.length > 2);
        if (words.length) {
          const hit = words.filter((w) => title.includes(w)).length;
          score = Math.round((hit / words.length) * 60);
        }
      }
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return bestScore >= 40 ? best : null;
  }

  function parseTaskLine(line) {
    // strip a leading list marker: bullet chars, or a "1." / "1)" numbered marker
    // that is FOLLOWED BY A SPACE — so a topic code like "1.7.1" is left intact.
    let text = line.replace(/^\s*(?:[-*•‣▪]\s*|\d+[.)]\s+)/, "").trim();
    if (!text || text.length < 3) return null;
    const spec = {};
    // priority keyword first, so it isn't swallowed by the due-date capture
    const priM = text.match(/\b(low|medium|high|critical)\s*(?:priority|prio)\b/i);
    if (priM) {
      spec.priority = priM[1].toLowerCase();
      text = text.replace(priM[0], "").replace(/\s{2,}/g, " ").trim();
    }
    // trailing estimate "30m" / "1.5h" / "45 min" — before the due capture,
    // so "due friday 2h" keeps both parts
    const estM = text.match(/[,;(\s]+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)[)\s]*$/i);
    if (estM) {
      const n = parseFloat(estM[1]);
      spec.estimated_minutes = /^h/.test(estM[2].toLowerCase()) ? Math.round(n * 60) : Math.round(n);
      text = text.slice(0, estM.index).trim();
    }
    // "due <date>" / "by <date>" at the end
    const dueM = text.match(/[,;(\s]+(?:due|by|deadline)[:\s]+([^,;)]+)[)\s]*$/i);
    if (dueM) {
      const d = parseDateToken(dueM[1]);
      if (d) { spec.due_date = d; text = text.slice(0, dueM.index).trim(); }
    }
    // subject match
    for (const name of App.state().subjects.map((x) => x.name)) {
      if (text.toLowerCase().includes(name.toLowerCase())) { spec.subject_name = name; break; }
    }
    // drop any trailing separator left behind (e.g. the "–" in "Loans – 13 min")
    spec.title = text.replace(/[\s,;:–—-]+$/, "").trim();
    return spec.title ? spec : null;
  }

  // Global attributes stated once for a whole pasted list, e.g.
  // "add these to the subject Math AI HL with priority high and due date Aug 1".
  function parseGlobalAttrs(instruction) {
    const out = {};
    const q = (instruction || "");
    if (!q.trim()) return out;
    const ql = q.toLowerCase();

    const priM = ql.match(/\b(?:priority|prio)\s+(low|medium|high|critical)\b/) || ql.match(/\b(low|medium|high|critical)\s+(?:priority|prio)\b/);
    if (priM) out.priority = priM[1];

    const dueM = q.match(/\bdue(?:\s+date)?\b[:\s]+(?:on\s+)?([^.,;]+)/i) || q.match(/\bby\b[:\s]+([^.,;]+)/i);
    if (dueM) { const d = parseDateToken(dueM[1]); if (d) out.due_date = d; }
    else { const d = parseDateToken(q); if (d) out.due_date = d; }

    // subject: prefer the longest existing subject whose name appears in the text;
    // otherwise pull the phrase after "subject …" so we can flag/create it.
    let best = null;
    for (const name of App.state().subjects.map((x) => x.name)) {
      if (name && ql.includes(name.toLowerCase()) && (!best || name.length > best.length)) best = name;
    }
    if (best) { out.subject_name = best; out.subjectExists = true; }
    else {
      const sm = q.match(/\bsubject\b[:\s]+(.+?)(?=\s+(?:with|and|priority|prio|due|by)\b|[.,;]|$)/i);
      if (sm) { const nm = sm[1].trim(); if (nm) { out.subject_name = nm; out.subjectExists = false; } }
    }
    return out;
  }

  /* ---------- adding one task, said as a sentence -------------------------
     "add a task called 'homework' to spanish, medium priority, 3 hours".

     This is the single most common thing anyone asks a study coach to do, and
     it used to fail completely. The pasted-list route strips its own cue line
     ("add these tasks:") before parsing, so a ONE-line request left nothing
     behind and the route never fired. With no other handler for it, the
     message fell through to the subject lookup, which saw the word "spanish"
     and cheerfully answered a question nobody asked: "Spanish B SL: 0 open
     tasks". Looking like it understood while doing something unrelated is
     worse than admitting it didn't.

     Attributes are pulled out first and removed from the string, so whatever
     survives is the title. Order matters: estimate before due date (so "3
     hours" isn't read as a date), and quotes before everything (an explicit
     title wins over any guessing). */
  const ADD_INTENT = /^\s*(?:can you|could you|please|hey,?)?\s*(?:add|create|make|new|put in|note down|remind me to)\b/i;

  function parseSingleAddTask(text) {
    if (!ADD_INTENT.test(text)) return null;
    if (/\n/.test(text.trim())) return null;          // multi-line is the list route's job
    if (/\b(sub-?tasks?|steps?|checklist)\b/i.test(text)) return null; // add_subtasks owns these

    let rest = text.trim();
    const spec = {};

    // An explicitly quoted title is authoritative.
    let title = null;
    const quoted = rest.match(/["“'']([^"“”'']{2,})["”'']/);
    if (quoted) { title = quoted[1].trim(); rest = rest.replace(quoted[0], " "); }

    // Subject, before the words get eaten by anything else.
    const subject = matchSubject(rest);
    if (subject) {
      spec.subject_name = subject;
      // Remove the phrase that named it, so "to spanish" doesn't end up in the
      // title. Both the full name and the bare word people actually type.
      const base = App.parseSubjectLevel(subject).base;
      for (const word of [subject, base, ...base.split(/\s+/).filter((w) => w.length >= 4)]) {
        rest = rest.replace(new RegExp(`\\b(?:to|for|in|under)\\s+${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ");
        rest = rest.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ");
      }
    }

    // Priority, with or without the word "priority".
    const pri = rest.match(/\b(low|medium|high|critical)\b(?:\s*(?:priority|prio))?/i);
    if (pri) { spec.priority = pri[1].toLowerCase(); rest = rest.replace(pri[0], " "); }

    // Estimate. Handles "3 hours", "90 min", "2h", and the verb forms people
    // use in a sentence ("will take two hours", "takes 45 minutes").
    const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5 };
    const est = rest.match(/(?:\b(?:will\s+)?takes?\s+(?:about\s+|around\s+)?)?\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i);
    if (est) {
      const raw = est[1].toLowerCase();
      const n = WORD_NUM[raw] !== undefined ? WORD_NUM[raw] : parseFloat(raw);
      spec.estimated_minutes = /^h/i.test(est[2]) ? Math.round(n * 60) : Math.round(n);
      rest = rest.replace(est[0], " ");
    }

    // Due date, after the estimate so "3 hours" is already gone.
    const dueM = rest.match(/\b(?:due|by|before|deadline)\b[:\s]*(?:on\s+)?([a-z0-9 ,/-]{2,24})/i);
    if (dueM) {
      const d = parseDateToken(dueM[1]);
      if (d) { spec.due_date = d; rest = rest.replace(dueM[0], " "); }
    } else {
      const loose = rest.match(/\b(today|tomorrow|tonight|next week|this weekend)\b/i);
      if (loose) { const d = parseDateToken(loose[1]); if (d) { spec.due_date = d; rest = rest.replace(loose[0], " "); } }
    }

    // Whatever is left, once the scaffolding words go, is the title.
    if (!title) {
      title = rest
        .replace(ADD_INTENT, " ")
        .replace(/\b(?:a|an|the)\s+(?:new\s+)?task\b(?:\s+(?:called|named|titled|for|to))?/gi, " ")
        .replace(/\b(?:task|it is|it will|it should|and|with|priority|prio)\b/gi, " ")
        .replace(/[.,;:!?]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
    // Trim leftover connectives from either end.
    title = title.replace(/^(?:called|named|titled|to|for|in|under|of)\s+/i, "")
                 .replace(/\s+(?:to|for|in|under|and|with)$/i, "")
                 .trim();

    if (!title || title.length < 2) return { needsTitle: true, spec };
    spec.title = title;
    return { spec };
  }

  // returns {text, action?} when the message is a command, else null
  function parseCommand(text) {
    const q = text.toLowerCase();
    let m; // shared regex-match scratch, reused across the command routes below

    // pasted list of tasks (3+ list-ish lines, or 2+ after an "add these" cue)
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const addCue = /\b(add|create|put in|enter)\b.*\btasks?\b/i.test(lines[0] || "");
    const listLines = lines.filter((l, i) => !(i === 0 && addCue));
    if ((listLines.length >= 3 || (addCue && listLines.length >= 1)) && listLines.every((l) => l.length <= 200)) {
      const specs = listLines.map(parseTaskLine).filter(Boolean);
      if (specs.length >= (addCue ? 1 : 3)) {
        // attributes stated once for the whole list (subject / priority / due date)
        const globals = parseGlobalAttrs(addCue ? lines[0] : "");
        specs.forEach((spec) => {
          if (globals.subject_name) spec.subject_name = globals.subject_name; // authoritative for "add all to subject X"
          if (globals.priority && !spec.priority) spec.priority = globals.priority;
          if (globals.due_date && !spec.due_date) spec.due_date = globals.due_date;
        });
        const action = buildAction([{ type: "create_tasks", payload: { tasks: specs } }]);
        if (action) {
          const bits = [];
          if (globals.subject_name) bits.push(`subject ${globals.subject_name}`);
          if (globals.priority) bits.push(`${globals.priority} priority`);
          if (globals.due_date) bits.push(`due ${D.fmtShort(globals.due_date)}`);
          const attrs = bits.length ? ` (${bits.join(", ")})` : "";
          const count = specs.length === 1 ? "this task" : `these ${specs.length} tasks`;
          let text = `I can add ${count}${attrs} for you — look right?`;
          if (globals.subject_name && globals.subjectExists === false) {
            const have = App.state().subjects.map((x) => x.name);
            text = `Heads up: “${globals.subject_name}” isn't one of your subjects yet${have.length ? ` (you have: ${have.join(", ")})` : ""}. Confirm and I'll create it, then add ${specs.length === 1 ? "the task" : `all ${specs.length} tasks`} under it${globals.priority || globals.due_date ? ` (${bits.filter((b) => !b.startsWith("subject")).join(", ")})` : ""} — or tell me the right subject and I'll redo it.`;
          }
          return { text, action };
        }
      }
    }

    // auto-schedule
    if (/\bauto[- ]?schedul/.test(q) || /\bschedule (my|the) week\b/.test(q) || /\bplan my week for me\b/.test(q)) {
      const action = buildAction([{ type: "run_auto_schedule", payload: {} }]);
      return action
        ? { text: `I can auto-schedule the week for you:`, action }
        : { text: `Everything is already scheduled — nothing for Auto-Schedule to place.` };
    }

    // reschedule / spread out overdue tasks (no target date needed)
    if (/(reschedul|re-?schedul|spread|redistribut|sort out|catch up|deal with|push back|push out|move|fix|sort my|handle)/.test(q) && /\boverdue\b/.test(q) && !parseDateToken(q)) {
      const action = buildAction([{ type: "reschedule_overdue", payload: {} }]);
      return action ? { text: `I can spread your overdue tasks across the coming week — most urgent first:`, action } : { text: `You have no overdue tasks — nothing to reschedule.` };
    }

    // clear the whole schedule
    if (/\b(clear|reset|wipe|empty|start over on)\b.*\b(schedule|calendar|planner|timetable)\b/.test(q) || /\bunschedule (everything|all|all (my )?tasks?)\b/.test(q)) {
      const action = buildAction([{ type: "clear_schedule", payload: {} }]);
      return action ? { text: `I can clear the calendar — nothing gets deleted, tasks just go back to the unscheduled list:`, action } : { text: `Nothing is scheduled right now — the calendar's already clear.` };
    }

    // unschedule a single task: "unschedule X" / "take X off the calendar"
    let unschedPhrase = null;
    let um = q.match(/\bunschedule\s+(.+)$/);
    if (um) unschedPhrase = um[1];
    else { um = q.match(/\btake\s+(.+?)\s+off (?:my |the )?(?:schedule|calendar)\b/) || q.match(/\bremove\s+(.+?)\s+from (?:my |the )?(?:schedule|calendar)\b/); if (um) unschedPhrase = um[1]; }
    if (unschedPhrase && !/\b(everything|all)\b/.test(unschedPhrase)) {
      const task = fuzzyFindTask(unschedPhrase.replace(/\bmy\b/g, " ").trim());
      if (task && (task.scheduled_blocks || []).length) {
        const action = buildAction([{ type: "unschedule_tasks", payload: { task_ids: [task.id] } }]);
        return { text: `Taking “${task.title}” off the calendar:`, action };
      }
      if (task) return { text: `“${task.title}” isn't on the calendar, so there's nothing to unschedule.` };
      return { text: `I couldn't find a scheduled task matching “${unschedPhrase.trim()}”.` };
    }

    // split / break a task into N smaller sub-tasks
    m = q.match(/(?:split|break (?:down|up)|divide|chunk)\s+(.+?)\s+(?:in ?to|by)\s+(\d+)\s*(?:parts?|pieces?|sessions?|chunks?|bits?|steps?)?/);
    if (m) {
      const task = fuzzyFindTask(m[1].replace(/\bmy\b/g, " ").trim());
      const parts = App.clamp(parseInt(m[2]) || 0, 2, 12);
      if (task && parts >= 2) {
        const action = buildAction([{ type: "split_task", payload: { task_id: task.id, parts } }]);
        return { text: `Breaking it down:`, action };
      }
      if (!task) return { text: `I couldn't find a task matching “${m[1].trim()}” to split.` };
    }

    // add sub-tasks / steps: "add steps to X: a, b, c"
    m = q.match(/(?:add|give (?:it|me))\s+(?:some\s+)?(?:sub-?tasks?|steps?|checklist|to-?dos?)\s+(?:to|for|into|on)?\s*(.+?)\s*[:\-–]\s*(.+)$/);
    if (m) {
      const task = fuzzyFindTask(m[1].replace(/\bmy\b/g, " ").trim());
      const subs = m[2].split(/[;,\n]|\sand\s/).map((x) => x.trim()).filter(Boolean).map((title) => ({ title }));
      if (task && subs.length) {
        const action = buildAction([{ type: "add_subtasks", payload: { task_id: task.id, subtasks: subs } }]);
        return { text: `Adding ${subs.length} sub-task${subs.length === 1 ? "" : "s"} to “${task.title}”:`, action };
      }
      if (!task) return { text: `I couldn't find a task matching “${(m[1] || "").trim()}” to add sub-tasks to.` };
    }

    // dependencies → independent. Covers the ways people actually phrase it:
    //   "make all Math AI HL tasks independent"
    //   "remove the dependencies from my IA tasks"
    //   "change all tasks in math ai hl that have dependencies to be independent"
    // Only clearing is handled; setting a predecessor stays a task-form edit.
    if (/\b(independ\w*|dependenc\w*|predecessors?|prerequisites?|unlink\w*)\b/.test(q)) {
      // Strip the ask itself and leave whatever names the scope. Order matters:
      // the dependency words go before the filler so "that have dependencies"
      // doesn't leave a dangling "that have".
      const phrase = q
        .replace(/\b(?:that|which)\s+(?:still\s+)?(?:have|has|had|contains?|depend(?:s)? on)\b/g, " ")
        .replace(/\b(?:independ\w*|dependenc\w*|predecessors?|prerequisites?|unlink\w*)\b/g, " ")
        .replace(/\b(?:change|make|set|turn|update|mark|convert|remove|clear|drop|delete|strip|get rid of)\b/g, " ")
        .replace(/\b(?:to\s+be|into|so\s+(?:that\s+)?they(?:'re| are)?|no longer|any\s?more)\b/g, " ")
        .replace(/\b(?:from|for|in|on|under|within|inside|with|their|its)\b/g, " ")
        .replace(/\btasks?\b/g, " ")
        .replace(/\s+/g, " ").trim();

      const mkAction = (ids) => buildAction([
        { type: "update_tasks", payload: { task_ids: ids, changes: { predecessor_id: "" } } },
      ]);

      // A task named in full ("make my Math AI HL — analysis independent")
      // contains its own subject, so resolveScope would match the whole subject
      // and change every task in it. Try the single task first unless they
      // actually asked for all of them — same order as the priority route.
      const wantsAll = /\b(all|every|each|both)\b/.test(q) || /\btasks\b/.test(q);
      const single = (t) => t.predecessor_id
        ? { text: `Making “${t.title}” independent:`, action: mkAction([t.id]) }
        : { text: `“${t.title}” doesn't wait on another task — it's already independent.` };

      if (!wantsAll) {
        const one = fuzzyFindTask(phrase);
        if (one) return single(one);
      }

      const scope = resolveScope(phrase);
      if (scope) {
        const linked = scope.tasks.filter((t) => t.predecessor_id);
        if (linked.length) {
          return {
            text: `Making ${linked.length} ${scope.label.replace(/ tasks$/, "")} task${linked.length > 1 ? "s" : ""} independent — they'll stop waiting on anything else:`,
            action: mkAction(linked.map((t) => t.id)),
          };
        }
        return { text: `None of your ${scope.label} wait on another task — they're already independent.` };
      }

      const one = fuzzyFindTask(phrase);
      if (one) return single(one);
      return { text: `I couldn't match “${phrase || "that"}” to a task or subject. Try a subject (e.g. "make all Math AI HL tasks independent") or a task's name.` };
    }

    // priority: "make all <scope> tasks high", or a single task by name ("make my Math IA critical")
    m = q.match(/(?:set|make|turn|change|mark|move|bump|raise|lower|drop)\s+(.*?)\s*(?:tasks?)?\s*(?:to|as|into)?\s*\b(low|medium|high|critical)\b(?:\s*priority)?/);
    if (m && /priorit|critical|urgent|\b(low|medium|high)\b/.test(q)) {
      const phrase = m[1].replace(/\bmy\b/g, " ").replace(/\s+/g, " ").trim();
      const pri = m[2];
      const wantsAll = /\b(all|every|each|both)\b/.test(m[0]) || /\btasks\b/.test(m[0]);
      const priAction = (ids) => buildAction([{ type: "update_tasks", payload: { task_ids: ids, changes: { priority: pri } } }]);
      if (!wantsAll) { const one = fuzzyFindTask(phrase); if (one) return { text: `Setting “${one.title}” to ${pri} priority:`, action: priAction([one.id]) }; }
      const scope = resolveScope(phrase);
      if (scope && scope.tasks.length) return { text: `Here's what that changes:`, action: priAction(scope.tasks.map((t) => t.id)) };
      const one = fuzzyFindTask(phrase);
      if (one) return { text: `Setting “${one.title}” to ${pri} priority:`, action: priAction([one.id]) };
      if (scope) return { text: `No ${scope.label} to change right now.` };
      return { text: `I couldn't match “${phrase || "that"}” to a task, subject or category. Try a task's name, a subject (e.g. "Business Management HL"), or a category like EE, TOK, CAS, IA or exam prep.` };
    }

    // complete: "mark all <scope> as done", or a single task by name ("finish my Math IA")
    m = q.match(/(?:mark|set|complete|finish|tick off|check off|cross off)\s+(.+?)\s*(?:tasks?)?\s*(?:as\s+)?(?:done|complete|completed|finished|off)?\s*$/);
    if (m && /\b(done|complete|completed|finish|finished|tick|check off|cross off)\b/.test(q)) {
      const phrase = m[1].replace(/\bmy\b/g, " ").replace(/\s+/g, " ").trim();
      const wantsAll = /\b(all|every|each|both)\b/.test(m[0]) || /\btasks\b/.test(m[0]);
      const doneAction = (ids) => buildAction([{ type: "update_tasks", payload: { task_ids: ids, changes: { completed: true } } }]);
      if (!wantsAll) { const one = fuzzyFindTask(phrase); if (one && !one.completed) return { text: `Marking “${one.title}” complete:`, action: doneAction([one.id]) }; }
      const scope = resolveScope(phrase);
      if (scope && scope.tasks.length) {
        const open2 = scope.tasks.filter((t) => !t.completed);
        if (!open2.length) return { text: `All ${scope.label} are already complete.` };
        return { text: `Marking these as complete:`, action: doneAction(open2.map((t) => t.id)) };
      }
      const one = fuzzyFindTask(phrase);
      if (one) return one.completed ? { text: `“${one.title}” is already done.` } : { text: `Marking “${one.title}” complete:`, action: doneAction([one.id]) };
      if (scope) return { text: `No ${scope.label} to complete right now.` };
      return { text: `I couldn't tell which task you mean — try the task's name, or "mark all <subject> tasks as done".` };
    }

    // bulk delete: "delete all <scope> tasks"
    m = q.match(/(?:delete|remove)\s+(.*?)\s*tasks?\b/);
    if (m) {
      const scope = resolveScope(m[1]);
      if (!scope) return { text: `I couldn't tell which tasks to delete. Try "delete all <subject> tasks" — and remember this can't be undone.` };
      if (!scope.tasks.length) return { text: `No ${scope.label} to delete.` };
      const action = buildAction([{ type: "delete_tasks", payload: { task_ids: scope.tasks.map((t) => t.id) } }]);
      return { text: `Careful — this is permanent:`, action };
    }

    // set a time estimate: "set X estimate to 90m" / "X should take 2 hours"
    m = q.match(/(?:set|change|update|give)\s+(.+?)\s+(?:an? )?(?:estimate|time|duration)\s*(?:to|of|=|:|at)?\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/)
      || q.match(/\b(.+?)\s+(?:should take|will take|takes about|takes|needs)\s+(?:about |around )?(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/);
    if (m) {
      const task = fuzzyFindTask(m[1].replace(/\bmy\b/g, " ").replace(/\btask\b/g, " ").trim());
      const n = parseFloat(m[2]);
      const mins = /^h/.test(m[3]) ? Math.round(n * 60) : Math.round(n);
      if (task && mins > 0) {
        const action = buildAction([{ type: "update_tasks", payload: { task_ids: [task.id], changes: { estimated_minutes: mins } } }]);
        return { text: `Setting the estimate for “${task.title}” to ${fmtMin(mins)}:`, action };
      }
    }

    // set due date: "set/change/make <scope> due date to <date>" (also "make <scope> due <date>")
    // the connector words carry \b so the "to" in "tomorrow" isn't mistaken for a connector
    m = q.match(/(?:set|change|update|make|move|reschedule|push|postpone|shift)\s+(.*?)\s+(?:due\s*date|due|deadline)\s*(?:(?:to|for|as|on)\b|[=:])?\s*(.+)/);
    if (m) {
      const date = parseDateToken(m[2]);
      const scope = resolveScope(m[1]);
      if (scope && date) {
        if (!scope.tasks.length) return { text: `No ${scope.label} to reschedule.` };
        const action = buildAction([{ type: "update_tasks", payload: { task_ids: scope.tasks.map((t) => t.id), changes: { due_date: date } } }]);
        return { text: `Setting the due date to ${D.fmtLong(date)}:`, action };
      }
      if (scope && !date) return { text: `I couldn't read that date. Try a day like "Friday", "tomorrow", "2026-08-09", or "August 9".` };
      if (!scope && date) return { text: `I couldn't match “${(m[1] || "").trim()}” to a subject or category. Try the subject's full name (e.g. "Business Management HL"), or a category like EE, TOK, CAS, IA or exam prep.` };
    }

    // bulk reschedule: "reschedule/move <scope> to <date>"
    m = q.match(/(?:reschedule|move|push|postpone)\s+(.*?)\s*(?:tasks?)?\s+to\s+(.+)/);
    if (m) {
      const date = parseDateToken(m[2]);
      const scope = resolveScope(m[1]);
      if (scope && date) {
        if (!scope.tasks.length) return { text: `No ${scope.label} to reschedule.` };
        const action = buildAction([{ type: "update_tasks", payload: { task_ids: scope.tasks.map((t) => t.id), changes: { due_date: date } } }]);
        return { text: `Moving due dates to ${D.fmtLong(date)}:`, action };
      }
      if (scope && !date) return { text: `I didn't catch the date. Try "…to tomorrow", a weekday like "…to Friday", or a date like "…to 2026-08-09".` };
    }

    // schedule one task: "schedule <task> for/on <date>" or "add <task> to my schedule"
    m = q.match(/(?:^|\b)schedule\s+(.+?)(?:\s+(?:for|on)\s+(.+))?$/) || q.match(/add\s+(.+?)\s+to\s+(?:my\s+)?(?:schedule|calendar)(?:\s+(?:for|on)\s+(.+))?/);
    if (m && !/\bweek\b/.test(q)) {
      const task = fuzzyFindTask(m[1].replace(/\bmy\b/g, "").trim());
      const date = m[2] ? parseDateToken(m[2]) : D.today();
      if (task) {
        const action = buildAction([{ type: "schedule_task", payload: { task_id: task.id, date: date || D.today() } }]);
        return { text: `Sure — here's the plan:`, action };
      }
      return { text: `I couldn't find a task matching “${m[1].trim()}”. What's it called on your list?` };
    }

    /* One task stated in a sentence. LAST on purpose: every other route gets
       first refusal, because "make all my Physics tasks high priority" and
       "make all Physics tasks independent" also open with a creation verb and
       are bulk edits, not new tasks. Placed first, this route swallowed them
       and offered to create a task literally called "all my tasks".

       Down here it only ever sees messages that no command matched, which is
       exactly the set that used to fall through to the subject lookup and get
       answered with something unrelated. */
    const single = parseSingleAddTask(text);
    if (single) {
      if (single.needsTitle) {
        return { text: "I can add that, but I couldn't work out what to call it. Give me the title in quotes, like: add a task called “Physics IA draft” to Physics, high priority, 2 hours." };
      }
      const action = buildAction([{ type: "create_tasks", payload: { tasks: [single.spec] } }]);
      if (action) {
        const s = single.spec;
        const bits = [];
        if (s.subject_name) bits.push(s.subject_name);
        if (s.priority) bits.push(`${s.priority} priority`);
        if (s.estimated_minutes) bits.push(App.fmtMinutes(s.estimated_minutes));
        if (s.due_date) bits.push(`due ${D.fmtShort(s.due_date)}`);
        return {
          text: `Adding “${s.title}”${bits.length ? ` (${bits.join(", ")})` : ""} — look right?`,
          action,
        };
      }
    }

    /* Nothing matched, and the message is plainly an instruction rather than a
       question. Saying so is the whole point.

       Left to fall through, these reach the topic handlers, and because almost
       any sentence about schoolwork names a subject somewhere, the reply came
       back as a subject summary. "rename my Math IA to Maths writeup" was
       answered with "Math AA HL: 2 open tasks, grade 6 → target 7" — which
       reads as if it understood and quietly did the wrong thing. Being told
       "I can't do that yet" is worth more than a confident non-answer.

       Anchored at the start of the message, so a question that merely contains
       one of these words ("what should I change about my revision?") is not
       mistaken for a command. */
    const UNSUPPORTED = /^\s*(?:can you|could you|please|hey,?|could i get you to)?\s*(rename|re-?name|re-?title|re-?word|merge|duplicate|copy|archive|hide|un-?archive|restore|tag|colou?r|pin|star|favourite|favorite|export|print|email|remind me at|snooze)\b/i;
    const m2 = text.match(UNSUPPORTED);
    if (m2) {
      const verb = m2[1].toLowerCase();
      return {
        text: `I can't ${verb} things yet — that one still has to be done by hand. ` +
              `What I can do: add tasks, change priority, due date, category, subject or estimate, ` +
              `mark things complete, delete tasks, split a task into steps, and schedule or unschedule work. ` +
              `Ask me any of those and I'll show you the change before anything happens.`,
      };
    }

    return null;
  }

  // exposed for the command palette's natural-language quick-add.
  // parseTaskLine is tuned for pasted lists (needs "high priority", trailing
  // estimate); here we also accept a bare priority word and an estimate placed
  // anywhere, since people type "Math IA due friday 2h high".
  C.buildTaskFromText = function (line) {
    const spec = parseTaskLine(line);
    if (!spec) return null;
    const raw = String(line).toLowerCase();
    if (!spec.priority) {
      const pm = raw.match(/\b(critical|high|medium|low)\b/);
      if (pm) spec.priority = pm[1];
    }
    if (!spec.estimated_minutes) {
      const em = raw.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/);
      if (em) { const n = parseFloat(em[1]); spec.estimated_minutes = /^h/.test(em[2]) ? Math.round(n * 60) : Math.round(n); }
    }
    return cleanTaskSpec(spec);
  };

  /* ---------- offline dispatcher ----------
     Order matters: state-changing commands, then context-aware follow-ups, then
     an intent cascade (most specific → most general), then a never-fail fallback.
     Nothing ever returns null — every input yields a usable, grounded reply. */
  C.offlineRespond = function (text) {
    const raw = (text || "").trim();
    const a = C.analyze();

    // 0. follow-ups that lean on the last exchange ("why?", "schedule it", "the 2nd one").
    //    Runs first so referent phrases resolve from memory before the generic parser;
    //    it only fires on clear referents, so ordinary commands still fall through.
    const follow = resolveFollowUp(raw, a);
    if (follow) return follow;

    // 1. commands (add/change/schedule/delete…) — proposed for confirmation
    const command = parseCommand(text);
    if (command) return command;

    const q = raw.toLowerCase();
    const has = (...words) => words.some((w) => q.includes(w));
    const mine = /\bmy\b|\bi'?m\b|\bmine\b|\bi've\b|\bmy\b/.test(q);

    // 2. wellbeing / emotional state comes first — it's the most human need
    if (has("all-nighter", "all nighter", "pull an all", "stay up all", "cram tonight", "cram all night", "should i sleep", "no sleep", "haven't slept", "havent slept", "stay awake")) return sleepReply(a);
    if (has("overwhelm", "stress", "anxious", "anxiety", "panic", "burn out", "burnt out", "burned out", "too much", "can't cope", "cant cope", "falling behind", "behind on", "drowning", "hopeless", "can't keep up", "cant keep up")) return overwhelmedReply(a);
    if (has("not good enough", "not smart enough", "everyone else", "everyone is", "compared to", "compare myself", "behind everyone", "worse than everyone", "i'm a failure", "im a failure", "i'm dumb", "im dumb", "i'm stupid", "im stupid")) return reassuranceReply(a, has("everyone", "compared", "compare", "than everyone", "behind everyone") ? "compare" : "perfect");
    if (has("perfectionist", "perfectionism", "never good enough", "has to be perfect", "must be perfect", "obsess")) return reassuranceReply(a, "perfect");
    if (has("take a break", "need a break", "should i rest", "need rest", "tired", "exhausted", "worn out", "need a rest", "knackered", "no energy")) return breakReply(a);
    if (has("motivat", "inspire me", "pep talk", "encourage me", "cheer me", "i can't do this", "i cant do this", "want to quit", "feel like quitting", "give up", "what's the point", "whats the point", "why bother", "pointless", "no point")) return motivationReply(a);
    if (has("focus", "procrastinat", "distract", "can't start", "cant start", "lazy", "keep getting distracted", "can't concentrate", "cant concentrate", "get in the zone", "keep putting")) return focusReply(a);

    // 3. quick time-window planning
    if (has("weekend")) return weekendReply(a);
    if (has("tomorrow")) return tomorrowReply(a);
    if (has("what should i", "what do i do", "what now", "work on", "start with", "right now", "what's next", "whats next", "to-do", "todo list", "first thing", "what to do", "where do i start", "where should i start")) return planReply(a);

    // 4. grade-scenario maths (before generic grade/knowledge talk)
    if (isGradeScenario(q)) return gradeScenarioReply(q, a);

    // 5. IB knowledge (durable process facts) — unless it's clearly about *my* numbers
    if (!(mine && has("predicted", "on track", "my grade", "my score", "my points", "my total"))) {
      const info = knowledgeReply(q);
      if (info) return info;
    }

    // 6. my predicted score / total
    if (has("predicted", "on track") || (has("points", "score", "total") && mine) || has("what score", "what total", "how many points am i", "my prediction")) return predictedReply();

    // 7. exam countdown
    const examWord = has("exam", "exams", "finals");
    if (examWord && has("how long", "how many days", "when are", "when is", "days until", "days till", "days left", "countdown", "how close", "date")) return examCountdownReply();
    if (has("how long until", "days until", "when are my exams", "countdown")) return examCountdownReply();

    // 8. a subject by name / abbreviation
    const subject = matchSubject(q);
    if (subject) return subjectReply(a, subject);

    // 9. core status
    if (has("extended essay", " ee", "ee?", "ee going", "my ee")) return coreReply(a, "extended_essay");
    if (has("theory of knowledge") || /\btok\b/.test(q)) return coreReply(a, "tok");
    if (/\bcas\b/.test(q)) return coreReply(a, "cas");

    // 10. one specific task's status: "when is the personal statement due", "how long is X"
    if (has("when", "due", "how long", "status of", "scheduled", "how far", "progress on", "estimate for")) {
      const phrase = q.replace(/\b(when('?s)?|what('?s)?|is|are|the|a|my|due|by|deadline|how (long|far)|status|of|scheduled|for|going|progress( on)?|do i (have|need)|left|remaining|about|got|there|estimate|coming up)\b/g, " ").replace(/[?.!]/g, " ").replace(/\s+/g, " ").trim();
      if (phrase.length >= 3) { const t = fuzzyFindTask(phrase); if (t) return taskDetailReply(t, a); }
    }

    // 11. grades / university
    if (has("grade", "gpa", "average", "predicted", "score")) return gradesReply(a);
    if (has("universit", "uni ", "application", "ucas", "college", "offer", "admission")) return uniReply(a);

    // 11.5 explicit "how do I study/revise" → technique tips (before listing exam-prep tasks)
    if (has("how do i study", "how to study", "how do i revise", "how to revise", "how should i study", "how should i revise", "study technique", "revision technique", "revision tip", "study tip", "how to memori", "how do i memori", "best way to study", "best way to revise", "best way to learn", "study method", "study advice")) return tipsReply();

    // 12. exam-prep tasks
    if (examWord || has("paper 1", "paper 2", "revision", "revise", "past paper", "mock")) {
      const exams = a.actionable.filter((t) => t.category === "exam_prep");
      if (!exams.length) return { text: `No exam-prep tasks on your list right now. If exams are coming, paste the practice sessions you're planning and I'll add them, or ask me "how long until my exams?"` };
      rememberTasks(exams);
      return { text: [`${exams.length} exam-prep task${exams.length === 1 ? "" : "s"} open:`, ...exams.slice(0, 4).map(taskLine), `Little and often beats cramming — spread these across the week.`].join("\n") };
    }

    // 13. time management / capacity
    if (has("manage my time", "time management", "how much should i study", "how many hours", "balance my", "balance everything", "balance it all", "balance school", "juggle", "spread too thin", "everything at once", "too much on my plate", "study schedule", "study plan", "study routine", "how do i fit", "not enough time", "no time", "find time")) return timeManagementReply(a);

    // 14. planning / schedule / stats
    if (has("this week", "plan", "schedul", "organis", "organiz", "workload", "busy", "my week")) return weekReply(a);
    if (has("how am i", "how'm i", "progress", "stats", "doing", "streak", "how many tasks", "how much have i", "how productive")) return statsReply(a);

    // 15. study advice / tips
    if (has("study tip", "tips", "how do i study", "how should i study", "how to study", "study better", "study advice", "study technique", "study method", "revision tip", "how do i revise", "how to revise", "any advice", "advice", "best way to study", "best way to revise", "how to memori", "how to learn")) return tipsReply();

    // 16. deadlines / urgency
    if (has("due", "deadline", "overdue", "urgent", "coming up", "on my plate")) return planReply(a);

    // 17. subject-content help → coach, not tutor
    if (isAcademicHelp(q)) return studyStrategyReply(q, a);

    // 18. thanks / capabilities / greeting
    if (has("thank")) return { text: C.tone() === "warm" ? `Anytime — that's what I'm here for. Now go make it happen! 💪` : `Don't thank me. Go work.` };
    if (has("what can you do", "what can i ask", "how do you work", "who are you", "what are you", "your job", "help me out", "what do you do", "your commands", "list of commands", "what else can you")) return helpReply();
    if (has("hello", "hey", "hi ", "hi!", "hiya", "yo ", "sup", "good morning", "good evening", "good afternoon", "howdy", "what's up", "whats up") || q.length < 6) {
      const greet = C.tone() === "warm" ? `Hey! Good to see you.` : `Here. Let's get to it.`;
      const plan = planReply(a);
      return { text: `${greet}\n${plan.text}`, action: plan.action };
    }

    // 19. never-fail fallback — still tries subject / date / task, then a helpful menu
    return richFallback(raw, a);
  };

  /* ============================================================
     AI mode — Claude API with tool use (proposals only)
     ============================================================ */
  const TOOLS = [
    {
      name: "create_tasks",
      description: "Propose adding one or more new tasks to the student's task list. Use for pasted lists too. The app shows the student a confirmation before anything is added.",
      input_schema: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                subject_name: { type: "string", description: "Must be one of the student's subjects, or empty" },
                category: { type: "string", enum: ["ia", "subject_task", "exam_prep", "tok", "extended_essay", "cas", "university_application"] },
                priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
                due_date: { type: "string", description: "YYYY-MM-DD" },
                estimated_minutes: { type: "integer" },
              },
              required: ["title"],
            },
          },
        },
        required: ["tasks"],
      },
    },
    {
      name: "update_tasks",
      description: "Propose the same change to one or more existing tasks (priority, due date, category, subject, estimate, completed, or clearing a dependency). Use the task ids from STUDENT DATA.",
      input_schema: {
        type: "object",
        properties: {
          task_ids: { type: "array", items: { type: "string" } },
          changes: {
            type: "object",
            properties: {
              priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
              due_date: { type: "string", description: "YYYY-MM-DD" },
              category: { type: "string", enum: ["ia", "subject_task", "exam_prep", "tok", "extended_essay", "cas", "university_application"] },
              subject_name: { type: "string" },
              estimated_minutes: { type: "integer" },
              completed: { type: "boolean" },
              predecessor_id: {
                type: "string",
                description: 'Only the empty string "" is accepted, which makes the task independent — it stops waiting on the task it depended on. Use this when the student asks to remove dependencies or make tasks independent. Setting a dependency is not supported here.',
              },
            },
          },
        },
        required: ["task_ids", "changes"],
      },
    },
    {
      name: "delete_tasks",
      description: "Propose permanently deleting tasks (and their sub-tasks). Only when the student clearly asks to delete/remove.",
      input_schema: {
        type: "object",
        properties: { task_ids: { type: "array", items: { type: "string" } } },
        required: ["task_ids"],
      },
    },
    {
      name: "schedule_task",
      description: "Propose putting a task on the calendar at a specific date/time. It lands in the first free gap at or after the given hour. Offer this when recommending a task.",
      input_schema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          start_hour: { type: "number", description: "0-23, e.g. 16.5 for 4:30 PM. Omit to use the student's work-day start." },
          duration_minutes: { type: "integer" },
        },
        required: ["task_id", "date"],
      },
    },
    {
      name: "run_auto_schedule",
      description: "Propose auto-scheduling all unscheduled tasks across the current week around busy blocks and the student's daily study hours.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "unschedule_tasks",
      description: "Propose removing one or more tasks from the calendar (they return to the unscheduled list; nothing is deleted). Use task ids from STUDENT DATA.",
      input_schema: { type: "object", properties: { task_ids: { type: "array", items: { type: "string" } } }, required: ["task_ids"] },
    },
    {
      name: "clear_schedule",
      description: "Propose clearing the entire calendar — every scheduled task goes back to the unscheduled list. Nothing is deleted.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "reschedule_overdue",
      description: "Propose spreading all overdue tasks across the coming week (most urgent first) so each gets a realistic new due date.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "add_subtasks",
      description: "Propose adding sub-tasks (a checklist) to an existing task, to break big work into steps.",
      input_schema: { type: "object", properties: { task_id: { type: "string" }, subtasks: { type: "array", items: { type: "object", properties: { title: { type: "string" }, estimated_minutes: { type: "integer" } }, required: ["title"] } } }, required: ["task_id", "subtasks"] },
    },
    {
      name: "split_task",
      description: "Propose splitting one big task into N equal sub-tasks, so it's easier to start and schedule.",
      input_schema: { type: "object", properties: { task_id: { type: "string" }, parts: { type: "integer" } }, required: ["task_id", "parts"] },
    },
  ];

  // Anthropic-style {name, description, input_schema} -> OpenAI function-calling format
  const OPENAI_TOOLS = TOOLS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  function dataSnapshot(a) {
    const s = App.state();
    const compactTask = (t) => ({
      id: t.id,
      title: t.title, category: t.category, subject: t.subject_name || undefined,
      due: t.due_date || undefined, priority: t.priority,
      est_min: t.estimated_minutes || undefined,
      scheduled: (t.scheduled_blocks || []).length > 0 || undefined,
      overdue: (t.due_date && t.due_date < a.today) || undefined,
      // The id of the task this one waits on, if any. locked_or_blocked isn't a
      // substitute: it only goes true while the predecessor is still open, so a
      // dependency on a finished task is invisible without this.
      depends_on: t.predecessor_id || undefined,
      locked: App.isLocked(t) || undefined,
    });
    return {
      subjects: a.subjects,
      open_tasks: a.actionable.concat(a.overdue.filter((t) => !a.actionable.includes(t)))
        .slice(0, 40).map(compactTask),
      counts: { open: a.openCount, overdue: a.overdue.length, due_today: a.dueToday.length, due_this_week: a.dueWeek.length, locked_or_blocked: a.lockedCount },
      today_schedule: a.todayPlan.map(({ task, block }) => ({ time: D.minToLabel(block.start_min), title: task.title, min: block.duration })),
      work_hours: { start: s.settings.work_start_hour, end: s.settings.work_end_hour, per_day: s.settings.hours_per_day },
      goals: {
        weekly_goal_hours: s.settings.weekly_goal_hours || 0,
        this_week_focus_min: App.weekMinutes(),
        target_points: s.settings.target_points || null,
        exam_date: s.settings.exam_date || null,
        days_until_exams: s.settings.exam_date && s.settings.exam_date >= a.today ? D.diffDays(a.today, s.settings.exam_date) : null,
      },
      study: { streak_days: a.streak, focus_min_last_7d: a.focus7, focus_min_prior_7d: a.focusPrev7, completed_last_7d: a.completed7, min_by_subject_7d: a.subjTime },
      grades: s.grades.map((g) => ({ subject: g.subject_name, current: g.current_grade, target: g.target_grade })),
      core: { tok_grade: a.tokGrade || null, ee_grade: a.eeGrade || null, core_points: App.getCorePoints(a.tokGrade, a.eeGrade), open_tasks: { tok: a.core.tok.open, extended_essay: a.core.extended_essay.open, cas: a.core.cas.open } },
      university_deadlines_60d: a.uniDeadlines,
    };
  }

  function systemPrompt() {
    const a = C.analyze();
    const persona = C.tone() === "direct"
      ? "Direct and no-nonsense: skip pep talk, lead with priorities and concrete next actions, keep it blunt but never mean."
      : "A warm, encouraging mentor: supportive, celebrates real progress, but honest about overdue work and slipping habits.";
    return [
      `You are the study coach built into "${App.state().settings.appName || "IB Tracker"}", a personal IB Diploma study-tracker app. You talk directly to the student.`,
      `Personality: ${persona}`,
      `Ground advice in the student's real data below — name specific tasks, dates and subjects. If data is missing (no grades, no sessions), say so and suggest adding it.`,
      `Keep replies under ~150 words unless the student asks for detail. Short paragraphs or "-" bullets. Plain text only: no markdown headers, no tables. Respond only with your final answer — no reasoning preamble.`,
      `TAKING ACTION: when the student asks you to change something, call the matching tool: add tasks (create_tasks, incl. pasted lists); change priority/due dates/subjects/estimates or mark complete (update_tasks); make tasks independent, i.e. stop them waiting on another task (update_tasks with changes.predecessor_id set to the empty string, choosing the tasks whose "depends_on" is present); delete (delete_tasks); schedule/unschedule tasks (schedule_task, unschedule_tasks); clear the calendar (clear_schedule); auto-schedule the week (run_auto_schedule); spread overdue work to realistic dates (reschedule_overdue); break work down (add_subtasks, split_task). Use task "id" values from STUDENT DATA. The app shows the student a preview they must confirm — so NEVER say a change is done; say what you're proposing. When you recommend a specific unscheduled task, offer to schedule it. Prefer one coherent proposal per turn.`,
      `You are a study COACH, not a subject tutor: don't teach or answer subject content (maths problems, essay content, science facts) — instead give study strategy for that topic and, if useful, offer to add or schedule a study task for it.`,
      `You cannot navigate the app for the student; for manual things point to the right page (Dashboard, Timeline, Calendar, Study Session, Scheduler, Analytics, Subjects, Core Requirements, Grades, University, Templates, Settings).`,
      `You are a study coach, not a tutor for exam content, and not a substitute for real help — if the student sounds seriously distressed, gently suggest talking to someone they trust or a school counsellor.`,
      `Today is ${D.fmtLong(a.today)}, ${a.today}.`,
      `STUDENT DATA (JSON): ${JSON.stringify(dataSnapshot(a))}`,
    ].join("\n");
  }

  C.aiReply = async function () {
    const key = (App.state().settings.ai_api_key || "").trim();
    const model = C.model();

    let history = App.state().coach.messages.slice(-20).map((m) => ({
      role: m.role === "coach" ? "assistant" : "user",
      content: m.text,
    }));
    while (history.length && history[0].role !== "user") history.shift();

    const body = {
      model,
      max_tokens: 1024,
      messages: [{ role: "system", content: systemPrompt() }, ...history],
      tools: OPENAI_TOOLS,
    };

    let res;
    try {
      res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${key}`,
          "x-title": App.state().settings.appName || "IB Tracker",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error("couldn't reach OpenRouter — check your internet connection");
    }

    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error?.message || ""; } catch (e) { /* ignore */ }
      if (res.status === 401) throw new Error("the API key was rejected — check it in Settings");
      if (res.status === 402) throw new Error("your OpenRouter account is out of credit");
      if (res.status === 429) throw new Error("rate limited — wait a moment and try again");
      if (res.status >= 500) throw new Error("the AI provider is temporarily overloaded — try again shortly");
      throw new Error(detail ? detail.slice(0, 140) : `API error (${res.status})`);
    }

    const data = await res.json();
    const choice = (data.choices || [])[0];
    if (!choice) throw new Error("the response was empty");
    const msg = choice.message || {};
    const text = (msg.content || "").trim();
    const items = (msg.tool_calls || [])
      .filter((tc) => tc.type === "function" && tc.function)
      .map((tc) => {
        let payload = {};
        try { payload = JSON.parse(tc.function.arguments || "{}"); } catch (e) { /* ignore */ }
        return { type: tc.function.name, payload };
      });
    const action = items.length ? buildAction(items) : null;
    if (!text && !action) throw new Error("the response was empty");
    return {
      text: text || "Here's what I'd change — confirm below and I'll apply it:",
      action,
    };
  };

  /* ============================================================
     Send flow
     ============================================================ */
  const YES_RE = /^\s*(y|ya|yes|yeah|yep|yup|sure|ok|okay|confirm|go ahead|do it|please do|sounds good)\s*[.!]*\s*$/i;
  const NO_RE = /^\s*(n|no|nope|nah|cancel|don'?t|stop|leave it)\s*[.!]*\s*$/i;

  C.send = async function (rawText) {
    const text = (rawText || "").trim();
    if (!text || C.pending) return;

    // a pending proposal can be answered in plain words
    const pendingAct = findPendingAction();
    if (pendingAct) {
      if (YES_RE.test(text)) {
        App.update((s) => s.coach.messages.push({ role: "user", text, ts: Date.now() }));
        C.confirmAction(pendingAct.id);
        return;
      }
      if (NO_RE.test(text)) {
        App.update((s) => s.coach.messages.push({ role: "user", text, ts: Date.now() }));
        C.cancelAction(pendingAct.id);
        return;
      }
      C.cancelAction(pendingAct.id, true); // moved on — quietly drop the proposal
    }

    App.update((s) => {
      s.coach.messages.push({ role: "user", text, ts: Date.now() });
      if (s.coach.messages.length > 200) s.coach.messages = s.coach.messages.slice(-200);
    });
    C.pending = true;
    App.render();

    let reply, via;
    if (C.aiActive() && navigator.onLine !== false) {
      try {
        reply = await C.aiReply();
        via = "ai";
      } catch (e) {
        reply = C.offlineRespond(text);
        reply.text += `\n\n(AI model unavailable — ${e.message}. This answer is from the built-in coach.)`;
        via = "offline";
      }
    } else {
      await new Promise((r) => setTimeout(r, 450 + Math.random() * 350));
      reply = C.offlineRespond(text);
      via = "offline";
      if (C.aiEnabled() && C.hasKey() && navigator.onLine === false) {
        reply.text += `\n\n(You're offline right now, so the built-in coach answered.)`;
      }
    }

    C.pending = false;
    App.update((s) => {
      const msg = { role: "coach", text: reply.text, ts: Date.now(), via };
      if (reply.action) msg.action = reply.action;
      s.coach.messages.push(msg);
      if (s.coach.messages.length > 200) s.coach.messages = s.coach.messages.slice(-200);
    });
  };

  C.clearConversation = function () {
    App.update((s) => { s.coach.messages = []; });
  };

  /* ============================================================
     Floating bubble — one click to the coach from any page
     ============================================================ */
  CU.renderBubble = function () {
    const root = document.getElementById("coach-bubble");
    if (!root) return;
    if (App.currentPage() === "coach") { root.innerHTML = ""; return; }
    const t = App.state().timer;
    const right = t ? (t.minimized ? 96 : 318) : 22;
    root.innerHTML = `
      <button class="coach-fab" style="right:${right}px" title="Talk to your coach" aria-label="Open coach">
        ${App.icon("messageCircle")}
      </button>`;
    root.querySelector(".coach-fab").addEventListener("click", () => App.navigate("coach"));
  };
})();
