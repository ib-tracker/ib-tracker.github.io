/* pages/settings.js — subjects, study hours, appearance, and the data hub
   (backup export, data import via JSON or CSV, sample data, reset) */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = App.ui;

  /* ---------- collapsible sections ----------------------------------------
     Settings had eleven cards expanded at once in a single scroll, which is a
     lot to look at when you came in to change one thing. Each is now a
     <details> that starts closed.

     Native <details> rather than a hand-rolled toggle: keyboard and
     screen-reader behaviour come free, and the body stays in the DOM while
     collapsed, so mount() binds all 45 controls once and never has to care
     what happens to be open.

     Which sections are open is deliberately NOT persisted to state. It is
     module-level and reset by onEnter, so arriving at Settings always gives
     the clean closed list, but changing a setting (which re-renders the page)
     doesn't collapse the section you're working in. */
  let openSections = new Set();

  // `meta` is the value shown on the right of a closed row. A collapsed list
  // that tells you nothing until you click has only traded clutter for
  // hunting; "6 subjects", "Dark", "On" keeps the closed page informative.
  function section(id, title, meta, body) {
    return `
      <details class="card set-card" data-set="${id}"${openSections.has(id) ? " open" : ""}>
        <summary class="set-head">
          <span class="set-chev">${App.icon("chevR")}</span>
          <span class="set-title">${esc(title)}</span>
          <span class="set-meta">${meta ? esc(meta) : ""}</span>
        </summary>
        <div class="set-body">${body}</div>
      </details>`;
  }

  /* ---------- updates + version ---------- */
  // The desktop app can install an update itself; the browser build can only
  // point at the download. Both share this card.
  function updatesCardHTML() {
    const U = App.updates;
    const auto = App.state().settings.auto_update_check !== false;
    const where = U.desktop ? "Desktop app" : "Browser";

    let statusHTML = "";
    if (!U.configured) {
      statusHTML = `<p class="small muted">Update checking isn't set up in this build.</p>`;
    } else if (U.status === "checking") {
      statusHTML = `<p class="small muted">Checking…</p>`;
    } else if (U.status === "available" && U.manifest) {
      statusHTML = `
        <p class="small mb-2" style="color:var(--accent-soft-ink)">
          ${App.icon("download")} Version ${esc(U.manifest.version)} is available${U.manifest.released ? ` · released ${esc(U.manifest.released)}` : ""}
        </p>
        ${U.manifest.notes.length ? `<ul class="upd-notes mb-3">${U.manifest.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}`;
    } else if (U.status === "current") {
      statusHTML = `<p class="small mb-2" style="color:var(--good-ink)">${App.icon("checkCircle")} You're on the latest version</p>`;
    } else if (U.status === "error") {
      statusHTML = `<p class="small mb-2" style="color:var(--warning-ink)">${App.icon("alertTri")} ${esc(U.error)}</p>`;
    }

    const canInstall = U.status === "available" && U.manifest;
    return `
        <p class="card-sub mb-3">
          ${esc(App.state().settings.appName || "IB Tracker")} ${esc(U.version)} · ${where}.
          ${U.desktop
            ? "Updates install in place and never touch your tasks, sessions or settings — nothing is downloaded until you say so."
            : "A web page can't update itself, so this build tells you when a new version is out and links to the download."}
        </p>
        ${statusHTML}
        <div class="row wrap" style="gap:8px">
          <button class="btn btn-outline" data-check-update ${U.configured ? "" : "disabled"}>
            ${App.icon("rotate")} Check for updates
          </button>
          ${canInstall ? `<button class="btn btn-primary" data-install-update>
            ${App.icon("download")} ${U.desktop ? "Update &amp; restart" : "Open download page"}
          </button>` : ""}
        </div>
        ${U.configured ? `
          <hr class="divider">
          <div class="field">
            <label>Check automatically</label>
            <p class="hint mb-2">Once a day in the background. You always get the final say before anything installs.</p>
            <div class="theme-picker">
              ${[["on", "On"], ["off", "Off"]].map(([v, label]) => `
                <button class="theme-opt ${(auto ? "on" : "off") === v ? "active" : ""}" data-auto-update="${v}">
                  <span>${label}</span>
                </button>`).join("")}
            </div>
          </div>
          <p class="small muted mt-2">Last checked: ${esc(U.lastCheckLabel())}</p>` : ""}`;
  }

  /* ---------- license ---------- */
  function licenseCardHTML() {
    const L = App.license;
    const D = App.dates;
    const has = L.status === "licensed" || L.status === "expired";

    let statusHTML;
    if (L.status === "licensed") {
      const left = L.daysLeft();
      const soon = left !== Infinity && left <= 30;
      statusHTML = `
        <p class="small mb-2" style="color:var(--good-ink)">
          ${App.icon("checkCircle")} ${esc(L.tierLabel())}${L.name ? ` · ${esc(L.name)}` : ""}
        </p>
        <p class="small ${soon ? "" : "muted"}" ${soon ? 'style="color:var(--warning-ink)"' : ""}>
          ${L.isLifetime()
            ? "Never expires."
            : `Runs until ${esc(D.fmtMed(L.expiry))} — ${left} day${left === 1 ? "" : "s"} left.`}
        </p>`;
    } else if (L.status === "expired") {
      statusHTML = `<p class="small mb-2" style="color:var(--warning-ink)">
        ${App.icon("alertTri")} ${esc(L.reason)} The app is read-only until you add a current key.</p>`;
    } else if (L.status === "invalid") {
      statusHTML = `<p class="small mb-2" style="color:var(--danger-ink)">${App.icon("alertTri")} ${esc(L.reason)}</p>`;
    } else if (L.inTrial()) {
      const left = L.trialDaysLeft();
      statusHTML = `
        <p class="small mb-2" style="color:${left <= 3 ? "var(--warning-ink)" : "var(--good-ink)"}">
          ${App.icon(left <= 3 ? "alertTri" : "checkCircle")}
          Free trial · ${left} day${left === 1 ? "" : "s"} left
        </p>
        <p class="small muted">Everything works while the trial runs. After it, the app is read-only until a key is added.</p>`;
    } else {
      statusHTML = `<p class="small muted mb-2">No license key yet — the app is read-only.</p>`;
    }

    return `
        <p class="card-sub mb-3">
          A key unlocks editing. Reading, searching, reports and
          <strong>Export backup</strong> always work, with or without one — your
          data is yours either way.
        </p>
        ${statusHTML}
        <div class="field mt-3">
          <label>${has ? "Replace your key" : "Enter your key"}</label>
          <textarea class="input" rows="3" data-license-input spellcheck="false"
            style="font-family:var(--mono,ui-monospace,Menlo,monospace);font-size:12px"
            placeholder="IBT1.…"></textarea>
        </div>
        <div class="row wrap" style="gap:8px">
          <button class="btn btn-primary" data-license-save>${App.icon("checkCircle")} Activate</button>
          ${has ? `<button class="btn btn-ghost" data-license-remove>Remove key</button>` : ""}
        </div>`;
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Couldn't read the file"));
      r.readAsText(file);
    });
  }

  function summaryText(summary) {
    const parts = Object.entries(summary.counts)
      .filter(([, n]) => n)
      .map(([k, n]) => `${n} ${k === "busyBlocks" ? "busy blocks" : k === "savedFilters" ? "saved views" : k}`);
    return parts.length ? "Imported " + parts.join(", ") : "Nothing imported";
  }

  function openImportModal() {
    UI.openModal({
      title: "Import data",
      size: "lg",
      body: `
        <p class="muted small mb-4" style="line-height:1.55">
          Restore a <strong>backup file</strong> made by this app, or bring data in from another
          tracker as a <strong>JSON export</strong> (common field names are understood automatically)
          or <strong>CSV files</strong> exported one entity at a time.
        </p>
        <div class="field">
          <label>How should imported records be applied?</label>
          ${UI.selectHTML("mode", [["merge", "Merge — add to what's already here (same IDs get updated)"], ["replace", "Replace — wipe current data first"]], "merge")}
        </div>
        <hr class="divider">
        <div class="field">
          <label>JSON file (backup or full export)</label>
          <input class="input" type="file" accept=".json,application/json" data-json-file style="padding-top:6px">
        </div>
        <hr class="divider">
        <div class="field">
          <label>CSV file (one entity at a time)</label>
          <div class="row" style="gap:8px">
            ${UI.selectHTML("csvType", [
              ["tasks", "Tasks"], ["subtasks", "Sub-tasks"], ["subjects", "Subjects"],
              ["grades", "Grades"], ["timersessions", "Timer sessions"], ["busyblocks", "Busy blocks"],
              ["tasktemplates", "Templates"], ["savedfilters", "Saved views"],
              ["universitycourses", "University courses"], ["usersettings", "Settings"],
            ], "tasks", 'style="width:190px"')}
            <input class="input" type="file" accept=".csv,text/csv" data-csv-file style="padding-top:6px;flex:1">
          </div>
        </div>
        <div data-import-result class="mt-3"></div>`,
      foot: `<button class="btn btn-outline" data-close>Close</button>
             <button class="btn btn-primary" data-do-import>${App.icon("upload")} Import</button>`,
      onMount(el, handle) {
        const resultEl = el.querySelector("[data-import-result]");
        el.querySelector("[data-do-import]").addEventListener("click", async () => {
          const mode = el.querySelector('[name="mode"]').value;
          const jsonFile = el.querySelector("[data-json-file]").files[0];
          const csvFile = el.querySelector("[data-csv-file]").files[0];
          if (!jsonFile && !csvFile) {
            App.toast("Choose a JSON or CSV file first", "error");
            return;
          }
          try {
            let summary;
            if (jsonFile) {
              const text = await readFileAsText(jsonFile);
              let obj;
              try { obj = JSON.parse(text); }
              catch (e) { throw new Error("That file isn't valid JSON."); }
              summary = App.importJSON(obj, mode);
            } else {
              const text = await readFileAsText(csvFile);
              summary = App.importCSV(text, el.querySelector('[name="csvType"]').value, mode);
            }
            const ok = Object.values(summary.counts).some((n) => n);
            resultEl.innerHTML = `
              <div class="chip ${ok ? "chip-good" : "chip-warning"}" style="font-size:12.5px;padding:6px 12px">${esc(summaryText(summary))}</div>
              ${summary.errors.length ? `<p class="small mt-2" style="color:var(--warning-ink)">${summary.errors.map(esc).join("<br>")}</p>` : ""}`;
            if (ok) App.toast("Import complete");
          } catch (err) {
            resultEl.innerHTML = `<div class="chip chip-danger" style="font-size:12.5px;padding:6px 12px">${esc(err.message)}</div>`;
          }
        });
      },
    });
  }

  App.pages.settings = {
    title: "Settings",
    render() {
      const s = App.state();
      const subjects = s.subjects;
      const hours = s.settings.hours_per_day;
      const theme = s.settings.theme || "auto";
      const soundOn = s.settings.sound_enabled !== false;
      const notifOn = s.settings.desktop_notifications !== false;
      // "denied" is a system-level block we can't undo from here — say so rather
      // than leaving the toggle looking on while nothing ever shows up.
      const notifBlocked = "Notification" in window && Notification.permission === "denied";
      const counts = {
        tasks: s.tasks.length, sessions: s.sessions.length,
        subjects: s.subjects.length, courses: s.courses.length,
      };

      /* Summaries for the closed rows. Each answers the question you'd have
         opened the section to ask, so most visits don't need a click at all. */
      const hoursTotal = App.DAY_KEYS.reduce((n, d) => n + (Number(hours[d]) || 0), 0);
      const subjectsMeta = subjects.length
        ? `${subjects.length} subject${subjects.length === 1 ? "" : "s"}`
        : "None yet";
      // Half-hours are allowed per day, so the weekly total can land on .5.
      const capacityMeta = `${Math.round(hoursTotal * 2) / 2} h/week`;
      const examsMeta = s.settings.exam_date
        ? (s.settings.exam_date >= App.dates.today()
            ? `${App.dates.diffDays(App.dates.today(), s.settings.exam_date)} days to go`
            : "Date passed")
        : "Not set";
      const goalMeta = s.settings.weekly_goal_hours ? `${s.settings.weekly_goal_hours} h/week` : "Off";
      const coachMeta = `${(s.settings.coach_tone || "warm") === "warm" ? "Warm" : "Direct"} · ${s.settings.ai_api_key ? "AI on" : "Offline"}`;
      const appearanceMeta = theme === "auto" ? "Auto" : theme === "dark" ? "Dark" : "Light";
      const soundMeta = soundOn ? (notifOn ? "Sound + banners" : "Sound only") : "Off";
      const dataMeta = `${counts.tasks} task${counts.tasks === 1 ? "" : "s"}`;
      const licenseMeta = App.license.status === "licensed" ? App.license.tierLabel()
        : App.license.status === "expired" ? "Expired"
        : App.license.inTrial() ? `Trial · ${App.license.trialDaysLeft()}d left`
        : "No key";
      const updatesMeta = App.updates.version || "";
      const defaultMats = App.defaultMaterials();
      const defaultSteps = App.defaultKeySteps();

      return `
        <div class="page narrow">
          ${UI.pageHead("Settings", "Subjects, study hours, appearance and your data")}
          <div class="stack">

            <div class="group-label">Your studies</div>
            ${section("subjects", "Subjects", subjectsMeta, `
              <p class="card-sub mb-3">These appear in dropdowns across the app. Give each one an emoji and a color — they follow the subject everywhere: task chips, the Scheduler, the Calendar and Analytics.</p>
              <div class="row mb-3" style="gap:8px">
                <input class="input" data-new-subject placeholder="e.g. Physics" style="flex:1">
                ${UI.selectHTML("new_subject_level", [["", "Level"], ["HL", "HL"], ["SL", "SL"]], "", 'data-new-subject-level style="width:84px"')}
                <button class="btn btn-primary" data-add-subject>${App.icon("plus")} Add</button>
              </div>
              <div data-subject-list>
                ${subjects.length ? subjects.map((sub) => {
                  const meta = App.subjectMeta(sub.name);
                  return `
                  <div class="subject-row" style="border-left:3px solid ${meta.color}">
                    <input class="subj-emoji-input" data-subj-emoji="${esc(sub.id)}" value="${esc(meta.emoji)}"
                      maxlength="4" title="Emoji for ${esc(sub.name)}" aria-label="Emoji for ${esc(sub.name)}">
                    ${/* Editable. renameSubject cascades the new name through
                          tasks, sessions, grades, templates, saved filters and
                          course requirements, so this is safe to expose. */""}
                    <input class="input input-sm subj-name-input" data-subj-name="${esc(sub.id)}"
                      value="${esc(sub.name)}" style="flex:1"
                      title="Rename ${esc(sub.name)}" aria-label="Name for ${esc(sub.name)}">
                    ${UI.selectHTML("subj_level", [["", "Level"], ["HL", "HL"], ["SL", "SL"]], sub.level || "", `data-subj-level="${esc(sub.id)}" style="width:84px" aria-label="Level for ${esc(sub.name)}"`)}
                    <input type="color" class="subj-color-input" data-subj-color="${esc(sub.id)}" value="${esc(meta.color)}"
                      title="Color for ${esc(sub.name)}" aria-label="Color for ${esc(sub.name)}">
                    <button class="icon-btn danger" data-del-subject="${esc(sub.id)}" title="Remove">${App.icon("trash")}</button>
                  </div>`;
                }).join("") : `<p class="muted small">No subjects yet — add your six IB subjects</p>`}
              </div>`)}

            ${section("capacity", "Study capacity", capacityMeta, `
              <p class="card-sub mb-3">Used by the scheduler and the workload forecast</p>
              <div class="section-label">Available hours per day</div>
              ${App.DAY_KEYS.map((day, i) => `
                <div class="hours-row">
                  <label>${App.DAY_LABELS[i]}</label>
                  <div class="row" style="gap:7px">
                    <input class="input" type="number" min="0" max="16" step="0.5" data-hours="${day}" value="${hours[day] ?? 0}">
                    <span class="muted small" style="width:24px">hrs</span>
                  </div>
                </div>`).join("")}
              <hr class="divider">
              <div class="section-label">Work window</div>
              <div class="form-row">
                <div class="field">
                  <label>Earliest start</label>
                  <input class="input" type="number" min="0" max="23" data-work-start value="${s.settings.work_start_hour}">
                  <p class="hint" data-start-hint></p>
                </div>
                <div class="field">
                  <label>Latest end</label>
                  <input class="input" type="number" min="1" max="24" data-work-end value="${s.settings.work_end_hour}">
                  <p class="hint" data-end-hint></p>
                </div>
              </div>
              <button class="btn btn-primary btn-block" data-save-capacity>Save capacity</button>`)}

            ${section("exams", "IB exams", examsMeta, `
              <p class="card-sub mb-3">Set when your exam session starts and the Dashboard shows a live countdown.</p>
              <div class="field" style="margin-bottom:0">
                <label>Exam session start date</label>
                <div class="row" style="gap:8px">
                  <input class="input" type="date" data-exam-date value="${esc(s.settings.exam_date || "")}" style="flex:1">
                  ${s.settings.exam_date ? `<button class="btn btn-outline" data-exam-clear>Clear</button>` : ""}
                </div>
                ${s.settings.exam_date && s.settings.exam_date >= App.dates.today()
                  ? `<p class="hint">${App.dates.diffDays(App.dates.today(), s.settings.exam_date)} days to go.</p>`
                  : s.settings.exam_date ? `<p class="hint">That date has passed.</p>` : ""}
              </div>`)}

            ${section("goal", "Weekly goal", goalMeta, `
              <p class="card-sub mb-3">A target for focused study each week. The Dashboard tracks your progress and it resets every Monday. Set to 0 to hide it.</p>
              <div class="field" style="margin-bottom:0">
                <label>Focused study hours per week</label>
                <div class="row" style="gap:7px;max-width:200px">
                  <input class="input" type="number" min="0" max="80" step="1" data-weekly-goal value="${s.settings.weekly_goal_hours ?? 10}">
                  <span class="muted small" style="align-self:center">h / week</span>
                </div>
              </div>`)}

            ${section("newcourse", "New course checklists", `${defaultSteps.length} steps · ${defaultMats.length} materials`, `
              <p class="card-sub mb-3">
                What a new university course starts with. Changing these doesn't
                touch courses you've already added, and every course can be
                edited individually on the University page.
              </p>

              <div class="section-label">Application steps</div>
              <div data-step-list>
                ${defaultSteps.map((item, i) => `
                  <div class="row mb-2" style="gap:8px">
                    <input class="input" data-step-item="${i}" value="${esc(item)}" style="flex:1">
                    <button class="icon-btn danger" data-step-remove="${i}" title="Remove">${App.icon("trash")}</button>
                  </div>`).join("")}
                ${!defaultSteps.length ? `<p class="muted small mb-2">New courses start with no steps.</p>` : ""}
              </div>
              <div class="row mb-2" style="gap:8px">
                <input class="input" data-step-add-input placeholder="e.g. Sit the admissions test" style="flex:1">
                <button class="btn btn-outline" data-step-add-btn>${App.icon("plus")} Add</button>
              </div>
              <button class="btn btn-ghost btn-sm mb-4" data-step-reset>Reset steps to the built-in list</button>

              <hr class="divider">
              <div class="section-label">Required materials</div>
              <div data-mat-list>
                ${defaultMats.map((item, i) => `
                  <div class="row mb-2" style="gap:8px">
                    <input class="input" data-mat-item="${i}" value="${esc(item)}" style="flex:1">
                    <button class="icon-btn danger" data-mat-remove="${i}" title="Remove">${App.icon("trash")}</button>
                  </div>`).join("")}
                ${!defaultMats.length ? `<p class="muted small mb-2">New courses start with no materials.</p>` : ""}
              </div>
              <div class="row mb-2" style="gap:8px">
                <input class="input" data-mat-add-input placeholder="e.g. Portfolio" style="flex:1">
                <button class="btn btn-outline" data-mat-add-btn>${App.icon("plus")} Add</button>
              </div>
              <button class="btn btn-ghost btn-sm" data-mat-reset>Reset materials to the built-in list</button>`)}

            <div class="group-label">Coach</div>
            ${section("coach", "Coach", coachMeta, `
              <p class="card-sub mb-3">The Coach page works offline out of the box. Add an OpenRouter API key to turn it into a full AI conversation — one key unlocks Claude, GPT, DeepSeek, Gemini and hundreds of other models.</p>
              <div class="section-label">Tone</div>
              <div class="theme-picker mb-4">
                ${[["warm", "Warm mentor", "sparkles"], ["direct", "No-nonsense", "zap"]].map(([v, l, ic]) => `
                  <button class="theme-opt ${(s.settings.coach_tone || "warm") === v ? "active" : ""}" data-coach-tone="${v}">
                    ${App.icon(ic)} ${l}
                  </button>`).join("")}
              </div>
              <div class="section-label">AI mode (optional)</div>
              <div class="field">
                <label>OpenRouter API key</label>
                <div class="row" style="gap:8px">
                  <input class="input" type="password" data-coach-key
                    placeholder="${s.settings.ai_api_key ? "•••••••••••••••••••• (key saved)" : "sk-or-…"}" style="flex:1">
                  <button class="btn btn-primary" data-coach-key-save>Save</button>
                  ${s.settings.ai_api_key ? `<button class="btn btn-danger-ghost" data-coach-key-remove>Remove</button>` : ""}
                </div>
                <p class="hint">Get a key at openrouter.ai/keys. It's stored only in this browser, is never included in backups, and messages cost a fraction of a cent each. With a key set, your study data is sent to OpenRouter (and the model provider you pick) when you chat with the coach.</p>
              </div>
              ${s.settings.ai_api_key ? `
                <div class="field">
                  <label>AI model</label>
                  ${/* Built from coach.js rather than repeated here — this list
                        was duplicated once already and the copies drifted apart
                        when OpenRouter retired a model. */""}
                  ${UI.selectHTML("ai_model", [
                    ...Object.entries(App.coach.MODEL_LABELS),
                    ["custom", "Custom — paste a model ID"],
                  ], App.coach.isCustomModel(s.settings.ai_model) ? "custom" : (s.settings.ai_model || App.DEFAULT_AI_MODEL), 'data-ai-model')}
                </div>
                <div class="field" data-custom-model-field ${App.coach.isCustomModel(s.settings.ai_model) ? "" : "hidden"}>
                  <label>Custom model ID</label>
                  <input class="input" data-ai-model-custom value="${App.coach.isCustomModel(s.settings.ai_model) ? esc(s.settings.ai_model) : ""}" placeholder="e.g. mistralai/mistral-large">
                  <p class="hint">Any <a href="https://openrouter.ai/models" target="_blank" rel="noopener">OpenRouter model ID</a>, exactly as listed there.</p>
                </div>` : ""}`)}

            <div class="group-label">Appearance &amp; app</div>
            ${section("appearance", "Appearance", appearanceMeta, `
              <div class="theme-picker">
                ${[["light", "Light", "sun"], ["dark", "Dark", "moon"], ["auto", "Auto", "monitor"]].map(([v, l, ic]) => `
                  <button class="theme-opt ${theme === v ? "active" : ""}" data-theme-opt="${v}">
                    ${App.icon(ic)} ${l}
                  </button>`).join("")}
              </div>`)}

            ${section("sound", "Sound & notifications", soundMeta, `
              <p class="card-sub mb-3">Short chimes when you finish a task or a study session, level up, or hit a streak — plus a quieter one when something goes wrong.</p>
              <div class="field">
                <label>Sound effects</label>
                <div class="theme-picker mb-2">
                  ${[["on", "On"], ["off", "Off"]].map(([v, label]) => `
                    <button class="theme-opt ${(soundOn ? "on" : "off") === v ? "active" : ""}" data-sound-toggle="${v}">
                      <span>${label}</span>
                    </button>`).join("")}
                </div>
                <button class="btn btn-outline btn-sm" data-sound-test ${soundOn ? "" : "disabled"}>${App.icon("sparkles")} Play a sample</button>
              </div>
              ${"Notification" in window ? `
                <hr class="divider">
                <div class="field" style="margin-bottom:0">
                  <label>Desktop notifications</label>
                  <p class="hint mb-2">When the timer or a pomodoro break ends while you're in another app, show a banner. Nothing appears while IB Tracker is the window you're looking at.</p>
                  <div class="theme-picker">
                    ${[["on", "On"], ["off", "Off"]].map(([v, label]) => `
                      <button class="theme-opt ${(notifOn ? "on" : "off") === v ? "active" : ""}" data-notif-toggle="${v}">
                        <span>${label}</span>
                      </button>`).join("")}
                  </div>
                  ${notifBlocked ? `<p class="hint" style="color:var(--warning-ink)">${App.icon("alertTri")} Notifications are blocked for this app in your system settings, so banners won't appear until that's changed.</p>` : ""}
                </div>` : ""}`)}

            ${section("appname", "App name", s.settings.appName || "IB Tracker", `
              <p class="card-sub mb-3">Shown in the sidebar, browser tab and printed reports.</p>
              <div class="row" style="gap:8px">
                <input class="input" data-app-name value="${esc(s.settings.appName || "IB Tracker")}" placeholder="IB Tracker" maxlength="40" style="flex:1">
              </div>`)}

            ${section("onboarding", "Onboarding", "", `
              <p class="card-sub mb-3">New here, or want a refresher on where everything lives?</p>
              <div class="row wrap" style="gap:8px">
                <button class="btn btn-outline" data-replay-tour>${App.icon("sparkles")} Take the tour</button>
                <button class="btn btn-outline" data-replay-setup>${App.icon("settings")} Run setup again</button>
              </div>`)}

            <div class="group-label">Data &amp; license</div>
            ${section("data", "Your data", dataMeta, `
              <p class="card-sub mb-2">
                Everything lives privately in this browser (${counts.tasks} tasks, ${counts.sessions} sessions,
                ${counts.subjects} subjects, ${counts.courses} courses). Export a backup regularly — especially before clearing browser data.
              </p>
              <p class="small mb-3" style="color:${App.backupOverdue() ? "var(--warning-ink)" : "var(--ink-3)"}">
                ${App.icon(App.backupOverdue() ? "alertTri" : "checkCircle")} Last backup: ${esc(App.lastBackupLabel())}
              </p>
              <div class="row wrap" style="gap:8px">
                <button class="btn btn-outline" data-export>${App.icon("download")} Export backup</button>
                <button class="btn btn-outline" data-import>${App.icon("upload")} Import data</button>
                <button class="btn btn-outline" data-sample>${App.icon("sparkles")} Load sample data</button>
              </div>
              <hr class="divider">
              <button class="btn btn-danger-ghost" data-erase>${App.icon("trash")} Erase all data</button>`)}

            ${section("license", "License", licenseMeta, licenseCardHTML())}
            ${section("updates", "Updates", updatesMeta, updatesCardHTML())}
          </div>
        </div>`;
    },

    // Arriving at Settings always shows the clean, fully-closed list. Within a
    // visit the open set survives, so changing a setting (which re-renders the
    // whole page) doesn't shut the section you're working in.
    onEnter() { openSections = new Set(); },

    mount(el) {
      el.querySelectorAll("details[data-set]").forEach((d) => {
        d.addEventListener("toggle", () => {
          if (d.open) openSections.add(d.dataset.set);
          else openSections.delete(d.dataset.set);
        });
      });

      // subjects
      const input = el.querySelector("[data-new-subject]");
      const newLevelSel = el.querySelector("[data-new-subject-level]");
      const add = () => {
        const name = input.value.trim();
        if (!name) return;
        const created = App.createSubject(name, newLevelSel.value);
        if (!created) { App.toast("That subject already exists", "error"); return; }
        input.value = ""; newLevelSel.value = "";
        App.toast("Subject added");
      };
      el.querySelector("[data-add-subject]").addEventListener("click", add);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
      el.querySelectorAll("[data-subj-level]").forEach((sel) =>
        sel.addEventListener("change", () => {
          App.setSubjectLevel(sel.dataset.subjLevel, sel.value);
          App.toast("Subject level updated");
        }));
      el.querySelectorAll("[data-del-subject]").forEach((b) =>
        b.addEventListener("click", async () => {
          const sub = App.state().subjects.find((x) => x.id === b.dataset.delSubject);
          const inUse = App.state().tasks.filter((t) => t.subject_name === sub.name && !t.completed).length;
          const ok = await UI.confirm({
            title: "Remove subject?",
            message: inUse
              ? `“${sub.name}” still has ${inUse} open task${inUse > 1 ? "s" : ""}. They keep their subject label; it just leaves the dropdowns.`
              : `“${sub.name}” will be removed from dropdowns.`,
            confirmLabel: "Remove",
          });
          if (ok) { App.deleteSubject(sub.id); App.toast("Subject removed"); }
        }));

      // subject emoji + color customization
      /* Rename. Goes through App.renameSubject rather than updateSubject: the
         name is the join key everywhere else (tasks, sessions, grades,
         templates, saved filters, course requirements all store the STRING),
         so a bare field update would orphan every one of them. */
      el.querySelectorAll("[data-subj-name]").forEach((inp) =>
        inp.addEventListener("change", () => {
          const id = inp.dataset.subjName;
          const sub = App.state().subjects.find((s) => s.id === id);
          const next = inp.value.trim();
          if (!sub) return;
          if (!next) { inp.value = sub.name; App.toast("A subject needs a name", "error"); return; }
          if (next === sub.name) return;
          const clash = App.state().subjects.some((s) => s.id !== id && s.name.toLowerCase() === next.toLowerCase());
          if (clash) { inp.value = sub.name; App.toast("You already have a subject with that name", "error"); return; }
          App.renameSubject(id, next);
          App.toast("Subject renamed");
        }));
      el.querySelectorAll("[data-subj-emoji]").forEach((inp) =>
        inp.addEventListener("change", () => {
          App.updateSubject(inp.dataset.subjEmoji, { emoji: inp.value.trim().slice(0, 8) });
          App.toast("Subject emoji updated");
        }));
      el.querySelectorAll("[data-subj-color]").forEach((inp) =>
        inp.addEventListener("change", () => {
          App.updateSubject(inp.dataset.subjColor, { color: inp.value });
          App.toast("Subject color updated");
        }));

      // capacity
      const hint = () => {
        const st = parseInt(el.querySelector("[data-work-start]").value) || 0;
        const en = parseInt(el.querySelector("[data-work-end]").value) || 0;
        const fmt = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 || h === 24 ? "AM" : "PM"}`;
        el.querySelector("[data-start-hint]").textContent = fmt(st);
        el.querySelector("[data-end-hint]").textContent = fmt(en);
      };
      el.querySelector("[data-work-start]").addEventListener("input", hint);
      el.querySelector("[data-work-end]").addEventListener("input", hint);
      hint();
      el.querySelector("[data-save-capacity]").addEventListener("click", () => {
        const hours = {};
        el.querySelectorAll("[data-hours]").forEach((i) => {
          hours[i.dataset.hours] = App.clamp(parseFloat(i.value) || 0, 0, 16);
        });
        const start = App.clamp(parseInt(el.querySelector("[data-work-start]").value) || 8, 0, 23);
        let end = App.clamp(parseInt(el.querySelector("[data-work-end]").value) || 22, 1, 24);
        if (end <= start) {
          App.toast("The work window must end after it starts", "error");
          return;
        }
        App.update((s) => {
          s.settings.hours_per_day = hours;
          s.settings.work_start_hour = start;
          s.settings.work_end_hour = end;
        });
        App.toast("Capacity saved");
      });

      // app name
      el.querySelector("[data-app-name]").addEventListener("change", (e) => {
        const name = e.target.value.trim() || "IB Tracker";
        App.update((s) => { s.settings.appName = name; });
        App.toast("App name updated");
      });

      // exam date
      el.querySelector("[data-exam-date]").addEventListener("change", (e) => {
        const v = /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) ? e.target.value : "";
        App.update((s) => { s.settings.exam_date = v; });
        App.toast(v ? "Exam date saved" : "Exam date cleared");
      });
      const examClear = el.querySelector("[data-exam-clear]");
      if (examClear) examClear.addEventListener("click", () => {
        App.update((s) => { s.settings.exam_date = ""; });
        App.toast("Exam date cleared");
      });

      // weekly goal
      el.querySelector("[data-weekly-goal]").addEventListener("change", (e) => {
        const v = App.clamp(Math.round(Number(e.target.value) || 0), 0, 80);
        App.update((s) => { s.settings.weekly_goal_hours = v; });
        App.toast(v ? "Weekly goal saved" : "Weekly goal hidden");
      });

      // onboarding tour
      el.querySelector("[data-replay-tour]").addEventListener("click", () => App.tour.start());
      const replaySetup = el.querySelector("[data-replay-setup]");
      if (replaySetup) replaySetup.addEventListener("click", () => App.setup.restart());

      // theme
      el.querySelectorAll("[data-theme-opt]").forEach((b) =>
        b.addEventListener("click", () => {
          App.update((s) => { s.settings.theme = b.dataset.themeOpt; });
          App.applyTheme();
        }));

      /* Default application materials. Every edit writes the whole list, which
         keeps this simple: there is no partial state to get out of step, and
         an empty list is a legitimate answer (start new courses blank). */
      const writeMats = (list) => {
        App.update((s) => { s.settings.default_materials = list.map((x) => String(x).trim()).filter(Boolean).slice(0, 20); });
      };
      const readMats = () =>
        [...el.querySelectorAll("[data-mat-item]")].map((i) => i.value);

      el.querySelectorAll("[data-mat-item]").forEach((inp) =>
        inp.addEventListener("change", () => writeMats(readMats())));
      el.querySelectorAll("[data-mat-remove]").forEach((b) =>
        b.addEventListener("click", () => {
          const list = readMats();
          list.splice(Number(b.dataset.matRemove), 1);
          writeMats(list);
        }));
      const matAdd = el.querySelector("[data-mat-add-btn]");
      const matInput = el.querySelector("[data-mat-add-input]");
      const addMat = () => {
        const v = matInput.value.trim();
        if (!v) return;
        writeMats([...readMats(), v]);
      };
      if (matAdd) matAdd.addEventListener("click", addMat);
      if (matInput) matInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); addMat(); }
      });
      const writeSteps = (list) => {
        App.update((s) => { s.settings.default_key_steps = list.map((x) => String(x).trim()).filter(Boolean).slice(0, 20); });
      };
      const readSteps = () => [...el.querySelectorAll("[data-step-item]")].map((i) => i.value);
      el.querySelectorAll("[data-step-item]").forEach((inp) =>
        inp.addEventListener("change", () => writeSteps(readSteps())));
      el.querySelectorAll("[data-step-remove]").forEach((b) =>
        b.addEventListener("click", () => {
          const list = readSteps();
          list.splice(Number(b.dataset.stepRemove), 1);
          writeSteps(list);
        }));
      const stepAddBtn = el.querySelector("[data-step-add-btn]");
      const stepAddInput = el.querySelector("[data-step-add-input]");
      const addStep = () => {
        const v = stepAddInput.value.trim();
        if (!v) return;
        writeSteps([...readSteps(), v]);
      };
      if (stepAddBtn) stepAddBtn.addEventListener("click", addStep);
      if (stepAddInput) stepAddInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); addStep(); }
      });
      const stepReset = el.querySelector("[data-step-reset]");
      if (stepReset) stepReset.addEventListener("click", () => {
        App.update((s) => { s.settings.default_key_steps = []; });
        App.toast("Back to the built-in steps");
      });

      const matReset = el.querySelector("[data-mat-reset]");
      if (matReset) matReset.addEventListener("click", () => {
        // [] means "use the built-in list", so resetting is just clearing it.
        App.update((s) => { s.settings.default_materials = []; });
        App.toast("Back to the built-in list");
      });

      // sound & notifications
      el.querySelectorAll("[data-sound-toggle]").forEach((b) =>
        b.addEventListener("click", () => {
          const on = b.dataset.soundToggle === "on";
          App.update((s) => { s.settings.sound_enabled = on; });
          if (on) App.sfx("task"); // turning it on should let you hear what you just chose
        }));
      const soundTest = el.querySelector("[data-sound-test]");
      if (soundTest) soundTest.addEventListener("click", () => App.sfx("session"));
      el.querySelectorAll("[data-notif-toggle]").forEach((b) =>
        b.addEventListener("click", () => {
          const on = b.dataset.notifToggle === "on";
          App.update((s) => { s.settings.desktop_notifications = on; });
          // Ask now, while they're clearly asking for banners, rather than in
          // the middle of a study session when the first one is due.
          if (on && Notification.permission === "default") {
            try { Notification.requestPermission().then(() => App.render()); } catch (e) { /* callback-only impl */ }
          }
        }));

      // coach
      el.querySelectorAll("[data-coach-tone]").forEach((b) =>
        b.addEventListener("click", () => {
          App.update((s) => { s.settings.coach_tone = b.dataset.coachTone; });
        }));
      el.querySelector("[data-coach-key-save]").addEventListener("click", () => {
        const val = el.querySelector("[data-coach-key]").value.trim();
        if (!val) { App.toast("Paste a key first", "error"); return; }
        App.update((s) => { s.settings.ai_api_key = val; });
        App.toast("API key saved — the coach is now AI-powered");
      });
      const keyRemove = el.querySelector("[data-coach-key-remove]");
      if (keyRemove) keyRemove.addEventListener("click", () => {
        App.update((s) => { s.settings.ai_api_key = ""; });
        App.toast("API key removed — coach is back to built-in mode");
      });
      const modelSel = el.querySelector("[data-ai-model]");
      const customField = el.querySelector("[data-custom-model-field]");
      const customInput = el.querySelector("[data-ai-model-custom]");
      if (modelSel) modelSel.addEventListener("change", () => {
        if (modelSel.value === "custom") {
          customField.hidden = false;
          customInput.focus();
          return;
        }
        customField.hidden = true;
        App.update((s) => { s.settings.ai_model = modelSel.value; });
        App.toast("AI model updated");
      });
      if (customInput) customInput.addEventListener("change", () => {
        const val = customInput.value.trim();
        if (!val) return;
        App.update((s) => { s.settings.ai_model = val; });
        App.toast("AI model updated");
      });

      // data
      el.querySelector("[data-export]").addEventListener("click", () => {
        App.exportBackup();
        App.toast("Backup downloaded");
        App.render(); // refresh the "Last backup" status line
      });
      el.querySelector("[data-import]").addEventListener("click", openImportModal);
      el.querySelector("[data-sample]").addEventListener("click", async () => {
        const hasData = App.state().tasks.length || App.state().sessions.length;
        if (hasData) {
          const ok = await UI.confirm({
            title: "Load sample data?",
            message: "This replaces everything currently in the app with demo data. Export a backup first if you need your data.",
            confirmLabel: "Replace with sample",
          });
          if (!ok) return;
        }
        App.loadSampleData();
        App.toast("Sample data loaded");
      });
      el.querySelector("[data-erase]").addEventListener("click", async () => {
        const ok = await UI.confirm({
          title: "Erase all data?",
          message: "Every task, session, grade and setting will be permanently deleted from this browser. This cannot be undone — consider exporting a backup first.",
          confirmLabel: "Erase everything",
        });
        if (!ok) return;
        const fresh = App.emptyData();
        fresh.ui.welcomed = false;
        App.replaceState(fresh);
        App.applyTheme();
        App.navigate("dashboard");
        App.toast("All data erased");
      });

      // license
      const licSave = el.querySelector("[data-license-save]");
      if (licSave) licSave.addEventListener("click", async () => {
        const box = el.querySelector("[data-license-input]");
        const raw = (box.value || "").trim();
        if (!raw) { App.toast("Paste your license key first", "error"); return; }
        const res = await App.license.apply(raw);
        if (res.ok && !res.expired) {
          box.value = "";
          App.toast("License activated — thank you");
        } else if (res.ok && res.expired) {
          box.value = "";
          App.toast("That key has already expired", "error");
        } else {
          App.toast(res.reason || "That key isn't valid", "error");
        }
        App.render();
      });
      const licRemove = el.querySelector("[data-license-remove]");
      if (licRemove) licRemove.addEventListener("click", async () => {
        const ok = await UI.confirm({
          title: "Remove your license key?",
          message: "The app becomes read-only until you enter a key again. Nothing is deleted, and you can still export a backup.",
          confirmLabel: "Remove",
        });
        if (!ok) return;
        App.license.remove();
        App.toast("License key removed");
        App.render();
      });

      // updates
      const checkBtn = el.querySelector("[data-check-update]");
      if (checkBtn) checkBtn.addEventListener("click", async () => {
        const status = await App.updates.check({ manual: true });
        if (status === "current") App.toast("You're on the latest version");
        else if (status === "error") App.toast(App.updates.error, "error");
      });
      const installBtn = el.querySelector("[data-install-update]");
      if (installBtn) installBtn.addEventListener("click", () => App.updates.install());
      el.querySelectorAll("[data-auto-update]").forEach((b) =>
        b.addEventListener("click", () => {
          App.update((s) => { s.settings.auto_update_check = b.dataset.autoUpdate === "on"; });
        }));
    },
  };
})();
