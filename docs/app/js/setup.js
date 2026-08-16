/* setup.js — the first thing a new install shows.

   Onboarding used to be a 19-step tour that pointed at each sidebar item in
   turn, running before the user had entered anything. It explained the map
   while there was no territory: every page it introduced was empty.

   This asks for the three things that make the rest of the app mean something
   (your subjects, when your exams are, how much time you actually have), then
   gets out of the way. The tour still exists, shortened, and is offered at the
   end once there is something to look at.

   Every write here is {system:true}. Naming your subjects is configuring the
   app rather than the "work" a license gates, and a setup wizard that can't
   save would be worse than not having one. */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = App.ui;
  const S = (App.setup = {});

  // Draft state lives here, not in App state: nothing is committed until the
  // step that commits it, so backing out of setup leaves no debris.
  let draft = null;
  let modal = null;
  let step = 0;

  const STEP_COUNT = 4; // subjects, exams, hours, done

  S.isDone = () => App.state().ui.setup_done === true;

  /* ---------- steps ---------- */

  /* One example per IB group, in group order, rather than "e.g. Physics" six
     times. The placeholders double as a reminder of the shape of the Diploma:
     somebody filling this in on their first day can see they're meant to have
     one from each group, without the wizard having to say so. */
  const GROUP_EXAMPLES = [
    "English A",   // 1 · Studies in Language and Literature
    "Spanish B",   // 2 · Language Acquisition
    "Psychology",  // 3 · Individuals and Societies
    "Physics",     // 4 · Sciences
    "Maths AA",    // 5 · Mathematics
    "Economics",   // 6 · The Arts, or a second from groups 1-5
  ];

  function subjectsStep() {
    const rows = draft.subjects.map((sub, i) => `
      <div class="row mb-2" style="gap:8px" data-subj-row="${i}">
        <input class="input" data-subj-name="${i}" value="${esc(sub.name)}"
               placeholder="e.g. ${esc(GROUP_EXAMPLES[i % GROUP_EXAMPLES.length])}" style="flex:1">
        ${UI.selectHTML("lvl" + i, [["", "Level"], ["HL", "HL"], ["SL", "SL"]], sub.level,
          `data-subj-level="${i}" style="width:90px"`)}
        <button class="icon-btn danger" data-subj-del="${i}" title="Remove">${App.icon("trash")}</button>
      </div>`).join("");

    return `
      <p class="muted mb-4" style="line-height:1.55">
        Most Diploma students take six. You can change any of this later, and
        nothing here is permanent.
      </p>
      <div data-subj-rows>${rows}</div>
      <button class="btn btn-outline btn-sm mt-2" data-subj-add>${App.icon("plus")} Add another</button>`;
  }

  function examsStep() {
    return `
      <p class="muted mb-4" style="line-height:1.55">
        The Dashboard turns this into a live countdown, and the scheduler uses
        it to know how much runway is left. Skip it if you don't know yet.
      </p>
      <div class="field">
        <label>First day of your exam session</label>
        <input class="input" type="date" data-exam value="${esc(draft.examDate)}">
        <p class="hint">May 2027 and November 2027 are the usual sessions. Pick the first exam day.</p>
      </div>`;
  }

  function hoursStep() {
    return `
      <p class="muted mb-4" style="line-height:1.55">
        Be honest rather than optimistic. The scheduler only plans into hours
        you actually said you have, so a number you can hit beats one that
        looks good.
      </p>
      <div class="form-row">
        <div class="field">
          <label>Hours on a school day</label>
          <input class="input" type="number" min="0" max="16" step="0.5" data-weekday value="${draft.weekday}">
        </div>
        <div class="field">
          <label>Hours at the weekend</label>
          <input class="input" type="number" min="0" max="16" step="0.5" data-weekend value="${draft.weekend}">
        </div>
      </div>
      <p class="hint">Per day in each case. You can set each day separately later in Settings.</p>`;
  }

  function doneStep() {
    const named = draft.subjects.filter((x) => x.name.trim()).length;
    return `
      <p class="muted mb-4" style="line-height:1.55">
        That's the setup done${named ? `, with ${named} subject${named === 1 ? "" : "s"} in` : ""}.
        Everything lives on this computer, so there's no account to make and
        nothing to sync.
      </p>
      <p class="muted mb-4" style="line-height:1.55">
        You have <strong>${App.license.trialDaysLeft()} days</strong> of the free
        trial. After that the app keeps everything you've added and stays
        readable, searchable and exportable, but adding more needs a license key.
      </p>
      <div class="note-soft">
        <strong>Where to start:</strong> add your first task with the button at
        the bottom of the sidebar, or press ⌘K and type it in one line, like
        <em>Physics IA draft friday 2h high</em>.
      </div>`;
  }

  const STEPS = [
    { title: "Your subjects", body: subjectsStep, next: "Next" },
    { title: "When are your exams?", body: examsStep, next: "Next" },
    { title: "How much time do you have?", body: hoursStep, next: "Next" },
    { title: "Ready", body: doneStep, next: "Start using it" },
  ];

  /* ---------- committing ---------- */

  function readCurrentStep(el) {
    if (step === 0) {
      el.querySelectorAll("[data-subj-name]").forEach((inp) => {
        const i = Number(inp.dataset.subjName);
        if (draft.subjects[i]) draft.subjects[i].name = inp.value;
      });
      el.querySelectorAll("[data-subj-level]").forEach((sel) => {
        const i = Number(sel.dataset.subjLevel);
        if (draft.subjects[i]) draft.subjects[i].level = sel.value;
      });
    } else if (step === 1) {
      const d = el.querySelector("[data-exam]");
      if (d) draft.examDate = d.value;
    } else if (step === 2) {
      const wd = el.querySelector("[data-weekday]");
      const we = el.querySelector("[data-weekend]");
      if (wd) draft.weekday = wd.value;
      if (we) draft.weekend = we.value;
    }
  }

  // Everything lands at the end, in one go, so a half-finished wizard that
  // gets closed doesn't leave three subjects and no exam date behind.
  function commit() {
    const sys = { system: true };

    draft.subjects.forEach((sub) => {
      const name = sub.name.trim();
      if (name) App.createSubject(name, sub.level, sys);
    });

    const weekday = App.clamp(Number(draft.weekday) || 0, 0, 16);
    const weekend = App.clamp(Number(draft.weekend) || 0, 0, 16);

    App.update((s) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(draft.examDate)) s.settings.exam_date = draft.examDate;
      App.DAY_KEYS.forEach((day, i) => {
        s.settings.hours_per_day[day] = i >= 5 ? weekend : weekday;
      });
      s.ui.setup_done = true;
      s.ui.welcomed = true;   // the old welcome card is what this replaces
    }, sys);
  }

  function skip() {
    App.update((s) => { s.ui.setup_done = true; s.ui.welcomed = true; }, { silent: true, system: true });
    if (modal) modal.close();
  }

  /* ---------- render ---------- */

  function render() {
    if (!modal) return;
    const st = STEPS[step];
    const body = modal.el.querySelector(".modal-body");
    const foot = modal.el.querySelector(".modal-foot");
    const head = modal.el.querySelector(".modal-head h2");

    head.textContent = st.title;
    body.innerHTML = `
      <div class="setup-progress" aria-hidden="true">
        ${STEPS.map((_, i) => `<span class="${i <= step ? "on" : ""}"></span>`).join("")}
      </div>
      ${st.body()}`;
    foot.innerHTML = `
      ${step === 0
        ? `<button class="btn btn-ghost" data-skip>Skip setup</button>`
        : `<button class="btn btn-ghost" data-back>Back</button>`}
      <button class="btn btn-primary" data-next>${esc(st.next)}</button>`;
    bindStep(body, foot);
  }

  function bindStep(body, foot) {
    const el = modal.el;

    foot.querySelector("[data-next]").addEventListener("click", () => {
      readCurrentStep(body);
      if (step < STEP_COUNT - 1) { step += 1; render(); return; }
      commit();
      modal.close();
      App.toast("You're set up");
      // Offer the tour now that the pages have something in them.
      if (App.tour && !App.state().ui.tour_done) setTimeout(() => App.tour.offer(), 400);
    });

    const back = foot.querySelector("[data-back]");
    if (back) back.addEventListener("click", () => { readCurrentStep(body); step -= 1; render(); });

    const skipBtn = foot.querySelector("[data-skip]");
    if (skipBtn) skipBtn.addEventListener("click", skip);

    // subjects step
    const addBtn = body.querySelector("[data-subj-add]");
    if (addBtn) addBtn.addEventListener("click", () => {
      readCurrentStep(body);
      draft.subjects.push({ name: "", level: "" });
      render();
    });
    body.querySelectorAll("[data-subj-del]").forEach((b) =>
      b.addEventListener("click", () => {
        readCurrentStep(body);
        draft.subjects.splice(Number(b.dataset.subjDel), 1);
        if (!draft.subjects.length) draft.subjects.push({ name: "", level: "" });
        render();
      }));

    // Enter moves on rather than submitting nothing
    el.querySelectorAll("input").forEach((inp) =>
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); foot.querySelector("[data-next]").click(); }
      }));
  }

  /* ---------- entry point ---------- */

  S.start = function () {
    // Idempotent by design. The Dashboard schedules this from mount(), and boot
    // mounts twice in quick succession (once on first paint, once when the
    // license settles and re-renders), which stacked two identical wizards on
    // top of each other on a genuinely fresh install. Guarding here rather than
    // only at the call site means any future caller gets the same protection.
    if (modal) return;
    draft = {
      subjects: App.state().subjects.length
        ? App.state().subjects.map((s) => ({ name: s.name, level: s.level || "" }))
        : [{ name: "", level: "" }, { name: "", level: "" }, { name: "", level: "" },
           { name: "", level: "" }, { name: "", level: "" }, { name: "", level: "" }],
      examDate: App.state().settings.exam_date || "",
      weekday: App.state().settings.hours_per_day.monday ?? 3,
      weekend: App.state().settings.hours_per_day.saturday ?? 4,
    };
    step = 0;
    modal = UI.openModal({
      title: STEPS[0].title,
      size: "lg",
      body: "",
      foot: " ",
      footSplit: true,
      onClose: () => { modal = null; },
    });
    render();
  };

  // Re-running setup from Settings starts from what's already there rather
  // than from blank, so it's an edit rather than a reset.
  S.restart = function () { S.start(); };
})();
