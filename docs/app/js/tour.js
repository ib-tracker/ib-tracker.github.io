/* tour.js — first-run guided spotlight tour.
   Dims the screen, cuts a spotlight over a real element and explains it.
   Steps live on the Dashboard + sidebar (always present), so nothing navigates
   mid-tour and the highlighted nodes stay put. */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = App.ui;   // ui.js loads before this file (see index.html)
  const Tour = (App.tour = {});

  /* Six steps, not nineteen.

     The old tour walked every sidebar item in turn, which meant fifteen of its
     steps described a page the user had no reason to care about yet and no
     data to see in it. Nobody retains a table of contents.

     What's left is the handful you genuinely can't discover by clicking: the
     command bar, where work goes in, the two places the app does something
     you wouldn't expect (auto-scheduling, a coach that reads your real data),
     and where the numbers come from. Everything else now explains itself on
     the page it belongs to, the first time you land there empty. */
  const STEPS = [
    { sel: '.sidebar-foot [data-action="new-task"]', title: "Everything starts with a task", placement: "right",
      body: "Assignments, IAs, revision, anything with a deadline. This button is always here, and the form tucks recurrence and predecessors behind “More options” until you want them." },
    { sel: ".sidebar-search", title: "The fastest way in", placement: "right",
      body: "Press ⌘K from anywhere. Jump to any task or page, or just type the task itself: “Physics IA draft friday 2h high” adds it, due date and all." },
    { sel: '[data-nav][href="#/scheduler"]', title: "Let it plan your week", placement: "right",
      body: "Block out school, sport and travel time, then hit Auto-Schedule. It fits your work into the hours you actually have left, in the order your deadlines need." },
    { sel: '[data-nav][href="#/grades"]', title: "Your predicted points, live", placement: "right",
      body: "Enter current and target grades and it works out your total out of 45, including TOK and the EE, and tells you which subject is worth the most effort next." },
    { sel: '[data-nav][href="#/coach"]', title: "Ask it what to do next", placement: "right",
      body: "It reads your real tasks, deadlines and grades and answers from them, offline. It can make changes too, but every one arrives as a preview you confirm first." },
    // Centred deliberately: this is a closing note rather than a pointer, and
    // it was previously aimed at the XP card, which sits far enough down the
    // Dashboard that the tour ended by scrolling you to the bottom of it.
    { center: true, title: "The rest you'll find as you go",
      body: "Finishing tasks and logging study time earns XP, levels and streaks, all shown on your Dashboard. Every page also explains itself the first time you open it, so there's nothing else to memorise now." },
  ];

  let idx = 0, overlay = null, onResize = null;

  function el() { return overlay; }

  function cleanup() {
    if (onResize) { window.removeEventListener("resize", onResize); onResize = null; }
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function finish() {
    cleanup();
    // system: the tour runs on first launch, for people who have no license yet.
    // Without this the completion is refused and the tour replays every launch,
    // forever. UI bookkeeping, not a user edit.
    App.update((s) => { s.ui.tour_done = true; }, { silent: true, system: true });
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "tour-overlay";
    overlay.innerHTML = `<div class="tour-spot"></div><div class="tour-card"></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) { /* keep modal */ } });
  }

  function showStep() {
    ensureOverlay();
    const step = STEPS[idx];
    const spot = overlay.querySelector(".tour-spot");
    const card = overlay.querySelector(".tour-card");
    const target = step.center ? null : document.querySelector(step.sel);

    // skip a step whose target isn't on screen
    if (!step.center && !target) { next(); return; }

    const controls = `
      <div class="tour-actions">
        <button class="btn btn-ghost btn-sm" data-tour-skip>Skip</button>
        <div class="row" style="gap:8px">
          ${idx > 0 ? `<button class="btn btn-outline btn-sm" data-tour-back>Back</button>` : ""}
          <button class="btn btn-primary btn-sm" data-tour-next>${idx === STEPS.length - 1 ? "Done" : "Next"}</button>
        </div>
      </div>`;
    card.innerHTML = `
      <div class="tour-step-count">${idx + 1} / ${STEPS.length}</div>
      <div class="tour-title">${esc(step.title)}</div>
      <div class="tour-body">${esc(step.body)}</div>
      ${controls}`;

    if (step.center || !target) {
      spot.style.display = "none";
      card.classList.add("center");
      card.style.top = ""; card.style.left = ""; card.style.right = ""; card.style.bottom = "";
    } else {
      /* `"instant" in window` was meant as a feature detect and is always
         false, so this fell through to "auto". With .main's
         scroll-behavior:smooth, "auto" animates, and the rect below was read
         on the very next line, before anything had moved. The spotlight was
         drawn at the pre-scroll position, i.e. nowhere near the target.

         Only the sidebar steps escaped it, because they never need scrolling.
         Ask for an instant scroll outright: "instant" is a valid
         ScrollBehavior, so there is nothing to detect. */
      target.scrollIntoView({ block: "center", behavior: "instant" });
      const r = target.getBoundingClientRect();
      const pad = 6;
      spot.style.display = "block";
      spot.style.top = (r.top - pad) + "px";
      spot.style.left = (r.left - pad) + "px";
      spot.style.width = (r.width + pad * 2) + "px";
      spot.style.height = (r.height + pad * 2) + "px";
      card.classList.remove("center");
      positionCard(card, r, step.placement || "bottom");
    }

    card.querySelector("[data-tour-next]").addEventListener("click", next);
    card.querySelector("[data-tour-skip]").addEventListener("click", finish);
    const back = card.querySelector("[data-tour-back]");
    if (back) back.addEventListener("click", prev);
  }

  function positionCard(card, r, placement) {
    const CW = 300, gap = 12, vw = window.innerWidth, vh = window.innerHeight;
    card.style.width = CW + "px";
    // measure height after content set
    const ch = card.offsetHeight || 150;
    let top, left;
    if (placement === "right" && r.right + gap + CW < vw) {
      left = r.right + gap; top = r.top;
    } else if (placement === "left" && r.left - gap - CW > 0) {
      left = r.left - gap - CW; top = r.top;
    } else if (r.bottom + gap + ch < vh) {
      top = r.bottom + gap; left = r.left;
    } else {
      top = r.top - gap - ch; left = r.left;
    }
    left = Math.max(12, Math.min(left, vw - CW - 12));
    top = Math.max(12, Math.min(top, vh - ch - 12));
    card.style.top = top + "px";
    card.style.left = left + "px";
    card.style.right = "auto"; card.style.bottom = "auto";
  }

  function next() {
    if (idx >= STEPS.length - 1) {
      const dest = STEPS[idx] && STEPS[idx].navTo;
      finish();
      if (dest) App.navigate(dest); // drop them straight into Settings to fill things in
      return;
    }
    idx++;
    showStep();
  }
  function prev() { if (idx > 0) { idx--; showStep(); } }

  Tour.start = function () {
    idx = 0;
    cleanup();
    // land on the Dashboard (where the highlighted widgets live), then run
    if (App.currentPage() !== "dashboard") App.navigate("dashboard");
    if (window.innerWidth <= 860 && App.ui.openSidebar) App.ui.openSidebar();
    onResize = () => showStep();
    window.addEventListener("resize", onResize);
    setTimeout(showStep, 90);
  };

  /* Offered rather than forced. The tour used to launch itself the moment the
     welcome card was dismissed, which is the worst time to ask for six screens
     of attention: the user has just finished setup and wants to see the thing
     they set up. This asks, and takes no for an answer permanently. */
  Tour.offer = function () {
    if (App.state().ui.tour_done) return;
    const m = UI.openModal({
      title: "Quick look around?",
      size: "sm",
      body: `<p class="muted" style="line-height:1.6;margin:0">
               Six things worth knowing, about a minute. You can start it any
               time from Settings instead.
             </p>`,
      foot: `<button class="btn btn-ghost" data-tour-no>No thanks</button>
             <button class="btn btn-primary" data-tour-yes>Show me</button>`,
      footSplit: true,
    });
    m.el.querySelector("[data-tour-yes]").addEventListener("click", () => { m.close(); Tour.start(); });
    m.el.querySelector("[data-tour-no]").addEventListener("click", () => {
      // system: whoever declines has no license yet, and without this the
      // offer returns on every launch forever.
      App.update((s) => { s.ui.tour_done = true; }, { silent: true, system: true });
      m.close();
    });
  };

  Tour.maybeAutoStart = function () {
    const s = App.state();
    // Setup now owns first run. The tour only auto-offers to someone who
    // finished setup in an earlier session and never saw it.
    if (!s.ui.tour_done && s.ui.setup_done) {
      setTimeout(() => { if (!App.state().ui.tour_done) Tour.offer(); }, 600);
    }
  };
})();
