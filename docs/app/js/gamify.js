/* gamify.js — XP, levels and ranks.
   XP is DERIVED live from history (never stored), so it's always consistent:
   un-completing a task removes its XP, imports/backups carry it implicitly.
   Rules (all computed from history):
   - Complete a task: +10 base, +5 if done on/before its due date,
     +5 High / +10 Critical priority.
   - Focused study: +1 XP per logged minute, scaled by a streak multiplier
     (x1.25 at a 7-day streak, x1.5 at 15+); a session that runs to 2x or more
     of its planned time earns no minute-XP; +10 when a session lands within
     ±20% of the time you planned. */
(function () {
  "use strict";
  const App = window.App;
  const D = App.dates;
  const XP = (App.xp = {});

  XP.TASK_XP = 10;
  const ONTIME_BONUS = 5;
  const PRIORITY_BONUS = { high: 5, critical: 10 };
  const ESTIMATE_BONUS = 10;
  const ESTIMATE_TOLERANCE = 0.2;   // ±20% of planned time
  const OVERRUN_FACTOR = 2;         // >= 2x planned time voids minute-XP

  // streak-length -> minute-XP multiplier
  function streakMultiplier(streakDays) {
    if (streakDays >= 15) return 1.5;
    if (streakDays >= 7) return 1.25;
    return 1;
  }

  // total XP a single completed task is worth (base + on-time + priority)
  function taskXPFor(t) {
    let xp = XP.TASK_XP;
    xp += PRIORITY_BONUS[t.priority] || 0;
    if (t.due_date && t.completed_at) {
      const cd = D.isoToDateStr(t.completed_at);
      if (cd && cd <= t.due_date) xp += ONTIME_BONUS;
    }
    return xp;
  }

  // per-session XP given a streak-as-of-date lookup
  // -> { minuteXP, estimateBonus, penalised }
  function sessionXPFor(sess, streakOnDate) {
    const actual = App.sessionMinutes(sess);
    const est = sess.estimated_minutes || 0;
    if (actual <= 0) return { minuteXP: 0, estimateBonus: 0, penalised: false };
    if (est > 0 && actual >= est * OVERRUN_FACTOR) return { minuteXP: 0, estimateBonus: 0, penalised: true };
    const mult = streakMultiplier(streakOnDate(D.isoToDateStr(sess.start_time)));
    const minuteXP = Math.round(actual * mult);
    const estimateBonus = (est > 0 && Math.abs(actual - est) <= est * ESTIMATE_TOLERANCE) ? ESTIMATE_BONUS : 0;
    return { minuteXP, estimateBonus, penalised: false };
  }

  // minute-XP for one session ignoring streak/bonus — kept for any external use
  XP.sessionXP = function (sess) {
    return sessionXPFor(sess, () => 0).minuteXP;
  };

  // cost to go from `level` to `level + 1`
  XP.levelCost = function (level) {
    if (level < 15) return 500;
    if (level < 50) return 1000;
    if (level < 100) return 2500;
    return 5000;
  };

  // never-ending rank ladder; past "Legend", Mythic tiers count up forever
  const RANKS = [
    [1, "Newcomer"], [3, "Freshman"], [5, "Scholar"], [10, "Achiever"],
    [15, "Specialist"], [25, "Expert"], [35, "Master"], [50, "Grandmaster"],
    [75, "Sage"], [100, "Legend"],
  ];
  function roman(n) {
    const table = [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
    let out = "";
    for (const [v, sym] of table) while (n >= v) { out += sym; n -= v; }
    return out;
  }
  XP.rankFor = function (level) {
    if (level >= 150) return `Mythic ${roman(Math.floor((level - 150) / 50) + 1)}`;
    let rank = RANKS[0][1];
    for (const [minLevel, name] of RANKS) if (level >= minLevel) rank = name;
    return rank;
  };

  function levelFromXP(totalXP) {
    let level = 1, remaining = totalXP;
    let cost = XP.levelCost(level);
    while (remaining >= cost) {
      remaining -= cost;
      level++;
      cost = XP.levelCost(level);
    }
    return { level, into: remaining, needed: cost };
  }

  // memoised "study streak ending on <date>" from every logged session day
  function makeStreakLookup() {
    const daySet = new Set(App.state().sessions.map((x) => D.isoToDateStr(x.start_time)).filter(Boolean));
    const memo = new Map();
    return function streakOnDate(ds) {
      if (!ds) return 0;
      if (memo.has(ds)) return memo.get(ds);
      let count = 0, cur = ds;
      while (daySet.has(cur)) { count++; cur = D.addDays(cur, -1); }
      memo.set(ds, count);
      return count;
    };
  }

  // XP earned in a local-date range (inclusive); omit args for all-time.
  // timeXP folds in the streak multiplier; bonusXP is the good-estimate bonus.
  XP.computeRange = function (from, to) {
    const s = App.state();
    const inRange = (ds) => ds && (!from || ds >= from) && (!to || ds <= to);
    const streakOnDate = makeStreakLookup();
    let taskXP = 0, timeXP = 0, bonusXP = 0, tasksCompleted = 0, penalisedSessions = 0;
    for (const t of s.tasks) {
      if (t.completed && inRange(t.completed_at ? D.isoToDateStr(t.completed_at) : null)) {
        taskXP += taskXPFor(t);
        tasksCompleted++;
      }
    }
    for (const sess of s.sessions) {
      if (!inRange(D.isoToDateStr(sess.start_time))) continue;
      const r = sessionXPFor(sess, streakOnDate);
      timeXP += r.minuteXP;
      bonusXP += r.estimateBonus;
      if (r.penalised) penalisedSessions++;
    }
    return { taskXP, timeXP, bonusXP, total: taskXP + timeXP + bonusXP, tasksCompleted, penalisedSessions };
  };

  // the full current picture: total XP, level, rank, progress into the level
  XP.compute = function () {
    const range = XP.computeRange(null, null);
    const lv = levelFromXP(range.total);
    return {
      total: range.total,
      taskXP: range.taskXP,
      timeXP: range.timeXP,
      bonusXP: range.bonusXP,
      level: lv.level,
      rank: XP.rankFor(lv.level),
      into: lv.into,
      needed: lv.needed,
      pct: Math.round((lv.into / lv.needed) * 100),
    };
  };

  // call with the level *before* a mutation; shows the level-up popup if it rose
  XP.checkLevelUp = function (beforeLevel) {
    const afterLevel = XP.compute().level;
    if (afterLevel > beforeLevel) App.showLevelUp(afterLevel);
  };

  // current study streak in days (missing *today* doesn't break it yet)
  XP.streak = function () {
    const days = new Set(App.state().sessions.map((x) => D.isoToDateStr(x.start_time)).filter(Boolean));
    let count = 0;
    const today = D.today();
    for (let i = 0; i < 730; i++) {
      if (days.has(D.addDays(today, -i))) count++;
      else if (i > 0) break;
    }
    return count;
  };

  // encouragement toasts — task completion and session-stop get their own flavor
  const TASK_ENCOURAGEMENT = [
    "🔥 Crushing it!", "One step closer!", "Amazing focus!", "Nice work!", "That's the way!",
    "Keep the momentum going!", "Boom — done!", "You're on a roll!", "Small wins add up!",
    "Great follow-through!", "Look at you go!", "Chalk one up!", "That's how it's done!",
    "Solid work!", "Task crushed!",
  ];
  const SESSION_ENCOURAGEMENT = [
    "🧠 Brain fuel!", "Productive session!", "You're on fire!", "Focus paying off!",
    "That's deep work!", "Nicely focused!", "Building the habit!", "Great session!",
    "Momentum builder!", "That's dedication!", "Locked in!", "Time well spent!",
    "Consistency wins!", "Strong session!", "Keep that streak alive!",
  ];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  XP.taskEncouragement = () => pick(TASK_ENCOURAGEMENT);
  XP.sessionEncouragement = () => pick(SESSION_ENCOURAGEMENT);

  // best-ever streak, persisted since it can't be cheaply re-derived after old sessions roll off
  XP.maxStreak = function () {
    return Math.max(App.state().settings.max_streak || 0, XP.streak());
  };
  XP.updateMaxStreak = function () {
    const current = XP.streak();
    if (current > (App.state().settings.max_streak || 0)) {
      App.update((s) => { s.settings.max_streak = current; }, { silent: true });
    }
  };

  // Streak lengths worth stopping for. `last_streak_milestone` tracks the
  // highest one already celebrated — max_streak can't do this job, because a
  // broken-and-rebuilt streak should get its 7-day cheer all over again.
  const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365];

  XP.checkStreakMilestone = function () {
    const current = XP.streak();
    const settings = App.state().settings;
    const last = settings.last_streak_milestone || 0;

    // Streak broke and started over — let the milestones come round again.
    if (current < last) {
      App.update((s) => { s.settings.last_streak_milestone = 0; }, { silent: true });
      return;
    }
    let reached = 0;
    for (const m of STREAK_MILESTONES) if (current >= m) reached = m;
    if (reached <= last) return;

    App.update((s) => { s.settings.last_streak_milestone = reached; }, { silent: true });
    // This runs from logSession, so the session's own cue is still ringing —
    // played together the two just smear. Let it finish first.
    setTimeout(() => {
      App.sfx("streak");
      App.toast(`🔥 ${reached}-day streak! Keep it going.`);
    }, 950);
  };

  // single source of truth for "how XP works" — shown on hover of any XP bar
  XP.rulesHTML = function () {
    return `
      <div class="xp-help-card" role="tooltip">
        <div class="xp-help-title">How XP works</div>
        <div class="xp-help-group">
          <div class="xp-help-head">🎯 Complete a task</div>
          <ul>
            <li><b>+10</b> for any task</li>
            <li><b>+5</b> if you finish on or before its due date</li>
            <li><b>+5</b> High priority · <b>+10</b> Critical</li>
          </ul>
        </div>
        <div class="xp-help-group">
          <div class="xp-help-head">⏱️ Focused study</div>
          <ul>
            <li><b>+1</b> per minute logged</li>
            <li><b>+10</b> when a session lands within ±20% of your planned time</li>
            <li>a session that runs to <b>2×</b> its planned time earns no minute-XP</li>
          </ul>
        </div>
        <div class="xp-help-group">
          <div class="xp-help-head">🔥 Streak momentum</div>
          <ul>
            <li>minute-XP <b>×1.25</b> on a 7-day streak, <b>×1.5</b> at 15+</li>
          </ul>
        </div>
        <div class="xp-help-foot">Level up every 500 XP, then 1,000 · 2,500 · 5,000 as you climb. XP is calculated live from your history.</div>
      </div>`;
  };

  const HELP_BTN = `<button class="xp-help-btn" type="button" aria-label="How XP works" tabindex="0">?</button>`;

  // shared XP bar markup (compact=true for the slim Analytics variant)
  XP.barHTML = function (compact) {
    const x = XP.compute();
    const esc = App.esc;
    if (compact) {
      return `
        <div class="card xp-card compact has-xp-help">
          ${HELP_BTN}${XP.rulesHTML()}
          <div class="xp-medal">${x.level}</div>
          <div style="flex:1;min-width:0">
            <div class="row between" style="margin-bottom:5px">
              <span class="xp-rank">${esc(x.rank)} · Level ${x.level}</span>
              <span class="muted small">${x.into.toLocaleString()} / ${x.needed.toLocaleString()} XP</span>
            </div>
            <div class="xp-bar"><span style="width:${x.pct}%"></span></div>
          </div>
          <div class="xp-total">${x.total.toLocaleString()}<span> XP</span></div>
        </div>`;
    }
    return `
      <div class="card card-pad xp-card has-xp-help">
        <div class="row between mb-3">
          <div>
            <div class="xp-rank-line">
              <span class="xp-rank">${esc(x.rank)}</span>
              ${HELP_BTN}${XP.rulesHTML()}
            </div>
            <div class="xp-level">Level ${x.level}</div>
          </div>
          <div class="xp-medal big">${x.level}</div>
        </div>
        <div class="xp-bar"><span style="width:${x.pct}%"></span></div>
        <div class="row between mt-2 small muted">
          <span>${x.into.toLocaleString()} / ${x.needed.toLocaleString()} XP to level ${x.level + 1}</span>
          <span style="font-weight:650;color:var(--ink-2)">${x.total.toLocaleString()} XP</span>
        </div>
      </div>`;
  };
})();
