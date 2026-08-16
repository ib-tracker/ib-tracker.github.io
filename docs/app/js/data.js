/* data.js — domain model: constants, CRUD, task logic, scheduler, import/export */
(function () {
  "use strict";
  const App = window.App;
  const D = App.dates;

  /* ---------- constants ---------- */
  App.CATEGORIES = {
    ia: { label: "IA", cls: "cat-ia" },
    subject_task: { label: "Subject Task", cls: "cat-subject" },
    exam_prep: { label: "Exam Prep", cls: "cat-exam" },
    tok: { label: "TOK", cls: "cat-tok" },
    extended_essay: { label: "Extended Essay", cls: "cat-ee" },
    cas: { label: "CAS", cls: "cat-cas" },
    university_application: { label: "University", cls: "cat-uni" },
  };

  App.PRIORITIES = {
    low: { label: "Low", chip: "chip-plain", rank: 3 },
    medium: { label: "Medium", chip: "chip-accent", rank: 2 },
    high: { label: "High", chip: "chip-warning", rank: 1 },
    critical: { label: "Critical", chip: "chip-danger", rank: 0 },
  };

  App.RECURRENCE = {
    none: "No recurrence", daily: "Daily", weekly: "Weekly",
    bi_weekly: "Bi-weekly", monthly: "Monthly",
  };

  App.UNI_STATUSES = {
    not_started: { label: "Not Started", chip: "chip-plain" },
    in_progress: { label: "In Progress", chip: "chip-accent" },
    submitted: { label: "Submitted", chip: "chip-warning" },
    offer_received: { label: "Offer Received", chip: "chip-good" },
    accepted: { label: "Accepted", chip: "chip-good" },
    rejected: { label: "Rejected", chip: "chip-danger" },
  };

  App.DEFAULT_KEY_STEPS = [
    "Research course requirements", "Prepare personal statement",
    "Request recommendation letters", "Register for entrance exam",
    "Submit application", "Prepare for interview", "Attend interview",
  ];
  // The starting checklist for a new course. Editable in Settings, because
  // what every application needs differs wildly by country: a UK applicant
  // never touches a portfolio, a US one needs test scores nobody else does.
  App.DEFAULT_MATERIALS = [
    "Academic transcripts", "Personal statement", "Recommendation letters",
    "Language test scores", "Portfolio",
  ];
  App.defaultMaterials = function () {
    const custom = App.state().settings.default_materials;
    return Array.isArray(custom) && custom.length ? custom.slice() : App.DEFAULT_MATERIALS.slice();
  };
  App.defaultKeySteps = function () {
    const custom = App.state().settings.default_key_steps;
    return Array.isArray(custom) && custom.length ? custom.slice() : App.DEFAULT_KEY_STEPS.slice();
  };
  App.CURRENCIES = ["USD","EUR","GBP","CNY","HKD","SGD","AUD","CAD","JPY","KRW","NZD","CHF"];
  App.DAY_KEYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  App.DAY_LABELS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

  /* IB core points matrix (TOK row × EE column) */
  const CORE_MATRIX = {
    A: { A: 3, B: 3, C: 2, D: 2, E: null },
    B: { A: 3, B: 2, C: 2, D: 1, E: null },
    C: { A: 2, B: 2, C: 1, D: 0, E: null },
    D: { A: 2, B: 1, C: 0, D: 0, E: null },
    E: { A: null, B: null, C: null, D: null, E: null },
  };
  App.getCorePoints = (tok, ee) => (!tok || !ee) ? null : (CORE_MATRIX[tok] ? CORE_MATRIX[tok][ee] : null);
  App.isFailingCondition = (tok, ee) => !!(tok && ee && (tok === "E" || ee === "E"));
  App.CORE_MATRIX = CORE_MATRIX;

  // shared predicted-points math — used by Grades and University so both tabs agree
  App.predictedPoints = function () {
    const s = App.state();
    const grades = s.grades;
    const tok = s.settings.tok_grade || "", ee = s.settings.ee_grade || "";
    const corePoints = App.getCorePoints(tok, ee);
    const failing = App.isFailingCondition(tok, ee);
    const subjectPoints = grades.reduce((sum, g) => sum + (g.current_grade || 0), 0);
    const maxPoints = grades.length * 7 + 3;
    const totalPoints = subjectPoints + (corePoints || 0);
    const avgGrade = grades.length ? subjectPoints / grades.length : null;
    return { subjectPoints, corePoints, failing, maxPoints, totalPoints, avgGrade, tok, ee, gradesCount: grades.length };
  };

  /* ---------- task helpers ---------- */
  App.isOverdue = (t) => !!(t.due_date && !t.completed && t.due_date < D.today());
  App.isDueToday = (t) => !!(t.due_date && t.due_date === D.today());
  // Archived: completed AND its due date is in the past. These are kept for
  // analytics/reports/XP but hidden from every active view (Timeline, Subjects,
  // Dashboard, Calendar, Scheduler, Core, University, Search…).
  App.isArchived = (t) => !!(t.completed && t.due_date && t.due_date < D.today());

  App.taskById = (id) => App.state().tasks.find((t) => t.id === id) || null;

  // Locked: has an incomplete predecessor
  App.isLocked = function (task, taskMap) {
    if (!task.predecessor_id) return false;
    const pred = taskMap ? taskMap.get(task.predecessor_id) : App.taskById(task.predecessor_id);
    return !!(pred && !pred.completed);
  };


  App.taskMap = function () {
    return new Map(App.state().tasks.map((t) => [t.id, t]));
  };

  // Display order for task lists: actionable tasks first, ones locked behind an
  // unfinished predecessor below them, completed ones always at the bottom.
  // Stable — preserves the incoming order within each band.
  App.displayOrder = function (tasks, taskMap) {
    taskMap = taskMap || App.taskMap();
    const rank = (t) =>
      t.completed ? 2 : App.isLocked(t, taskMap) ? 1 : 0;
    return tasks
      .map((t, i) => [rank(t), i, t])
      .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
      .map((x) => x[2]);
  };

  // Subject-page order: same bands as displayOrder, but within each band tasks
  // sort naturally by title ("5.9.2" before "5.9.10") and a task never appears
  // before the predecessor it depends on.
  App.subjectOrder = function (tasks, taskMap) {
    taskMap = taskMap || App.taskMap();
    const rank = (t) =>
      t.completed ? 2 : App.isLocked(t, taskMap) ? 1 : 0;
    const natural = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });

    const bands = [[], [], []];
    tasks.forEach((t) => bands[rank(t)].push(t));

    const out = [];
    for (const band of bands) {
      band.sort(natural);
      const inBand = new Map(band.map((t) => [t.id, t]));
      const placed = new Set();
      const place = (t, stack) => {
        if (placed.has(t.id) || stack.has(t.id)) return; // stack guard breaks cycles
        stack.add(t.id);
        const pred = t.predecessor_id && inBand.get(t.predecessor_id);
        if (pred) place(pred, stack);
        stack.delete(t.id);
        placed.add(t.id);
        out.push(t);
      };
      band.forEach((t) => place(t, new Set()));
    }
    return out;
  };

  App.subtasksOf = function (taskId) {
    return App.state().subtasks
      .filter((s) => s.task_id === taskId)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  };

  App.sortedTasks = function () {
    return [...App.state().tasks].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  };

  /* ---------- entity CRUD ---------- */
  function now() { return new Date().toISOString(); }

  function buildTask(data) {
    return Object.assign({
      id: App.uid(), title: "", description: "", category: "subject_task",
      subject_name: "", university_course_id: "", due_date: "",
      priority: "medium", estimated_minutes: 0, completed: false, completed_at: null,
      progress: 0, recurring: "none",
      predecessor_id: "", scheduled_blocks: [],
      min_session_minutes: 0, max_session_minutes: 0,
      created_at: now(), updated_at: now(),
    }, data);
  }

  App.createTask = function (data) {
    const t = buildTask(data);
    App.update((s) => s.tasks.push(t));
    return t;
  };

  // Add many tasks in a SINGLE update — one save, one re-render. Adding a big
  // pasted list one-at-a-time would fire hundreds of renders and freeze the UI.
  App.createTasks = function (list) {
    const built = (list || []).map(buildTask);
    if (built.length) App.update((s) => { for (const t of built) s.tasks.push(t); });
    return built;
  };

  App.updateTask = function (id, patch, opts) {
    App.update((s) => {
      const t = s.tasks.find((x) => x.id === id);
      if (t) Object.assign(t, patch, { updated_at: now() });
    }, opts);
  };

  App.deleteTask = function (id) {
    App.update((s) => {
      s.tasks = s.tasks.filter((t) => t.id !== id);
      s.subtasks = s.subtasks.filter((st) => st.task_id !== id);
      s.tasks.forEach((t) => {
        if (t.predecessor_id === id) t.predecessor_id = "";
      });
    });
  };

  // Toggle completion; spawns the next occurrence for recurring tasks.
  App.toggleTask = function (id) {
    const t = App.taskById(id);
    if (!t) return;
    const completing = !t.completed;
    const written = App.update((s) => {
      const task = s.tasks.find((x) => x.id === id);
      task.completed = completing;
      task.completed_at = completing ? now() : null;
      task.progress = completing ? 100 : task.progress === 100 ? 0 : task.progress;
      task.updated_at = now();
      if (completing && task.recurring && task.recurring !== "none" && task.due_date) {
        let nextDue;
        if (task.recurring === "daily") nextDue = D.addDays(task.due_date, 1);
        else if (task.recurring === "weekly") nextDue = D.addDays(task.due_date, 7);
        else if (task.recurring === "bi_weekly") nextDue = D.addDays(task.due_date, 14);
        else nextDue = D.addMonths(task.due_date, 1);
        s.tasks.push(Object.assign({}, task, {
          id: App.uid(), completed: false, completed_at: null, progress: 0,
          due_date: nextDue, scheduled_blocks: [],
          created_at: now(), updated_at: now(),
        }));
      }
    });
    // Read-only mode rejects the write and says so in its own toast — don't
    // cheer (or chime) for a tick that didn't happen.
    if (written === false) return false;
    // A bulk complete lands here once per task; App.sfx collapses the repeats.
    if (completing) { App.toast(App.xp.taskEncouragement()); App.sfx("task"); }
    return completing;
  };

  App.createSubtask = function (taskId, title, minutes) {
    const st = {
      id: App.uid(), task_id: taskId, title: title, completed: false,
      estimated_minutes: minutes || 0,
      sort_order: App.subtasksOf(taskId).length, created_at: now(),
    };
    App.update((s) => { s.subtasks.push(st); syncTaskProgress(s, taskId); });
    return st;
  };
  App.toggleSubtask = function (id) {
    App.update((s) => {
      const st = s.subtasks.find((x) => x.id === id);
      if (st) { st.completed = !st.completed; syncTaskProgress(s, st.task_id); }
    });
  };
  App.deleteSubtask = function (id) {
    App.update((s) => {
      const st = s.subtasks.find((x) => x.id === id);
      s.subtasks = s.subtasks.filter((x) => x.id !== id);
      if (st) syncTaskProgress(s, st.task_id);
    });
  };
  App.reorderSubtasks = function (taskId, orderedIds) {
    App.update((s) => {
      orderedIds.forEach((id, i) => {
        const st = s.subtasks.find((x) => x.id === id);
        if (st) st.sort_order = i;
      });
    });
  };
  function syncTaskProgress(s, taskId) {
    const subs = s.subtasks.filter((x) => x.task_id === taskId);
    const t = s.tasks.find((x) => x.id === taskId);
    if (t && subs.length > 0 && !t.completed) {
      t.progress = Math.round((subs.filter((x) => x.completed).length / subs.length) * 100);
    }
  }

  // HL/SL is a structured field, but for display/matching everywhere else the
  // subject stays one string (e.g. "Math AA HL") — these keep the two in sync.
  App.parseSubjectLevel = function (name) {
    // Coerce once: `name || ""` leaves a number as a number, so .trim() and
    // .slice() both blew up on a subject name that came back as 99.
    const s = String(name || "");
    const m = /\s+(HL|SL)$/i.exec(s);
    return { base: m ? s.slice(0, m.index).trim() : s.trim(), level: m ? m[1].toUpperCase() : "" };
  };
  App.composeSubjectName = function (base, level) {
    base = (base || "").trim();
    return level ? `${base} ${level}` : base;
  };

  // `opts` is passed straight to App.update. The first-run setup passes
  // {system:true}: naming your six subjects is configuring the app, not the
  // "work" a license gates, and a wizard that can't save is worse than none.
  App.createSubject = function (name, level, opts) {
    name = (name || "").trim();
    if (!name) return null;
    level = ["HL", "SL"].includes(level) ? level : "";
    if (level) name = App.composeSubjectName(App.parseSubjectLevel(name).base, level);
    else level = App.parseSubjectLevel(name).level; // typed "... HL" directly without using the dropdown
    if (App.state().subjects.some((s) => s.name.toLowerCase() === name.toLowerCase())) return null;
    const sub = { id: App.uid(), name, emoji: "", color: "", level, created_at: now() };
    if (App.update((s) => s.subjects.push(sub), opts) === false) return null;
    return sub;
  };
  App.updateSubject = function (id, patch) {
    App.update((s) => {
      const sub = s.subjects.find((x) => x.id === id);
      if (sub) Object.assign(sub, patch);
    });
  };
  // renaming a subject cascades everywhere it's referenced by exact name string
  App.renameSubject = function (id, newName) {
    const sub = App.state().subjects.find((x) => x.id === id);
    if (!sub) return;
    const oldName = sub.name;
    newName = (newName || "").trim();
    if (!newName || newName === oldName) return;
    App.update((s) => {
      const target = s.subjects.find((x) => x.id === id);
      target.name = newName;
      s.tasks.forEach((t) => { if (t.subject_name === oldName) t.subject_name = newName; });
      s.sessions.forEach((x) => { if (x.subject_name === oldName) x.subject_name = newName; });
      s.grades.forEach((g) => { if (g.subject_name === oldName) g.subject_name = newName; });
      s.templates.forEach((tp) => { if (tp.subject_name === oldName) tp.subject_name = newName; });
      s.courses.forEach((c) => { (c.requirements || []).forEach((r) => { if (r.subject_name === oldName) r.subject_name = newName; }); });
      s.savedFilters.forEach((f) => { if (f.filters && f.filters.subject_name === oldName) f.filters.subject_name = newName; });
    });
  };
  // sets HL/SL and keeps the display name's trailing " HL"/" SL" token in sync
  App.setSubjectLevel = function (id, level) {
    const sub = App.state().subjects.find((x) => x.id === id);
    if (!sub) return;
    level = ["HL", "SL"].includes(level) ? level : "";
    const newName = App.composeSubjectName(App.parseSubjectLevel(sub.name).base, level);
    if (newName !== sub.name) App.renameSubject(id, newName);
    App.updateSubject(id, { level });
  };
  App.deleteSubject = function (id) {
    App.update((s) => { s.subjects = s.subjects.filter((x) => x.id !== id); });
  };
  // one-time backfill for subjects saved before the HL/SL field existed
  App.backfillSubjectLevels = function () {
    if (!App.state().subjects.some((s) => s.level === undefined)) return;
    // system: a one-time schema migration, not a user edit — it has to run even
    // in read-only mode or old data renders wrong for anyone without a license.
    App.update((s) => {
      s.subjects.forEach((sub) => { if (sub.level === undefined) sub.level = App.parseSubjectLevel(sub.name).level; });
    }, { silent: true, system: true });
  };
  // sum of current grades across HL subjects — used by the University "HL total" bar
  App.currentHLTotal = function () {
    const s = App.state();
    const hlNames = new Set(s.subjects.filter((x) => x.level === "HL").map((x) => x.name));
    return s.grades.reduce((sum, g) => sum + (hlNames.has(g.subject_name) ? (g.current_grade || 0) : 0), 0);
  };

  /* ---------- subject look (emoji + color) ----------
     Custom values live on the subject record; anything unset falls back to a
     keyword-matched emoji and a stable hash-picked color, so existing data
     looks polished with zero setup. */
  const SUBJECT_EMOJI_RULES = [
    [/math/i, "🧮"], [/phys/i, "⚛️"], [/chem/i, "🧪"], [/bio/i, "🧬"],
    [/econ/i, "📈"], [/business|management/i, "💼"], [/english|literat/i, "📖"],
    [/history/i, "🏛️"], [/geog/i, "🌍"], [/psych/i, "🧠"],
    [/computer|comp sci|\bcs\b/i, "💻"], [/\bart\b|visual/i, "🎨"], [/music/i, "🎵"],
    [/french|spanish|german|mandarin|chinese|japanese|italian|hindi|arabic|ab initio|\blang/i, "🗣️"],
    [/sport|exercise|\bpe\b|sehs/i, "⚽"], [/philosoph|tok/i, "💭"],
    [/environment|\bess\b/i, "🌱"], [/film|theat/i, "🎬"], [/global politic/i, "🗳️"],
  ];
  const SUBJECT_COLORS = [
    "#2a78d6", "#1baf7a", "#eda100", "#e34948", "#8b5cf6", "#0ea5b7",
    "#e87ba4", "#eb6834", "#4a3aa7", "#0d9488", "#b45309", "#c026d3",
  ];
  function subjectHash(name) {
    let h = 0;
    // String(): a subject name arriving as a number from a restored backup is
    // not iterable, and this runs under subjectMeta on nearly every page — it
    // blanked Subjects and Settings outright. legacySubject() coerces on
    // import, but migrate() only checks that subjects is an array.
    for (const ch of String(name || "")) h = (h * 31 + ch.codePointAt(0)) % 100003;
    return h;
  }
  App.defaultSubjectEmoji = function (name) {
    for (const [re, emoji] of SUBJECT_EMOJI_RULES) if (re.test(name)) return emoji;
    return "📘";
  };
  App.defaultSubjectColor = function (name) {
    return SUBJECT_COLORS[subjectHash(name) % SUBJECT_COLORS.length];
  };
  // An emoji is a couple of characters of text, never markup. Untrusted values
  // reach here from restored backups — migrate() doesn't normalise subjects, so
  // the import-time cap in legacySubject() is not on every path. Clamp at the
  // point of use too; the sinks escape as well.
  function safeEmoji(v) {
    return String(v || "").replace(/[<>&"']/g, "").slice(0, 8);
  }

  // name → {emoji, color}; works for unregistered stray names too
  App.subjectMeta = function (name) {
    if (!name) return { emoji: "", color: "" };
    const sub = App.state().subjects.find((x) => x.name === name);
    return {
      emoji: safeEmoji(sub && sub.emoji) || App.defaultSubjectEmoji(name),
      color: (sub && /^#[0-9a-fA-F]{6}$/.test(sub.color || "")) ? sub.color : App.defaultSubjectColor(name),
    };
  };

  // Both of these record a grade-trend point afterwards rather than inside the
  // update: recordGradeSnapshot reads predictedPoints() off committed state, so
  // it has to run once the grade is actually in. App.update returns false when
  // read-only refused the write, and there is nothing to record in that case.
  App.saveGrade = function (id, data) {
    const ok = App.update((s) => {
      if (id) {
        const g = s.grades.find((x) => x.id === id);
        if (g) Object.assign(g, data, { last_updated: D.today() });
      } else {
        s.grades.push(Object.assign({ id: App.uid(), notes: "", created_at: now() }, data, { last_updated: D.today() }));
      }
    });
    if (ok) App.recordGradeSnapshot();
    return ok;
  };
  App.deleteGrade = function (id) {
    const ok = App.update((s) => { s.grades = s.grades.filter((x) => x.id !== id); });
    if (ok) App.recordGradeSnapshot();
    return ok;
  };

  App.logSession = function (data) {
    const sess = Object.assign({
      id: App.uid(), task_id: "", task_title: "Study Session", subject_name: "",
      estimated_minutes: 0, overtime_minutes: 0,
      start_time: now(), end_time: now(), created_at: now(),
    }, data);
    App.update((s) => s.sessions.push(sess));
    App.xp.updateMaxStreak();
    App.xp.checkStreakMilestone();
    return sess;
  };

  App.sessionMinutes = function (sess) {
    const ms = new Date(sess.end_time) - new Date(sess.start_time);
    return isNaN(ms) ? 0 : Math.max(0, Math.round(ms / 60000));
  };

  // total focused minutes logged in the current week (Monday-start)
  App.weekMinutes = function () {
    const weekStart = D.mondayOf(D.today());
    return App.state().sessions.reduce((sum, x) => {
      const ds = D.isoToDateStr(x.start_time);
      return ds && ds >= weekStart ? sum + App.sessionMinutes(x) : sum;
    }, 0);
  };

  App.deleteSession = function (id) {
    App.update((s) => { s.sessions = s.sessions.filter((x) => x.id !== id); });
  };

  /* ---------- university portals (quick-launch links) ---------- */
  // A portal is only stored if its URL survives App.safeURL, so nothing that
  // reaches an href later can be a javascript:/data: URL.
  App.savePortal = function (id, data) {
    const url = App.safeURL(data.url);
    if (!url) return null;
    const label = String(data.label || "").trim().slice(0, 40) || App.urlHost(url) || "Link";
    let saved = null;
    App.update((s) => {
      const existing = id ? s.portals.find((p) => p.id === id) : null;
      if (existing) { existing.label = label; existing.url = url; saved = existing; }
      else { saved = { id: App.uid(), label, url }; s.portals.push(saved); }
    });
    return saved;
  };
  App.deletePortal = function (id) {
    App.update((s) => { s.portals = s.portals.filter((p) => p.id !== id); });
  };

  /* ---------- busy blocks ----------
     kind: 'time'   {date, start_min, end_min}
           'weekly' {days:[0=Sun..6], start_min, end_min, from?, until?}
           'range'  {start_date, end_date} (all-day)

     Any timed block may also carry travel_before / travel_after minutes — the
     commute around it. The event keeps its real hours (school is 8–3) while the
     time it actually costs you (7–4) is what the scheduler must avoid.

     'weekly' used to be a single `dow`; blocks saved that way are read as a
     one-day `days` array so old data keeps working.                          */
  App.createBusyBlock = function (data) {
    const b = Object.assign({ id: App.uid(), title: "", category: "personal", kind: "time", created_at: now() }, data);
    for (const k of Object.keys(b)) if (b[k] === undefined) delete b[k];
    App.update((s) => s.busyBlocks.push(b));
    return b;
  };
  // An undefined value REMOVES the key — switching a block between one-off and
  // weekly has to clear the fields belonging to the other shape.
  App.updateBusyBlock = function (id, patch) {
    App.update((s) => {
      const b = s.busyBlocks.find((x) => x.id === id);
      if (!b) return;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete b[k]; else b[k] = v;
      }
    });
  };
  App.deleteBusyBlock = function (id) {
    App.update((s) => { s.busyBlocks = s.busyBlocks.filter((x) => x.id !== id); });
  };

  // The days a weekly block repeats on, tolerating the legacy single-dow shape.
  App.busyDays = function (b) {
    if (Array.isArray(b.days) && b.days.length) return b.days;
    return typeof b.dow === "number" ? [b.dow] : [];
  };

  App.busyTravel = function (b) {
    return {
      before: App.clamp(Math.round(Number(b.travel_before) || 0), 0, 240),
      after: App.clamp(Math.round(Number(b.travel_after) || 0), 0, 240),
    };
  };

  // Human summary of when a block repeats — used in the scheduler list and tooltips.
  const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  App.busyRepeatLabel = function (b) {
    if (b.kind !== "weekly") return "";
    const days = App.busyDays(b).slice().sort((a, c) => a - c);
    if (!days.length) return "Weekly";
    const set = new Set(days);
    if (days.length === 7) return "Every day";
    if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return "Weekdays";
    if (days.length === 2 && set.has(0) && set.has(6)) return "Weekends";
    return days.map((d) => DOW_SHORT[d]).join(", ");
  };

  // Busy segments overlapping a local date.
  // start_min/end_min are the FULL span (commute included) — that is what the
  // free-slot finders must treat as unavailable. core_start/core_end are the
  // event itself, so the calendar can shade the travel either side of it.
  App.busyOnDate = function (dateStr) {
    const out = [];
    const push = (b, coreStart, coreEnd) => {
      const t = App.busyTravel(b);
      const start = App.clamp(Number(coreStart) - t.before, 0, 1440);
      const end = App.clamp(Number(coreEnd) + t.after, 0, 1440);
      // A block with no usable times has to contribute nothing. Left alone it
      // becomes a [NaN, NaN] interval, and every NaN comparison is false, so
      // rather than being ignored it quietly perturbs the free-time maths —
      // measured: one such block changed Auto-Schedule from placing 6 tasks to
      // 5. Blocks like this arrive from restored backups, which don't go
      // through legacyBusy(). Guarding non-finite only, so a block with real
      // numbers keeps whatever semantics it already had.
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      out.push({
        block: b,
        start_min: start,
        end_min: end,
        core_start: Number(coreStart),
        core_end: Number(coreEnd),
        travel_before: t.before,
        travel_after: t.after,
      });
    };
    for (const b of App.state().busyBlocks) {
      if (b.kind === "weekly") {
        // a recurring commitment can be bounded to a term
        if (b.from && dateStr < b.from) continue;
        if (b.until && dateStr > b.until) continue;
        if (App.busyDays(b).includes(D.dayOfWeek(dateStr))) push(b, b.start_min, b.end_min);
      } else if (b.kind === "range") {
        if (dateStr >= b.start_date && dateStr <= b.end_date) {
          out.push({ block: b, start_min: 0, end_min: 1440, core_start: 0, core_end: 1440, travel_before: 0, travel_after: 0 });
        }
      } else {
        if (b.date === dateStr) push(b, b.start_min, b.end_min);
      }
    }
    return out.sort((a, b) => a.start_min - b.start_min);
  };

  /* ---------- scheduling ---------- */
  App.scheduledBlocksOn = function (dateStr) {
    const out = [];
    for (const t of App.state().tasks) {
      if (App.isArchived(t)) continue; // archived tasks drop off the calendar/scheduler
      for (const blk of t.scheduled_blocks || []) {
        if (blk.date === dateStr) out.push({ task: t, block: blk });
      }
    }
    return out.sort((a, b) => a.block.start_min - b.block.start_min);
  };

  App.unscheduleTask = function (taskId) {
    App.updateTask(taskId, { scheduled_blocks: [] });
  };
  App.removeScheduledBlock = function (taskId, blockId) {
    const t = App.taskById(taskId);
    if (!t) return;
    App.updateTask(taskId, { scheduled_blocks: (t.scheduled_blocks || []).filter((b) => b.id !== blockId) });
  };
  App.clearAllSchedules = function () {
    App.update((s) => s.tasks.forEach((t) => { t.scheduled_blocks = []; }));
  };

  function occupiedIntervals(dateStr, excludeTaskId, excludeBlockId) {
    const iv = [];
    for (const { task, block } of App.scheduledBlocksOn(dateStr)) {
      if (task.id === excludeTaskId && (!excludeBlockId || block.id === excludeBlockId)) continue;
      iv.push([block.start_min, block.start_min + block.duration]);
    }
    for (const seg of App.busyOnDate(dateStr)) iv.push([seg.start_min, seg.end_min]);
    iv.sort((a, b) => a[0] - b[0]);
    return iv;
  }

  // Place a task at/after the given minute on a date; snaps forward past conflicts.
  // Returns {ok, start_min} or {ok:false, reason}.
  App.scheduleTaskAt = function (taskId, dateStr, startMin, opts) {
    opts = opts || {};
    const t = App.taskById(taskId);
    if (!t) return { ok: false, reason: "Task not found" };
    const st = App.state().settings;
    const duration = opts.duration || t.estimated_minutes || 30;
    const dayEnd = (st.work_end_hour || 22) * 60;
    const occupied = occupiedIntervals(dateStr, taskId, opts.moveBlockId);

    let attempt = Math.max(startMin, 0);
    while (attempt + duration <= dayEnd) {
      const conflict = occupied.find(([a, b]) => attempt < b && attempt + duration > a);
      if (!conflict) break;
      attempt = conflict[1];
    }
    if (attempt + duration > dayEnd) {
      return { ok: false, reason: "No room in your work hours that day — try another day or extend your hours in Settings." };
    }

    App.update((s) => {
      const task = s.tasks.find((x) => x.id === taskId);
      if (!task) return;
      task.scheduled_blocks = task.scheduled_blocks || [];
      if (opts.moveBlockId) {
        const blk = task.scheduled_blocks.find((b) => b.id === opts.moveBlockId);
        if (blk) { blk.date = dateStr; blk.start_min = attempt; blk.duration = duration; }
        else task.scheduled_blocks.push({ id: App.uid(), date: dateStr, start_min: attempt, duration });
      } else {
        // manual placement replaces any prior schedule for this task
        task.scheduled_blocks = [{ id: App.uid(), date: dateStr, start_min: attempt, duration }];
      }
      task.updated_at = now();
    });
    return { ok: true, start_min: attempt };
  };

  /* ---------- auto-scheduler ---------- */
  App.autoSchedule = function (cfg) {
    const s = App.state();
    const settings = s.settings;
    const maxSessionGlobal = cfg.maxSession || 90;
    const breakMinutes = cfg.breakMinutes || 15;
    const includeBreaks = cfg.includeBreaks !== false;

    const weekDates = [];
    for (let i = 0; i < 7; i++) weekDates.push(D.addDays(cfg.weekStart, i));
    const todayStr = D.today();
    const futureDates = weekDates.filter((ds) => ds >= todayStr);
    if (futureDates.length === 0) {
      return { scheduled_count: 0, error_count: 1, errors: [{ title: "This week is in the past", reason: "Navigate to the current or a future week first." }] };
    }

    const startHour = settings.work_start_hour || 8;
    const endHour = settings.work_end_hour || 22;
    const hoursPerDay = settings.hours_per_day || {};

    // busy[ds] = merged occupied intervals; taskMinutes[ds] = study minutes
    // already claimed that day (hours_per_day is a daily *budget*, so busy
    // blocks like school don't eat it — only scheduled study time does)
    const busy = {};
    const taskMinutes = {};
    for (const ds of futureDates) {
      const iv = [];
      let mins = 0;
      for (const seg of App.busyOnDate(ds)) iv.push([seg.start_min, seg.end_min]);
      for (const { block } of App.scheduledBlocksOn(ds)) {
        iv.push([block.start_min, block.start_min + block.duration]);
        mins += block.duration;
      }
      busy[ds] = mergeIntervals(iv);
      taskMinutes[ds] = mins;
    }

    const taskMap = App.taskMap();
    const incomplete = s.tasks.filter((t) => !t.completed);
    const unscheduled = incomplete.filter((t) => !(t.scheduled_blocks || []).length);

    const priRank = { critical: 0, high: 1, medium: 2, low: 3 };
    unscheduled.sort((a, b) => {
      const pa = priRank[a.priority] ?? 2, pb = priRank[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    });

    // Topological sort so predecessors come first
    const sorted = [];
    const visited = new Set(), visiting = new Set();
    function visit(id) {
      if (visited.has(id) || visiting.has(id)) return;
      visiting.add(id);
      const t = taskMap.get(id);
      if (t && t.predecessor_id && taskMap.has(t.predecessor_id)) visit(t.predecessor_id);
      visiting.delete(id);
      visited.add(id);
      if (t && !t.completed && !(t.scheduled_blocks || []).length) sorted.push(t);
    }
    unscheduled.forEach((t) => visit(t.id));

    const placedEnd = {}; // taskId -> {ds, endMin}
    const results = [];   // {taskId, blocks:[{date,start_min,duration}]}
    const errors = [];

    for (const task of sorted) {
      // predecessor constraint
      let earliestDs = null, earliestMin = 0;
      if (task.predecessor_id) {
        const pred = taskMap.get(task.predecessor_id);
        if (pred && !pred.completed) {
          const predBlocks = pred.scheduled_blocks || [];
          if (predBlocks.length) {
            const last = [...predBlocks].sort((a, b) => (a.date + String(a.start_min).padStart(4, "0")).localeCompare(b.date + String(b.start_min).padStart(4, "0"))).pop();
            earliestDs = last.date; earliestMin = last.start_min + last.duration;
          } else if (placedEnd[task.predecessor_id]) {
            earliestDs = placedEnd[task.predecessor_id].ds;
            earliestMin = placedEnd[task.predecessor_id].endMin;
          } else {
            errors.push({ title: task.title, reason: "Its predecessor couldn't be scheduled" });
            continue;
          }
        }
      }

      const totalDur = task.estimated_minutes || 30;
      const maxSession = task.max_session_minutes || maxSessionGlobal;
      const chunks = [];
      let remaining = totalDur;
      while (remaining > 0) { const c = Math.min(remaining, maxSession); chunks.push(c); remaining -= c; }

      const placed = [];
      const tentative = []; // intervals added to busy, for rollback
      let cursorDs = earliestDs, cursorMin = earliestMin;

      for (let ci = 0; ci < chunks.length; ci++) {
        const dur = chunks[ci];
        let ok = false;
        for (const ds of futureDates) {
          if (cursorDs && ds < cursorDs) continue;
          const dayName = App.DAY_KEYS[(D.dayOfWeek(ds) + 6) % 7];
          const dayBudget = (hoursPerDay[dayName] || 0) * 60;
          if (dayBudget <= 0 || taskMinutes[ds] + dur > dayBudget) continue;

          let workStart = startHour * 60;
          const workEnd = endHour * 60;
          if (ds === todayStr) {
            const nowD = new Date();
            const nowMin = nowD.getHours() * 60 + nowD.getMinutes();
            if (nowMin >= workEnd) continue;
            workStart = Math.max(workStart, nowMin);
          }
          if (cursorDs && ds === cursorDs) {
            workStart = Math.max(workStart, cursorMin);
            if (workStart >= workEnd) continue;
          }

          const slot = findGap(busy[ds], workStart, workEnd, dur);
          if (slot !== null) {
            const interval = [slot, slot + dur + (includeBreaks && ci < chunks.length - 1 ? breakMinutes : 0)];
            busy[ds] = mergeIntervals([...busy[ds], interval]);
            taskMinutes[ds] += dur;
            tentative.push({ ds, interval, dur });
            placed.push({ id: App.uid(), date: ds, start_min: slot, duration: dur });
            cursorDs = ds; cursorMin = interval[1];
            ok = true;
            break;
          }
        }
        if (!ok) break;
      }

      if (placed.length === chunks.length) {
        results.push({ taskId: task.id, title: task.title, subject_name: task.subject_name || "", blocks: placed });
        const last = placed[placed.length - 1];
        placedEnd[task.id] = { ds: last.date, endMin: last.start_min + last.duration };
      } else {
        // rollback tentative intervals so failed chunks don't poison other tasks
        for (const { ds, interval, dur } of tentative) {
          busy[ds] = busy[ds].filter((iv) => !(iv[0] === interval[0] && iv[1] === interval[1]));
          busy[ds] = mergeIntervals(busy[ds]);
          taskMinutes[ds] -= dur;
        }
        errors.push({ title: task.title, reason: "Not enough free time in the week" });
      }
    }

    if (results.length) {
      App.update((st2) => {
        for (const r of results) {
          const t = st2.tasks.find((x) => x.id === r.taskId);
          if (t) { t.scheduled_blocks = r.blocks; t.updated_at = now(); }
        }
      });
    }
    return { scheduled_count: results.length, error_count: errors.length, errors, placed: results };
  };

  function mergeIntervals(iv) {
    const sorted = [...iv].sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [a, b] of sorted) {
      if (out.length && a <= out[out.length - 1][1]) {
        out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
      } else out.push([a, b]);
    }
    return out;
  }

  function findGap(busyIv, workStart, workEnd, dur) {
    let cursor = workStart;
    for (const [a, b] of busyIv) {
      if (b <= cursor) continue;
      if (a - cursor >= dur && cursor + dur <= workEnd) return cursor;
      cursor = Math.max(cursor, b);
      if (cursor + dur > workEnd) return null;
    }
    return cursor + dur <= workEnd ? cursor : null;
  }

  /* ---------- templates ---------- */
  App.saveTemplate = function (id, data) {
    App.update((s) => {
      if (id) {
        const t = s.templates.find((x) => x.id === id);
        if (t) Object.assign(t, data);
      } else {
        s.templates.push(Object.assign({ id: App.uid(), created_at: now() }, data));
      }
    });
  };
  App.deleteTemplate = function (id) {
    App.update((s) => { s.templates = s.templates.filter((x) => x.id !== id); });
  };
  /* ---------- saved filters ---------- */
  App.saveFilterView = function (name, filters) {
    App.update((s) => s.savedFilters.push({ id: App.uid(), name, filters: Object.assign({}, filters), created_at: now() }));
  };
  App.deleteFilterView = function (id) {
    App.update((s) => { s.savedFilters = s.savedFilters.filter((x) => x.id !== id); });
  };

  /* ---------- university ---------- */
  App.saveCourse = function (id, data) {
    App.update((s) => {
      if (id) {
        const c = s.courses.find((x) => x.id === id);
        if (c) Object.assign(c, data, { updated_at: now() });
      } else {
        s.courses.push(Object.assign({ id: App.uid(), status: "not_started", key_steps: [], materials: [], created_at: now(), updated_at: now() }, data));
      }
    });
  };
  App.deleteCourse = function (id) {
    App.update((s) => {
      s.courses = s.courses.filter((x) => x.id !== id);
      s.tasks.forEach((t) => { if (t.university_course_id === id) t.university_course_id = ""; });
    });
  };
  App.updateCourse = function (id, patch) {
    App.update((s) => {
      const c = s.courses.find((x) => x.id === id);
      if (c) Object.assign(c, patch, { updated_at: now() });
    });
  };

  /* ---------- notes ---------- */
  App.noteById = (id) => App.state().notes.find((n) => n.id === id) || null;

  App.addNote = function (title) {
    const id = App.uid();
    App.update((s) => {
      s.notes.unshift({ id, title: title || "", body: "", format: "html", pinned: false, created_at: now(), updated_at: now() });
    });
    return id;
  };

  App.updateNote = function (id, patch, opts) {
    App.update((s) => {
      const n = s.notes.find((x) => x.id === id);
      if (n) Object.assign(n, patch, { updated_at: now() });
    }, opts);
  };

  App.deleteNote = function (id) {
    App.update((s) => { s.notes = s.notes.filter((n) => n.id !== id); });
  };

  /* ---------- focus mode ---------- */
  App.addAllowed = function (label) {
    label = (label || "").trim();
    if (!label) return;
    App.update((s) => { s.focus.allowlist.push({ id: App.uid(), label }); });
  };
  App.removeAllowed = function (id) {
    App.update((s) => { s.focus.allowlist = s.focus.allowlist.filter((a) => a.id !== id); });
  };
  App.startFocusLock = function () {
    App.update((s) => { s.focus.locked = true; s.focus.leaves = 0; s.focus.lockedAt = now(); });
  };
  App.endFocusLock = function () {
    App.update((s) => { s.focus.locked = false; s.focus.lockedAt = ""; });
  };
  App.recordFocusLeave = function () {
    App.update((s) => { if (s.focus.locked) s.focus.leaves += 1; }, { silent: true });
  };

  /* A point on the University grade-trend chart, recorded when the average
     subject grade actually MOVES.

     This used to sample once a week from boot, which drew a long flat line
     between real changes: the chart looked busy while saying nothing, and the
     shape of it depended on how often the app was opened rather than on how the
     student was doing. Now saveGrade/deleteGrade call it, so the series is a
     record of events rather than a record of app launches.

     The invariant is that consecutive points always differ — a point only
     exists because something changed. Same-day edits collapse into one point
     (the chart is plotted by date), and an edit that lands back on the previous
     value removes today's point rather than leaving a flat step behind.

     Silent: the caller's own update already scheduled a render, and renders
     coalesce per microtask, so this rides along with it. */
  /* Snapshots carry BOTH the average subject grade and the predicted total.
     The chart plots the total, because /45 is the number offers are written
     in, but `avg` stays: it is what older snapshots hold, and dropping it
     would silently rewrite history.

     A point recorded before this change has no `total` and cannot get one —
     it would need the subject count and core points as they were on that day,
     which were never stored. Those points are skipped by the chart rather
     than guessed at. */
  App.recordGradeSnapshot = function () {
    const pp = App.predictedPoints();
    if (pp.avgGrade === null) return false;
    const today = D.today();
    let recorded = false;
    App.update((s) => {
      const snaps = s.gradeSnapshots;
      const idx = snaps.findIndex((x) => x.date === today);
      // Latest point that isn't today's. Sorted rather than assuming the tail,
      // because imported data can arrive with dates ahead of this machine's.
      const prev = snaps
        .filter((x) => x.date !== today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .pop() || null;

      if (idx >= 0) {
        if (snaps[idx].avg === pp.avgGrade && snaps[idx].total === pp.totalPoints) return; // already says this
        if (prev && prev.avg === pp.avgGrade && prev.total === pp.totalPoints) { // moved back — no change to plot
          snaps.splice(idx, 1);
          recorded = true;
          return;
        }
        snaps[idx].avg = pp.avgGrade;
        snaps[idx].total = pp.totalPoints;
        recorded = true;
        return;
      }

      if (prev && prev.avg === pp.avgGrade && prev.total === pp.totalPoints) return; // nothing moved
      snaps.push({ date: today, avg: pp.avgGrade, total: pp.totalPoints });
      snaps.sort((a, b) => a.date.localeCompare(b.date));
      if (snaps.length > 104) s.gradeSnapshots = snaps.slice(-104);
      recorded = true;
    }, { silent: true });
    return recorded;
  };

  /* ---------- filtering (shared by Timeline / Subjects) ---------- */
  App.applyTaskFilters = function (tasks, f) {
    let out = tasks;
    if (f.category && f.category !== "all") out = out.filter((t) => t.category === f.category);
    if (f.priority && f.priority !== "all") out = out.filter((t) => t.priority === f.priority);
    if (f.completed === "incomplete") out = out.filter((t) => !t.completed);
    if (f.completed === "done") out = out.filter((t) => t.completed);
    if (f.subject_name && f.subject_name !== "all") out = out.filter((t) => t.subject_name === f.subject_name);
    if (f.search) {
      const q = f.search.toLowerCase();
      out = out.filter((t) => (t.title || "").toLowerCase().includes(q) || (t.description || "").toLowerCase().includes(q));
    }
    return out;
  };

  /* ============================================================
     IMPORT / EXPORT
     ============================================================ */
  App.exportBackup = function () {
    // deep copy so secrets can be stripped — they never leave this machine
    const data = JSON.parse(JSON.stringify(App.state()));
    if (data.settings) data.settings.ai_api_key = "";
    // The license key goes too. Backups get emailed, synced and sent in with
    // support questions, and anyone holding one could read the key straight out
    // and enter it themselves. Nothing is lost by removing it: importing a
    // backup replaces ui wholesale ({welcomed:true}), so the key was never
    // restored from here anyway — it only ever leaked outward.
    if (data.ui) { data.ui.license_key = ""; data.ui.license_date_seen = ""; }
    const payload = { app: "ib-study-tracker", version: 1, exported_at: now(), data };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ib-tracker-backup-${D.today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    App.update((s) => { s.settings.last_backup_at = new Date().toISOString(); }, { silent: true });
  };

  const BACKUP_STALE_DAYS = 14;
  App.hasMeaningfulData = function () {
    const s = App.state();
    return !!(s.tasks.length || s.sessions.length || s.grades.length || s.courses.length);
  };
  App.daysSinceBackup = function () {
    const last = App.state().settings.last_backup_at;
    const ds = last ? D.isoToDateStr(last) : null;
    return ds ? Math.max(0, D.diffDays(ds, D.today())) : null;
  };
  App.lastBackupLabel = function () {
    const n = App.daysSinceBackup();
    if (n === null) return "never exported";
    if (n === 0) return "today";
    return n === 1 ? "yesterday" : `${n} days ago`;
  };
  App.backupOverdue = function () {
    if (!App.hasMeaningfulData()) return false;
    const n = App.daysSinceBackup();
    return n === null || n >= BACKUP_STALE_DAYS;
  };
  // overdue AND not snoozed — drives the Dashboard nudge
  App.backupNudgeDue = function () {
    if (!App.backupOverdue()) return false;
    const snooze = App.state().ui.backup_snooze_until;
    return !(snooze && snooze > D.today());
  };
  App.snoozeBackupNudge = function () {
    // system: dismissing a nudge is bookkeeping. Refusing it means an unlicensed
    // copy — which can still export backups — nags about it and can never be
    // told to stop.
    App.update((s) => { s.ui.backup_snooze_until = D.addDays(D.today(), 7); }, { silent: true, system: true });
  };

  /* --- legacy import field mapping (understands common export field names) --- */
  function legacyTask(t) {
    const blocks = [];
    if (t.scheduled_blocks && Array.isArray(t.scheduled_blocks)) {
      for (const b of t.scheduled_blocks) {
        if (b && b.date) blocks.push({ id: b.id || App.uid(), date: b.date, start_min: b.start_min || 0, duration: b.duration || 30 });
      }
    } else if (t.scheduled_date) {
      blocks.push({
        id: App.uid(),
        date: D.isoToDateStr(t.scheduled_date),
        start_min: D.isoToMin(t.scheduled_date),
        duration: Number(t.scheduled_duration) || Number(t.estimated_minutes) || 30,
      });
    }
    return {
      id: t.id || App.uid(),
      title: String(t.title || "Untitled task"),
      description: t.description || "",
      category: App.CATEGORIES[t.category] ? t.category : "subject_task",
      subject_name: t.subject_name || "",
      university_course_id: t.university_course_id || "",
      due_date: t.due_date ? String(t.due_date).slice(0, 10) : "",
      priority: App.PRIORITIES[t.priority] ? t.priority : "medium",
      estimated_minutes: Number(t.estimated_minutes) || 0,
      completed: !!t.completed,
      completed_at: t.completed_at || (t.completed ? (t.updated_date || t.updated_at || null) : null),
      progress: Number(t.progress) || (t.completed ? 100 : 0),
      recurring: App.RECURRENCE[t.recurring] ? t.recurring : "none",
      predecessor_id: t.predecessor_id || "",
      scheduled_blocks: blocks.filter((b) => b.date),
      min_session_minutes: Number(t.min_session_minutes) || 0,
      max_session_minutes: Number(t.max_session_minutes) || 0,
      created_at: t.created_at || t.created_date || now(),
      updated_at: t.updated_at || t.updated_date || now(),
    };
  }

  function legacySubtask(st) {
    return {
      id: st.id || App.uid(), task_id: st.task_id || "",
      title: String(st.title || ""), completed: !!st.completed,
      estimated_minutes: Number(st.estimated_minutes) || 0,
      sort_order: Number(st.sort_order) || 0,
      created_at: st.created_at || st.created_date || now(),
    };
  }

  function legacySubject(su) {
    const name = String(su.name || "").trim();
    const level = ["HL", "SL"].includes(String(su.level || "").toUpperCase())
      ? String(su.level).toUpperCase() : App.parseSubjectLevel(name).level;
    return {
      id: su.id || App.uid(), name,
      emoji: typeof su.emoji === "string" ? su.emoji.slice(0, 8) : "",
      color: /^#[0-9a-fA-F]{6}$/.test(su.color || "") ? su.color : "",
      level,
      created_at: su.created_at || su.created_date || now(),
    };
  }

  function legacyGrade(g) {
    return {
      id: g.id || App.uid(), subject_name: String(g.subject_name || ""),
      current_grade: Number(g.current_grade) || 0, target_grade: Number(g.target_grade) || 0,
      last_updated: g.last_updated ? String(g.last_updated).slice(0, 10) : D.today(),
      notes: g.notes || "", created_at: g.created_at || g.created_date || now(),
    };
  }

  function legacySession(sess) {
    return {
      id: sess.id || App.uid(), task_id: sess.task_id || "",
      task_title: sess.task_title || "Study Session", subject_name: sess.subject_name || "",
      estimated_minutes: Number(sess.estimated_minutes) || 0,
      overtime_minutes: Number(sess.overtime_minutes) || 0,
      start_time: sess.start_time, end_time: sess.end_time,
      created_at: sess.created_at || sess.created_date || sess.start_time || now(),
    };
  }

  function legacyBusy(b) {
    if (b.kind) { // already in new format
      const out = Object.assign({ id: App.uid(), title: "", category: "personal", created_at: now() }, b);
      if (out.kind === "weekly") {
        // normalise the legacy single `dow` into the days array
        const days = (Array.isArray(out.days) ? out.days : (typeof out.dow === "number" ? [out.dow] : []))
          .map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
        out.days = [...new Set(days)].sort((x, y) => x - y);
        if (!out.days.length) out.days = [1];
        delete out.dow;
        for (const k of ["from", "until"]) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(out[k] || "")) delete out[k];
        }
      }
      out.travel_before = App.clamp(Math.round(Number(out.travel_before) || 0), 0, 240);
      out.travel_after = App.clamp(Math.round(Number(out.travel_after) || 0), 0, 240);
      return out;
    }
    const startDs = D.isoToDateStr(b.start_time);
    const endDs = D.isoToDateStr(b.end_time);
    const base = { id: b.id || App.uid(), title: String(b.title || "Busy"), category: b.category || "personal", created_at: b.created_at || b.created_date || now() };
    if (b.is_recurring) {
      return Object.assign(base, { kind: "weekly", days: [startDs ? D.dayOfWeek(startDs) : 1], start_min: D.isoToMin(b.start_time), end_min: Math.max(D.isoToMin(b.end_time), D.isoToMin(b.start_time) + 15) });
    }
    if (startDs && endDs && startDs !== endDs) {
      return Object.assign(base, { kind: "range", start_date: startDs, end_date: endDs });
    }
    return Object.assign(base, { kind: "time", date: startDs || D.today(), start_min: D.isoToMin(b.start_time), end_min: Math.max(D.isoToMin(b.end_time), D.isoToMin(b.start_time) + 15) });
  }

  function legacyTemplate(t) {
    return {
      id: t.id || App.uid(), name: String(t.name || "Template"),
      category: App.CATEGORIES[t.category] ? t.category : "subject_task",
      subject_name: t.subject_name || "",
      priority: App.PRIORITIES[t.priority] ? t.priority : "medium",
      estimated_minutes: Number(t.estimated_minutes) || 0,
      sub_tasks: Array.isArray(t.sub_tasks) ? t.sub_tasks.map((st) => ({ title: String(st.title || ""), estimated_minutes: Number(st.estimated_minutes) || 0 })) : [],
      created_at: t.created_at || t.created_date || now(),
    };
  }

  function legacyFilter(f) {
    return { id: f.id || App.uid(), name: String(f.name || "View"), filters: f.filters || {}, created_at: f.created_at || f.created_date || now() };
  }

  function legacyCourse(c) {
    return {
      id: c.id || App.uid(),
      university_name: String(c.university_name || ""), course_name: String(c.course_name || ""),
      application_deadline: c.application_deadline ? String(c.application_deadline).slice(0, 10) : "",
      entrance_exam_date: c.entrance_exam_date ? String(c.entrance_exam_date).slice(0, 10) : "",
      interview_date: c.interview_date ? String(c.interview_date).slice(0, 10) : "",
      offer_ib_points: Number(c.offer_ib_points) || 0,
      hl_total_required: App.clamp(Number(c.hl_total_required) || 0, 0, 21),
      requirements: Array.isArray(c.requirements)
        ? c.requirements.map((r) => ({ subject_name: String(r.subject_name || ""), grade: App.clamp(Number(r.grade) || 0, 0, 7) })).filter((r) => r.subject_name)
        : [],
      status: App.UNI_STATUSES[c.status] ? c.status : "not_started",
      tuition_cny: Number(c.tuition_cny) || 0,
      tuition_secondary: Number(c.tuition_secondary) || 0,
      tuition_currency: c.tuition_currency || "USD",
      notes: c.notes || "",
      key_steps: Array.isArray(c.key_steps) ? c.key_steps.map((k) => ({ item: String(k.item || ""), completed: !!k.completed })) : [],
      materials: Array.isArray(c.materials) ? c.materials.map((k) => ({ item: String(k.item || ""), completed: !!k.completed })) : [],
      links: Array.isArray(c.links)
        ? c.links.map((l) => ({ label: String(l.label || "").slice(0, 40), url: App.safeURL(l.url) }))
            .filter((l) => l.url).slice(0, 20)
        : [],
      created_at: c.created_at || c.created_date || now(),
      updated_at: c.updated_at || c.updated_date || now(),
    };
  }

  function legacySettings(u) {
    const out = {};
    if (u.hours_per_day && typeof u.hours_per_day === "object") {
      out.hours_per_day = {};
      for (const k of App.DAY_KEYS) out.hours_per_day[k] = Number(u.hours_per_day[k]) || 0;
    }
    if (u.work_start_hour !== undefined && u.work_start_hour !== "") out.work_start_hour = App.clamp(Number(u.work_start_hour) || 8, 0, 23);
    if (u.work_end_hour !== undefined && u.work_end_hour !== "") out.work_end_hour = App.clamp(Number(u.work_end_hour) || 22, 1, 24);
    if (u.ee_grade !== undefined) out.ee_grade = ["A","B","C","D","E"].includes(u.ee_grade) ? u.ee_grade : "";
    if (u.tok_grade !== undefined) out.tok_grade = ["A","B","C","D","E"].includes(u.tok_grade) ? u.tok_grade : "";
    if (u.theme) out.theme = u.theme;
    if (u.coach_tone === "warm" || u.coach_tone === "direct") out.coach_tone = u.coach_tone;
    if (typeof u.ai_model === "string" && u.ai_model) out.ai_model = u.ai_model;
    if (typeof u.appName === "string" && u.appName.trim()) out.appName = u.appName.trim().slice(0, 40);
    if (/^\d{4}-\d{2}-\d{2}$/.test(u.exam_date || "")) out.exam_date = u.exam_date;
    if (typeof u.max_streak === "number" && u.max_streak > 0) out.max_streak = Math.round(u.max_streak);
    if (typeof u.last_backup_at === "string" && u.last_backup_at) out.last_backup_at = u.last_backup_at;
    if (u.weekly_goal_hours !== undefined) out.weekly_goal_hours = App.clamp(Math.round(Number(u.weekly_goal_hours) || 0), 0, 80);
    if (u.target_points !== undefined) out.target_points = App.clamp(Math.round(Number(u.target_points) || 40), 24, 45);
    if (typeof u.pomodoro_enabled === "boolean") out.pomodoro_enabled = u.pomodoro_enabled;
    if (u.pomodoro_focus_min !== undefined) out.pomodoro_focus_min = App.clamp(Math.round(Number(u.pomodoro_focus_min) || 25), 5, 120);
    if (u.pomodoro_break_min !== undefined) out.pomodoro_break_min = App.clamp(Math.round(Number(u.pomodoro_break_min) || 5), 1, 60);
    if (Array.isArray(u.default_materials)) {
      out.default_materials = u.default_materials.map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
    }
    if (Array.isArray(u.default_key_steps)) {
      out.default_key_steps = u.default_key_steps.map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
    }
    if (typeof u.auto_update_check === "boolean") out.auto_update_check = u.auto_update_check;
    if (typeof u.sound_enabled === "boolean") out.sound_enabled = u.sound_enabled;
    if (typeof u.desktop_notifications === "boolean") out.desktop_notifications = u.desktop_notifications;
    if (typeof u.last_streak_milestone === "number" && u.last_streak_milestone > 0) {
      out.last_streak_milestone = Math.round(u.last_streak_milestone);
    }
    return out;
  }

  const ENTITY_MAP = {
    task: { key: "tasks", map: legacyTask, aliases: ["task", "tasks"] },
    subtask: { key: "subtasks", map: legacySubtask, aliases: ["subtask", "subtasks", "sub_task", "sub_tasks"] },
    subject: { key: "subjects", map: legacySubject, aliases: ["subject", "subjects"] },
    grade: { key: "grades", map: legacyGrade, aliases: ["grade", "grades"] },
    session: { key: "sessions", map: legacySession, aliases: ["timersession", "timersessions", "timer_session", "timer_sessions", "session", "sessions"] },
    busy: { key: "busyBlocks", map: legacyBusy, aliases: ["busyblock", "busyblocks", "busy_block", "busy_blocks"] },
    template: { key: "templates", map: legacyTemplate, aliases: ["tasktemplate", "tasktemplates", "task_template", "task_templates", "template", "templates"] },
    filter: { key: "savedFilters", map: legacyFilter, aliases: ["savedfilter", "savedfilters", "saved_filter", "saved_filters", "filter", "filters"] },
    course: { key: "courses", map: legacyCourse, aliases: ["universitycourse", "universitycourses", "university_course", "university_courses", "course", "courses"] },
    settings: { key: "settings", map: legacySettings, aliases: ["usersettings", "user_settings", "settings"] },
  };
  App.ENTITY_MAP = ENTITY_MAP;

  function entityForAlias(name) {
    const n = String(name).toLowerCase().replace(/[^a-z_]/g, "");
    for (const ent of Object.values(ENTITY_MAP)) {
      if (ent.aliases.includes(n)) return ent;
    }
    return null;
  }

  // Import parsed JSON. mode: 'replace' | 'merge'. Returns summary {counts:{}, errors:[]}
  App.importJSON = function (obj, mode) {
    const summary = { counts: {}, errors: [] };
    let source = obj;
    if (obj && obj.app === "ib-study-tracker" && obj.data) source = obj.data;

    const incoming = App.emptyData();
    let found = false;

    if (source && typeof source === "object" && !Array.isArray(source)) {
      for (const [key, val] of Object.entries(source)) {
        const ent = entityForAlias(key);
        if (!ent) continue;
        if (ent.key === "settings") {
          const raw = Array.isArray(val) ? val[0] : val;
          if (raw && typeof raw === "object") {
            incoming.settings = Object.assign(incoming.settings, legacySettings(raw));
            found = true;
            summary.counts.settings = 1;
          }
          continue;
        }
        if (!Array.isArray(val)) continue;
        const mapped = [];
        for (const row of val) {
          try { if (row && typeof row === "object") mapped.push(ent.map(row)); }
          catch (e) { summary.errors.push(`Skipped a ${key} row: ${e.message}`); }
        }
        incoming[ent.key] = mapped;
        summary.counts[ent.key] = mapped.length;
        found = true;
      }
    } else if (Array.isArray(source)) {
      summary.errors.push("A bare array needs an entity type — use the CSV importer and pick the type instead.");
    }

    if (!found) {
      summary.errors.push("No recognizable data found in this file.");
      return summary;
    }

    // coach conversation from our own backups
    const coachMsgs = source && source.coach && Array.isArray(source.coach.messages)
      ? source.coach.messages
          .filter((m) => m && (m.role === "user" || m.role === "coach") && typeof m.text === "string")
          .slice(-200)
      : null;
    // extra top-level state carried by our own backups
    const scratchpad = source && typeof source.scratchpad === "string" ? source.scratchpad : null;
    const snapshots = source && Array.isArray(source.gradeSnapshots)
      ? source.gradeSnapshots.filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && typeof x.avg === "number")
      : null;
    // notes and the focus allow-list live outside ENTITY_MAP, so they have to be
    // carried across explicitly — otherwise restoring a backup silently wipes them
    const notes = source && Array.isArray(source.notes)
      ? source.notes.filter((n) => n && typeof n === "object").map((n) => ({
          id: n.id || App.uid(),
          title: typeof n.title === "string" ? n.title : "",
          body: typeof n.body === "string" ? n.body : "",
          format: n.format === "html" ? "html" : "markdown",
          pinned: !!n.pinned,
          created_at: n.created_at || now(),
          updated_at: n.updated_at || n.created_at || now(),
        }))
      : null;
    const portals = source && Array.isArray(source.portals)
      ? source.portals.map((p) => ({ id: p && p.id ? p.id : App.uid(), label: String((p && p.label) || "").slice(0, 40), url: App.safeURL(p && p.url) }))
          .filter((p) => p.url)
      : null;
    const focus = source && source.focus && typeof source.focus === "object"
      ? Object.assign(App.defaultFocus(), {
          allowlist: Array.isArray(source.focus.allowlist)
            ? source.focus.allowlist.filter((a) => a && typeof a.label === "string")
                .map((a) => ({ id: a.id || App.uid(), label: a.label }))
            : [],
        })
      : null;

    if (mode === "replace") {
      const fresh = App.emptyData();
      for (const ent of Object.values(ENTITY_MAP)) {
        if (ent.key === "settings") continue;
        fresh[ent.key] = incoming[ent.key];
      }
      fresh.settings = Object.assign(App.defaultSettings(), incoming.settings);
      // backups never contain the API key — keep the one on this machine
      fresh.settings.ai_api_key = App.state().settings.ai_api_key || "";
      fresh.ui = { welcomed: true };
      if (coachMsgs) fresh.coach = { messages: coachMsgs };
      if (scratchpad !== null) fresh.scratchpad = scratchpad;
      if (snapshots) fresh.gradeSnapshots = snapshots;
      if (notes) fresh.notes = notes;
      if (focus) fresh.focus = focus;
      if (portals) { fresh.portals = portals; fresh.ui.portals_seeded = true; }
      App.replaceState(fresh);
    } else {
      App.update((s) => {
        for (const ent of Object.values(ENTITY_MAP)) {
          if (ent.key === "settings") continue;
          const cur = s[ent.key];
          for (const row of incoming[ent.key]) {
            const idx = cur.findIndex((x) => x.id === row.id);
            if (idx >= 0) cur[idx] = row; else cur.push(row);
          }
        }
        if (summary.counts.settings) s.settings = Object.assign({}, s.settings, incoming.settings);
        if (coachMsgs) s.coach = { messages: coachMsgs };
        if (scratchpad !== null && !s.scratchpad) s.scratchpad = scratchpad;
        if (snapshots) {
          const seen = new Set(s.gradeSnapshots.map((x) => x.date));
          snapshots.forEach((x) => { if (!seen.has(x.date)) s.gradeSnapshots.push(x); });
          s.gradeSnapshots.sort((a, b) => a.date.localeCompare(b.date));
        }
        if (notes) {
          for (const n of notes) {
            const idx = s.notes.findIndex((x) => x.id === n.id);
            if (idx >= 0) s.notes[idx] = n; else s.notes.push(n);
          }
        }
        if (focus) {
          const seen = new Set(s.focus.allowlist.map((a) => a.label.toLowerCase()));
          focus.allowlist.forEach((a) => { if (!seen.has(a.label.toLowerCase())) s.focus.allowlist.push(a); });
        }
        if (portals) {
          const seen = new Set(s.portals.map((p) => p.url));
          portals.forEach((p) => { if (!seen.has(p.url)) s.portals.push(p); });
          s.ui.portals_seeded = true;
        }
        s.ui.welcomed = true;
      });
    }
    return summary;
  };

  // Import a CSV export for one entity type
  App.importCSV = function (text, entityAlias, mode) {
    const ent = entityForAlias(entityAlias);
    if (!ent) return { counts: {}, errors: ["Unknown entity type."] };
    const rows = parseCSV(text);
    if (rows.length < 2) return { counts: {}, errors: ["CSV appears to be empty."] };
    const headers = rows[0].map((h) => h.trim());
    const objs = [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].length === 1 && rows[i][0] === "") continue;
      const o = {};
      headers.forEach((h, j) => {
        let v = rows[i][j];
        if (v === undefined) v = "";
        // JSON-ish cells (arrays / objects / bools / numbers)
        const trimmed = String(v).trim();
        if (/^[\[{]/.test(trimmed)) { try { v = JSON.parse(trimmed); } catch (e) { /* keep string */ } }
        else if (trimmed === "true") v = true;
        else if (trimmed === "false") v = false;
        o[h] = v;
      });
      objs.push(o);
    }
    const wrapper = {};
    wrapper[ent.aliases[0]] = ent.key === "settings" ? objs[0] : objs;
    return App.importJSON(wrapper, mode || "merge");
  };

  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          row.push(field); field = "";
          rows.push(row); row = [];
        } else field += c;
      }
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* ---------- sample data ---------- */
  App.loadSampleData = function () {
    const t = D.today();
    const iso = (daysAgo, hour, durMin) => {
      const d = D.parse(D.addDays(t, -daysAgo));
      d.setHours(hour, 0, 0, 0);
      const start = d.toISOString();
      d.setMinutes(d.getMinutes() + durMin);
      return [start, d.toISOString()];
    };
    const subjects = ["Math AA HL", "Physics HL", "Economics HL", "English A SL", "Spanish B SL", "Chemistry SL"];
    const data = App.emptyData();
    data.ui.welcomed = true;
    data.subjects = subjects.map((name) => ({ id: App.uid(), name, level: App.parseSubjectLevel(name).level, created_at: now() }));
    data.grades = [
      ["Math AA HL", 6, 7], ["Physics HL", 5, 6], ["Economics HL", 6, 7],
      ["English A SL", 5, 6], ["Spanish B SL", 6, 6], ["Chemistry SL", 4, 5],
    ].map(([subject_name, current_grade, target_grade]) => ({
      id: App.uid(), subject_name, current_grade, target_grade, notes: "", last_updated: t, created_at: now(),
    }));
    // The May exam session, which is when almost every Diploma candidate sits
    // papers. This used to be today+120, which meant sample data always showed
    // a date that was not a real session — and the Dashboard countdown is the
    // first thing anyone sees. Rolls forward on its own, so it never goes stale
    // and there is no date to remember to edit each year.
    function nextMaySessionStart(today) {
      const year = Number(today.slice(0, 4));
      const thisYear = year + "-04-27";
      return today <= thisYear ? thisYear : (year + 1) + "-04-27";
    }

    data.settings.tok_grade = "B";
    data.settings.ee_grade = "B";
    data.settings.exam_date = nextMaySessionStart(t);

    const mk = (title, category, subject, dueOffset, mins, pri, done, extras) => {
      const task = Object.assign({
        id: App.uid(), title, description: "", category, subject_name: subject || "",
        university_course_id: "", due_date: dueOffset === null ? "" : D.addDays(t, dueOffset),
        priority: pri || "medium", estimated_minutes: mins || 0,
        completed: !!done, completed_at: null, progress: done ? 100 : 0,
        recurring: "none", predecessor_id: "",
        scheduled_blocks: [], min_session_minutes: 0, max_session_minutes: 0,
        created_at: new Date(Date.now() - Math.abs(dueOffset || 5) * 43200000).toISOString(),
        updated_at: now(),
      }, extras || {});
      if (done) {
        // finish a couple days early/late (varies by title) so analytics have shape
        let hash = 0;
        for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
        const drift = (hash % 6) - 2; // -2 .. +3 days vs due date
        let doneDs = D.addDays(task.due_date, drift);
        if (doneDs > t) doneDs = t;
        const doneDay = D.parse(doneDs);
        doneDay.setHours(19, 0, 0, 0);
        task.completed_at = doneDay.toISOString();
      }
      data.tasks.push(task);
      return task;
    };

    const ia1 = mk("Math IA — final draft", "ia", "Math AA HL", 6, 180, "critical");
    mk("Math IA — outline & data collection", "ia", "Math AA HL", -9, 120, "high", true);
    mk("Physics IA — error analysis section", "ia", "Physics HL", 10, 150, "high");
    mk("Paper 1 practice set (calculus)", "exam_prep", "Math AA HL", 2, 90, "high");
    mk("Waves & optics problem set", "subject_task", "Physics HL", 1, 60, "medium");
    mk("Macro data response practice", "exam_prep", "Economics HL", 4, 75, "medium");
    mk("Paper 2 comparative essay plan", "subject_task", "English A SL", 3, 60, "medium");
    mk("Oral practice — media unit", "subject_task", "Spanish B SL", 7, 45, "low");
    mk("Organic chemistry flashcards", "exam_prep", "Chemistry SL", 0, 40, "medium");
    mk("TOK exhibition — object commentary 2", "tok", "", 8, 120, "high");
    mk("TOK essay — outline", "tok", "", -4, 90, "high", true);
    const eeDraft = mk("EE — complete first draft", "extended_essay", "Economics HL", 13, 240, "critical", false, { max_session_minutes: 90 });
    mk("EE — supervisor meeting prep", "extended_essay", "Economics HL", 15, 30, "medium", false, { predecessor_id: eeDraft.id });
    mk("CAS reflection — football season", "cas", "", 5, 30, "low");
    mk("CAS — plan charity bake sale", "cas", "", 12, 60, "medium");
    mk("Weekly Spanish vocab review", "subject_task", "Spanish B SL", 1, 30, "low", false, { recurring: "weekly" });
    mk("Chem stoichiometry worksheet", "subject_task", "Chemistry SL", -2, 45, "medium", true);
    mk("Econ HL — market failure notes", "subject_task", "Economics HL", -1, 50, "medium", true);
    mk("English — poetry annotations", "subject_task", "English A SL", -6, 40, "low", true);
    mk("Physics — kinematics review", "exam_prep", "Physics HL", -12, 60, "medium", true);

    data.subtasks.push(
      { id: App.uid(), task_id: ia1.id, title: "Rework modelling section", completed: true, estimated_minutes: 60, sort_order: 0, created_at: now() },
      { id: App.uid(), task_id: ia1.id, title: "Add reflection & bibliography", completed: false, estimated_minutes: 60, sort_order: 1, created_at: now() },
      { id: App.uid(), task_id: ia1.id, title: "Proofread against criteria", completed: false, estimated_minutes: 60, sort_order: 2, created_at: now() }
    );
    ia1.progress = 33;

    const uni = {
      id: App.uid(), university_name: "University of Cambridge", course_name: "Natural Sciences",
      application_deadline: D.addDays(t, 45), entrance_exam_date: D.addDays(t, 30), interview_date: "",
      offer_ib_points: 41,
      hl_total_required: 18,
      requirements: [{ subject_name: "Math AA HL", grade: 7 }, { subject_name: "Physics HL", grade: 6 }],
      status: "in_progress", tuition_cny: 0, tuition_secondary: 27000, tuition_currency: "GBP",
      notes: "College choice due with application.",
      key_steps: App.DEFAULT_KEY_STEPS.map((item, i) => ({ item, completed: i < 2 })),
      materials: App.DEFAULT_MATERIALS.map((item, i) => ({ item, completed: i < 1 })),
      created_at: now(), updated_at: now(),
    };
    data.courses.push(uni);
    mk("Personal statement — second draft", "university_application", "", 9, 120, "high", false, { university_course_id: uni.id });
    mk("Register for ESAT", "university_application", "", 16, 20, "critical", false, { university_course_id: uni.id });

    data.templates.push({
      id: App.uid(), name: "Past paper session", category: "exam_prep", subject_name: "",
      priority: "medium", estimated_minutes: 90,
      sub_tasks: [{ title: "Do paper under timed conditions", estimated_minutes: 60 }, { title: "Mark & log mistakes", estimated_minutes: 30 }],
      created_at: now(),
    });

    data.busyBlocks.push(
      // one weekday block with a 45-min commute either side (7:15 out, 16:15 home)
      { id: App.uid(), title: "School", category: "class", kind: "weekly", days: [1, 2, 3, 4, 5],
        start_min: 8 * 60, end_min: 15 * 60 + 30, travel_before: 45, travel_after: 45, created_at: now() },
      { id: App.uid(), title: "Football practice", category: "personal", kind: "weekly", days: [1, 3, 5],
        start_min: 16 * 60 + 30, end_min: 18 * 60, created_at: now() }
    );

    // Timer sessions across the last ~3 weeks (weighted toward subjects)
    const sessSpec = [
      [1, 19, 55, "Math AA HL", "Paper 1 practice set (calculus)", 60],
      [1, 20, 35, "Physics HL", "Waves & optics problem set", 30],
      [2, 18, 95, "Economics HL", "EE — research session", 90],
      [3, 19, 45, "Math AA HL", "Math IA — modelling", 60],
      [4, 17, 70, "English A SL", "Paper 2 essay plan", 60],
      [5, 19, 30, "Spanish B SL", "Vocab review", 30],
      [6, 18, 85, "Physics HL", "Physics IA — data processing", 90],
      [7, 20, 40, "Chemistry SL", "Organic chemistry flashcards", 45],
      [8, 19, 65, "Math AA HL", "Past paper — calculus", 60],
      [9, 18, 50, "Economics HL", "Macro notes", 45],
      [11, 19, 75, "Math AA HL", "Math IA — outline", 90],
      [12, 17, 60, "TOK", "TOK essay outline", 60],
      [13, 19, 45, "English A SL", "Poetry annotations", 40],
      [14, 18, 90, "Economics HL", "EE reading", 90],
      [16, 19, 55, "Physics HL", "Kinematics review", 60],
      [17, 20, 35, "Spanish B SL", "Oral practice", 30],
      [19, 18, 80, "Math AA HL", "Problem set", 75],
      [20, 19, 50, "Chemistry SL", "Stoichiometry worksheet", 45],
    ];
    for (const [daysAgo, hour, dur, subj, title, est] of sessSpec) {
      const [start_time, end_time] = iso(daysAgo, hour, dur);
      data.sessions.push({
        id: App.uid(), task_id: "", task_title: title, subject_name: subj === "TOK" ? "" : subj,
        estimated_minutes: est, overtime_minutes: Math.max(0, dur - est),
        start_time, end_time, created_at: start_time,
      });
    }

    // system: the first-run screen offers "try it with sample data" to people
    // who by definition have no license yet. Gating this behind one would make
    // the button silently do nothing for every new user — the trial has to work
    // before anyone can be expected to pay for it. They still can't edit what
    // it loads; read-only applies to the sample data like anything else.
    App.replaceState(data, { system: true });
  };
})();
