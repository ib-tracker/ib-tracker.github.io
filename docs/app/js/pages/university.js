/* pages/university.js — applications, deadlines, key steps, materials, linked tasks */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = App.ui;
  const D = App.dates;
  const C = App.charts;

  const isPast = (ds) => ds && ds < D.today();

  function requirementRowHTML(req) {
    req = req || { subject_name: "", grade: "" };
    return `
      <div class="row" style="gap:7px;margin-bottom:7px" data-req-row>
        ${UI.selectHTML("req_subject", UI.subjectOptions(req.subject_name, false), req.subject_name, 'data-req-subject style="flex:1"')}
        <input class="input" type="number" min="1" max="7" placeholder="Grade" value="${req.grade || ""}" data-req-grade style="width:78px">
        <button class="icon-btn danger" data-req-del title="Remove requirement" type="button">${App.icon("x")}</button>
      </div>`;
  }

  function linkRowHTML(link) {
    link = link || { label: "", url: "" };
    return `
      <div class="row" style="gap:7px;margin-bottom:7px" data-link-row>
        <input class="input" placeholder="Label (e.g. Course page)" value="${esc(link.label)}" data-link-label style="flex:1">
        <input class="input" placeholder="https://…" value="${esc(link.url)}" data-link-url style="flex:1.6">
        <button class="icon-btn danger" data-link-del title="Remove link" type="button">${App.icon("x")}</button>
      </div>`;
  }

  // A repeatable label+URL list. Returns a read() that validates on save.
  function wireLinkList(el) {
    const list = el.querySelector("[data-link-list]");
    if (!list) return () => [];
    const wire = (row) => row.querySelector("[data-link-del]").addEventListener("click", () => row.remove());
    list.querySelectorAll("[data-link-row]").forEach(wire);
    const addBtn = el.querySelector("[data-link-add]");
    if (addBtn) addBtn.addEventListener("click", () => {
      const wrap = document.createElement("div");
      wrap.innerHTML = linkRowHTML(null);
      const row = wrap.firstElementChild;
      wire(row);
      list.appendChild(row);
      row.querySelector("[data-link-label]").focus();
    });
    return () => [...list.querySelectorAll("[data-link-row]")].map((row) => {
      const url = App.safeURL(row.querySelector("[data-link-url]").value);
      const label = row.querySelector("[data-link-label]").value.trim().slice(0, 40);
      return { label: label || App.urlHost(url) || "Link", url };
    }).filter((l) => l.url);
  }

  /* ---------- portals (quick-launch links) ---------- */
  function openPortalModal(portal) {
    UI.openModal({
      title: portal ? "Edit portal link" : "Add portal link",
      size: "sm",
      body: `
        <div class="field"><label>Label</label>
          <input class="input" name="label" value="${esc(portal ? portal.label : "")}" placeholder="e.g. UCAS" maxlength="40"></div>
        <div class="field"><label>Link</label>
          <input class="input" name="url" value="${esc(portal ? portal.url : "")}" placeholder="https://www.ucas.com/">
          <p class="hint">Opens in your browser. Leave the label blank to use the site name.</p>
        </div>`,
      footSplit: !!portal,
      foot: `${portal ? `<button class="btn btn-danger-ghost" data-remove>${App.icon("trash")} Remove</button>` : ""}
             <div class="row" style="gap:8px">
               <button class="btn btn-outline" data-close>Cancel</button>
               <button class="btn btn-primary" data-save>${portal ? "Save" : "Add link"}</button>
             </div>`,
      onMount(el, handle) {
        const save = () => {
          const f = UI.readForm(el);
          if (!App.safeURL(f.url)) { App.toast("Enter a valid http(s) link", "error"); return; }
          App.savePortal(portal ? portal.id : null, { label: f.label, url: f.url });
          App.toast(portal ? "Link updated" : "Link added");
          handle.close();
        };
        el.querySelector("[data-save]").addEventListener("click", save);
        el.querySelectorAll(".input").forEach((i) =>
          i.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); }));
        const remove = el.querySelector("[data-remove]");
        if (remove) remove.addEventListener("click", () => {
          App.deletePortal(portal.id);
          App.toast("Link removed");
          handle.close();
        });
      },
    });
  }

  function portalsHTML() {
    const portals = App.state().portals;
    return `
      <div class="uni-quicklaunch">
        <span class="ql-label">Open your portals</span>
        ${portals.map((p) => `
          <span class="ql-link">
            <a class="btn btn-outline btn-sm" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer"
              title="${esc(p.url)}">${App.icon("link")} ${esc(p.label)}</a>
            <button class="ql-edit" data-portal-edit="${esc(p.id)}" title="Edit ${esc(p.label)}" aria-label="Edit ${esc(p.label)}">${App.icon("pencil")}</button>
          </span>`).join("")}
        <button class="btn btn-ghost btn-sm" data-portal-add>${App.icon("plus")} Add link</button>
      </div>`;
  }

  function hlTotalBarHTML(course) {
    const required = course.hl_total_required || 0;
    if (!required) return "";
    const current = App.currentHLTotal();
    const meets = current >= required;
    const scale = Math.max(required, 21);
    return `
      <div class="req-bar-row">
        <div class="req-bar-label">🎯 HL total</div>
        <div class="req-bar-track">
          <div class="req-bar-fill" style="width:${App.clamp((current / scale) * 100, 0, 100)}%;background:${meets ? "var(--good-ink)" : "var(--accent)"}"></div>
          <div class="req-bar-marker" style="left:${App.clamp((required / scale) * 100, 0, 100)}%" title="Required: ${required}"></div>
        </div>
        <div class="req-bar-value">${current} <span class="muted small">/ needs ${required}</span></div>
      </div>`;
  }

  function requirementBarsHTML(course) {
    // Array.isArray, not `|| []`: a non-array truthy value (a string from a
    // hand-edited backup) passes the falsy guard and then has no .map.
    const reqs = Array.isArray(course.requirements) ? course.requirements : [];
    const hlBar = hlTotalBarHTML(course);
    if (!reqs.length && !hlBar) return "";
    const s = App.state();
    const rows = reqs.map((r) => {
      const meta = App.subjectMeta(r.subject_name);
      const grade = s.grades.find((g) => g.subject_name === r.subject_name);
      const has = grade && s.subjects.some((x) => x.name === r.subject_name);
      const current = has ? (grade.current_grade || 0) : 0;
      const meets = has && current >= r.grade;
      return `
        <div class="req-bar-row">
          <div class="req-bar-label">${meta.emoji ? meta.emoji + " " : ""}${esc(r.subject_name)}</div>
          <div class="req-bar-track">
            ${has ? `<div class="req-bar-fill" style="width:${App.clamp((current / 7) * 100, 0, 100)}%;background:${meets ? "var(--good-ink)" : meta.color}"></div>` : ""}
            <div class="req-bar-marker" style="left:${App.clamp((r.grade / 7) * 100, 0, 100)}%" title="Required: ${r.grade}"></div>
          </div>
          <div class="req-bar-value ${has ? "" : "muted"}">${has ? current : "N/A"} <span class="muted small">/ needs ${r.grade}</span></div>
        </div>`;
    }).join("");
    return `<div class="section-label" style="margin-top:10px">Requirements</div><div class="req-bars">${hlBar}${rows}</div>`;
  }

  const optionsOf = (keys) => keys.map((k) => [k, App.UNI_STATUSES[k].label]);

  // Decision and reply, shared by the course form whether or not the course is
  // on an application. A reply only means something once there's an offer.
  function outcomeFieldsHTML(f) {
    return `
        <div class="form-row">
          <div class="field"><label>Their decision</label>${UI.selectHTML("decision", [["", "No decision yet"], ...optionsOf(App.UNI_DECISIONS)], f.decision || "", "data-decision")}</div>
          <div class="field"><label>Your reply</label>${UI.selectHTML("reply", [["", "No reply yet"], ...optionsOf(App.UNI_REPLIES)], f.reply || "", `data-reply ${App.isUniOffer(f.decision) ? "" : "disabled"}`)}</div>
        </div>`;
  }

  /* Add or edit a course. `presetAppId` opens it already on an application
     (the "Add course" button inside an application's card). */
  function openCourseModal(course, presetAppId) {
    const f = course || {
      university_name: "", course_name: "", application_deadline: "", entrance_exam_date: "",
      interview_date: "", offer_ib_points: "", hl_total_required: "", requirements: [], links: [],
      stage: "not_started", decision: "", reply: "", tuition_cny: "", tuition_secondary: "", tuition_currency: "USD", notes: "",
      application_id: presetAppId || "", own_deadline: "",
    };
    const ibPoints = [];
    for (let p = 24; p <= 45; p++) ibPoints.push([String(p), p + " points"]);
    const apps = App.state().applications;
    const appOpts = [["", "None (a standalone course)"], ...apps.map((x) => [x.id, x.name || "Untitled application"])];
    const curApp = f.application_id || "";
    const onApp = !!curApp;
    const appDeadline = (id) => { const x = App.applicationById(id); return x && x.application_deadline ? D.fmtMed(x.application_deadline) : "not set"; };
    UI.openModal({
      title: course ? "Edit Course" : "Add University Course",
      size: "lg",
      body: `
        <div class="form-row">
          <div class="field"><label>University *</label><input class="input" name="university_name" value="${esc(f.university_name)}" placeholder="e.g. Oxford"></div>
          <div class="field"><label>Course *</label><input class="input" name="course_name" value="${esc(f.course_name)}" placeholder="e.g. PPE"></div>
        </div>
        ${apps.length ? `
          <div class="field">
            <label>Application</label>
            ${UI.selectHTML("application_id", appOpts, curApp, "data-app-pick")}
            <p class="hint">Part of UCAS, Common App, or one university's application covering several courses? Pick it here; the deadline, status and shared checklists then come from the application.</p>
          </div>` : ""}
        <div class="form-row">
          <div class="field" data-standalone ${onApp ? "hidden" : ""}><label>Application deadline</label><input class="input" type="date" name="application_deadline" value="${esc(onApp ? "" : f.application_deadline)}"></div>
          <div class="field" data-on-app ${onApp ? "" : "hidden"}>
            <label>Own deadline <span class="muted" style="font-weight:400">(optional)</span></label>
            <input class="input" type="date" name="own_deadline" value="${esc(f.own_deadline || "")}">
            <p class="hint" data-app-deadline-hint>Leave blank to use the application's: ${esc(appDeadline(curApp))}</p>
          </div>
          <div class="field" data-standalone ${onApp ? "hidden" : ""}><label>Status</label>${UI.selectHTML("stage", optionsOf(App.UNI_STAGES), f.stage || "not_started")}</div>
        </div>
        <div class="form-row">
          <div class="field"><label>Entrance exam date</label><input class="input" type="date" name="entrance_exam_date" value="${esc(f.entrance_exam_date)}"></div>
          <div class="field"><label>Interview date</label><input class="input" type="date" name="interview_date" value="${esc(f.interview_date)}"></div>
        </div>
        ${outcomeFieldsHTML(f)}
        <hr class="divider">
        <div class="section-label">Offer conditions</div>
        <div class="form-row">
          <div class="field"><label>Required IB points</label>${UI.selectHTML("offer_ib_points", [["", "Not specified"], ...ibPoints], String(f.offer_ib_points || ""))}</div>
          <div class="field"><label>Required HL total</label><input class="input" type="number" min="0" max="21" name="hl_total_required" value="${f.hl_total_required || ""}" placeholder="e.g. 18"></div>
        </div>
        <div class="field">
          <label>Subject requirements</label>
          <div data-req-list>${(f.requirements || []).map(requirementRowHTML).join("")}</div>
          <button type="button" class="btn btn-outline btn-sm" data-req-add>${App.icon("plus")} Add requirement</button>
        </div>
        <hr class="divider">
        <div class="field">
          <label>Links</label>
          <p class="hint mb-2">Course page, prospectus — anything you keep re-finding.</p>
          <div data-link-list>${(f.links || []).map(linkRowHTML).join("")}</div>
          <button type="button" class="btn btn-outline btn-sm" data-link-add>${App.icon("plus")} Add link</button>
        </div>
        <hr class="divider">
        <div class="section-label">Tuition (annual)</div>
        <div class="form-row">
          <div class="field"><label>Tuition (CNY ¥)</label><input class="input" type="number" min="0" name="tuition_cny" value="${f.tuition_cny || ""}"></div>
          <div class="field">
            <label>Other currency</label>
            <div class="row" style="gap:7px">
              <input class="input" type="number" min="0" name="tuition_secondary" value="${f.tuition_secondary || ""}" style="flex:1">
              ${UI.selectHTML("tuition_currency", App.CURRENCIES.map((c) => [c, c]), f.tuition_currency || "USD", 'style="width:90px"')}
            </div>
          </div>
        </div>
        <div class="field"><label>Notes</label><textarea class="textarea" name="notes" rows="2">${esc(f.notes)}</textarea></div>`,
      foot: `<button class="btn btn-outline" data-close>Cancel</button>
             <button class="btn btn-primary" data-save>${course ? "Update" : "Add Course"}</button>`,
      onMount(el, handle) {
        const readLinks = wireLinkList(el);
        const pick = el.querySelector("[data-app-pick]");
        if (pick) pick.addEventListener("change", () => {
          const on = !!pick.value;
          el.querySelectorAll("[data-standalone]").forEach((n) => { n.hidden = on; });
          el.querySelectorAll("[data-on-app]").forEach((n) => { n.hidden = !on; });
          el.querySelector("[data-app-deadline-hint]").textContent = `Leave blank to use the application's: ${appDeadline(pick.value)}`;
          // Joining from standalone: a deadline of its own that differs from
          // the application's is carried over, visibly, rather than dropped.
          const own = el.querySelector("[name=own_deadline]");
          const mine = el.querySelector("[name=application_deadline]").value;
          const x = on && App.applicationById(pick.value);
          if (x && !own.value && mine && mine !== x.application_deadline) own.value = mine;
        });
        const decision = el.querySelector("[data-decision]"), reply = el.querySelector("[data-reply]");
        decision.addEventListener("change", () => {
          reply.disabled = !App.isUniOffer(decision.value);
          if (reply.disabled) reply.value = "";
        });
        const reqList = el.querySelector("[data-req-list]");
        const wireReqRow = (rowEl) => rowEl.querySelector("[data-req-del]").addEventListener("click", () => rowEl.remove());
        reqList.querySelectorAll("[data-req-row]").forEach(wireReqRow);
        el.querySelector("[data-req-add]").addEventListener("click", () => {
          const wrap = document.createElement("div");
          wrap.innerHTML = requirementRowHTML(null);
          const rowEl = wrap.firstElementChild;
          wireReqRow(rowEl);
          reqList.appendChild(rowEl);
        });

        el.querySelector("[data-save]").addEventListener("click", () => {
          const data = UI.readForm(el);
          if (!String(data.university_name || "").trim() || !String(data.course_name || "").trim()) {
            App.toast("University and course names are required", "error");
            return;
          }
          const appId = pick ? pick.value : curApp;
          const requirements = [...reqList.querySelectorAll("[data-req-row]")].map((rowEl) => ({
            subject_name: rowEl.querySelector("[data-req-subject]").value,
            grade: App.clamp(Number(rowEl.querySelector("[data-req-grade]").value) || 0, 0, 7),
          })).filter((r) => r.subject_name && r.grade);
          const payload = {
            university_name: data.university_name.trim(), course_name: data.course_name.trim(),
            entrance_exam_date: data.entrance_exam_date || "", interview_date: data.interview_date || "",
            decision: data.decision || "", reply: App.isUniOffer(data.decision) ? data.reply || "" : "",
            offer_ib_points: Number(data.offer_ib_points) || 0,
            hl_total_required: App.clamp(Number(data.hl_total_required) || 0, 0, 21),
            requirements,
            links: readLinks(),
            tuition_cny: Number(data.tuition_cny) || 0,
            tuition_secondary: Number(data.tuition_secondary) || 0,
            tuition_currency: data.tuition_currency || "USD",
            notes: data.notes || "",
          };
          // Standalone fields only when it stays standalone; on an application
          // the deadline and status are the application's.
          if (!appId) { payload.application_deadline = data.application_deadline || ""; payload.stage = data.stage || "not_started"; }
          // A course created straight onto an application takes the
          // application's checklists — defaults would re-add removed steps.
          if (!course && !appId) {
            payload.key_steps = App.defaultKeySteps().map((item) => ({ item, completed: false }));
            payload.materials = App.defaultMaterials().map((item) => ({ item, completed: false }));
          }
          if (!course) payload.application_id = "";   // joined below, through the one path that merges
          const id = App.saveCourse(course ? course.id : null, payload);
          if ((course ? course.application_id || "" : "") !== appId) App.setCourseApplication(id, appId);
          if (appId) App.updateCourse(id, { own_deadline: data.own_deadline || "" });
          App.toast(course ? "Course updated" : "Course added");
          handle.close();
        });
      },
    });
  }

  /* Link courses that already exist to an application, several at once.
     Courses already on another application are offered too, marked as moving
     — App.setCourseApplication handles both: a standalone course's checklists
     merge into the application's, one moving between applications brings only
     its own. */
  function openLinkCoursesModal(app) {
    const apps = Object.fromEntries(App.state().applications.map((a) => [a.id, a]));
    const candidates = App.state().courses
      .filter((c) => c.application_id !== app.id)
      .sort((a, b) => (a.application_id ? 1 : 0) - (b.application_id ? 1 : 0)
        || `${a.university_name} ${a.course_name}`.localeCompare(`${b.university_name} ${b.course_name}`));
    if (!candidates.length) {
      App.toast("No other courses to link yet. Add one with Add Course.", "error");
      return;
    }
    UI.openModal({
      title: `Link courses to ${app.name || "this application"}`,
      body: `
        <p class="muted small mb-3">Tick the courses that are part of this application. Their deadline and status will then come from the application.</p>
        <div class="link-course-list">
          ${candidates.map((c) => {
            const from = c.application_id && apps[c.application_id];
            return `
            <label class="link-course-row">
              <input type="checkbox" value="${esc(c.id)}" data-link-course>
              <span>
                <span class="lcr-name">${esc(c.university_name)} — ${esc(c.course_name)}</span>
                <span class="lcr-sub">${from ? `On ${esc(from.name)} · will move here` : "Standalone course"}</span>
              </span>
            </label>`;
          }).join("")}
        </div>`,
      foot: `<button class="btn btn-outline" data-close>Cancel</button>
             <button class="btn btn-primary" data-link-save disabled>Link courses</button>`,
      onMount(el, handle) {
        const boxes = [...el.querySelectorAll("[data-link-course]")];
        const save = el.querySelector("[data-link-save]");
        const sync = () => {
          const n = boxes.filter((b) => b.checked).length;
          save.disabled = !n;
          save.textContent = n ? `Link ${n} course${n === 1 ? "" : "s"}` : "Link courses";
        };
        boxes.forEach((b) => b.addEventListener("change", sync));
        save.addEventListener("click", () => {
          const ids = boxes.filter((b) => b.checked).map((b) => b.value);
          for (const id of ids) App.setCourseApplication(id, app.id);
          App.toast(`Linked ${ids.length} course${ids.length === 1 ? "" : "s"} to ${app.name || "the application"}`);
          handle.close();
        });
      },
    });
  }

  /* Add or edit an application: UCAS, Common App, or one university's
     application covering several courses. */
  function openApplicationModal(app) {
    const f = app || { name: "", application_deadline: "", stage: "not_started", ranked: false, links: [], notes: "" };
    UI.openModal({
      title: app ? "Edit Application" : "Add Application",
      body: `
        <div class="field"><label>Name *</label>
          <input class="input" name="name" value="${esc(f.name)}" placeholder="e.g. UCAS, Common App, University of Hong Kong" maxlength="80">
          <p class="hint">One application covering several courses. Add courses to it afterwards, from its card or from each course's form.</p></div>
        <div class="form-row">
          <div class="field"><label>Deadline</label><input class="input" type="date" name="application_deadline" value="${esc(f.application_deadline)}"></div>
          <div class="field"><label>Status</label>${UI.selectHTML("stage", optionsOf(App.UNI_STAGES), f.stage)}</div>
        </div>
        <label class="row" style="gap:8px;font-size:13px;margin-bottom:14px;cursor:pointer">
          <input type="checkbox" name="ranked" ${f.ranked ? "checked" : ""}> These choices are ranked (1st choice, 2nd choice…)
        </label>
        <div class="field">
          <label>Links</label>
          <div data-link-list>${(f.links || []).map(linkRowHTML).join("")}</div>
          <button type="button" class="btn btn-outline btn-sm" data-link-add>${App.icon("plus")} Add link</button>
        </div>
        <div class="field"><label>Notes</label><textarea class="textarea" name="notes" rows="2">${esc(f.notes)}</textarea></div>`,
      footSplit: !!app,
      foot: `${app ? `<button class="btn btn-danger-ghost" data-app-delete>${App.icon("trash")} Delete</button>` : ""}
             <span class="grp">
               <button class="btn btn-outline" data-close>Cancel</button>
               <button class="btn btn-primary" data-save>${app ? "Update" : "Add Application"}</button>
             </span>`,
      onMount(el, handle) {
        const readLinks = wireLinkList(el);
        el.querySelector("[data-save]").addEventListener("click", () => {
          const data = UI.readForm(el);
          const name = String(data.name || "").trim();
          if (!name) { App.toast("Give the application a name", "error"); return; }
          App.saveApplication(app ? app.id : null, {
            name, application_deadline: data.application_deadline || "", stage: data.stage || "not_started",
            ranked: !!el.querySelector("[name=ranked]").checked, links: readLinks(), notes: data.notes || "",
          });
          App.toast(app ? "Application updated" : "Application added");
          handle.close();
        });
        const del = el.querySelector("[data-app-delete]");
        if (del) del.addEventListener("click", async () => {
          const n = App.applicationCourses(app.id).length;
          const ok = await UI.confirm({
            title: "Delete application?",
            message: `“${app.name}” will be removed.${n ? ` Its ${n} course${n === 1 ? "" : "s"} stay, each as a standalone course with its own copy of the deadline, status and checklists.` : ""} Tasks linked to the application become unlinked.`,
          });
          if (!ok) return;
          handle.close();
          App.deleteApplication(app.id);
          App.toast("Application deleted");
        });
      },
    });
  }

  function openUniTaskModal(defaultCourseId) {
    App.taskui.openTaskModal(null, {
      category: "university_application",
      university_course_id: defaultCourseId || "",
    });
  }

  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");

  const dateChip = (label, ds, overduePrefix) => {
    if (!ds) return "";
    const late = isPast(ds);
    return `<span class="chip ${late ? "chip-danger" : "chip-plain"}">${App.icon("calendar")} ${label}: ${D.fmtMed(ds)}${late ? " · " + (overduePrefix || "passed") : ""}</span>`;
  };
  const statusChip = (key, title) => {
    const st = App.UNI_STATUSES[key];
    return st ? `<span class="chip ${st.chip}"${title ? ` title="${esc(title)}"` : ""}>${esc(st.label)}</span>` : "";
  };
  // The decision and the reply, side by side: "Conditional Offer" "Firm Choice".
  const outcomeChips = (c) => statusChip(c.decision, "Their decision") + statusChip(c.reply, "Your reply");

  function factsHTML(course) {
    if (!(course.offer_ib_points || course.tuition_cny || course.tuition_secondary)) return "";
    return `
      <div class="uni-facts">
        ${course.offer_ib_points ? `<span>Offer: <strong>${course.offer_ib_points} pts</strong></span>` : ""}
        ${course.tuition_cny ? `<span>Tuition: <strong>¥${course.tuition_cny.toLocaleString()}/yr</strong></span>` : ""}
        ${course.tuition_secondary ? `<span><strong>${course.tuition_secondary.toLocaleString()} ${esc(course.tuition_currency || "USD")}/yr</strong></span>` : ""}
      </div>`;
  }

  function linksHTML(links) {
    if (!(links || []).length) return "";
    return `
      <div class="uni-links">
        ${links.map((l) => `
          <a class="uni-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">
            ${App.icon("link")} ${esc(l.label)}
          </a>`).join("")}
      </div>`;
  }

  // A tickable list with add/remove. `kind` names the data-attributes the
  // handlers in mount() look for: step, mat or cstep.
  function checklistHTML(items, kind, placeholder, empty) {
    return `
      <div class="stack-sm" style="gap:2px">
        ${items.map((it, i) => `
          <div class="checklist-row ${it.completed ? "done" : ""}">
            <button class="task-check ${it.completed ? "checked" : ""}" style="width:17px;height:17px" data-${kind}="${i}">${App.icon("check")}</button>
            <span class="cl-text">${esc(it.item)}</span>
            <button class="icon-btn danger" data-${kind}-del="${i}" title="Remove">${App.icon("x")}</button>
          </div>`).join("")}
        ${!items.length && empty ? `<p class="muted small">${empty}</p>` : ""}
      </div>
      <div class="subtask-add">
        <input class="input input-sm" data-${kind}-new placeholder="${placeholder}" style="flex:1">
        <button class="btn btn-outline btn-sm" data-${kind}-add aria-label="${placeholder}">${App.icon("plus")}</button>
      </div>`;
  }

  /* Tracker, materials, linked tasks and notes. `owner` is the course (on its
     own) or the application; `labelFor` names the course a task belongs to
     when the list spans an application. */
  function trackerBodyHTML(owner, tasks, labelFor, isApp) {
    const keySteps = owner.key_steps || [];
    const doneSteps = keySteps.filter((k) => k.completed).length;
    const stepPct = keySteps.length ? Math.round((doneSteps / keySteps.length) * 100) : 0;
    return `
        <div class="card-pad stack">
          <div>
            <div class="row between mb-2">
              <span class="section-label" style="margin-bottom:0">${isApp ? "Shared application tracker" : "Application tracker"} <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">· tick off, remove, or add your own</span></span>
              <span class="muted small">${doneSteps}/${keySteps.length}</span>
            </div>
            <div class="progress thin mb-3"><span style="width:${stepPct}%"></span></div>
            ${checklistHTML(keySteps, "step", "Add a step…", "No steps yet")}
          </div>
          <div>
            <div class="section-label">${isApp ? "Shared materials" : "Required materials"} <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">· tick off, remove, or add your own below</span></div>
            ${checklistHTML(owner.materials || [], "mat", "Add material…", "No materials added")}
          </div>
          <div>
            <div class="row between mb-2">
              <span class="section-label" style="margin-bottom:0">Linked tasks</span>
              <button class="btn btn-ghost btn-sm" data-add-task-for>${App.icon("plus")} Add task</button>
            </div>
            <div class="stack-sm" style="gap:2px">
              ${tasks.map((t) => `
                <div class="checklist-row ${t.completed ? "done" : ""}" data-linked-task="${esc(t.id)}">
                  <button class="task-check ${t.completed ? "checked" : ""}" style="width:17px;height:17px" data-lt-toggle>${App.icon("check")}</button>
                  <span class="cl-text">${esc(t.title)}</span>
                  ${labelFor && labelFor(t) ? `<span class="chip chip-plain">${esc(labelFor(t))}</span>` : ""}
                  ${t.due_date ? `<span class="small ${App.isOverdue(t) ? "chip chip-danger" : "muted"}">${D.fmtShort(t.due_date)}</span>` : ""}
                  ${UI.priorityChip(t.priority)}
                  <button class="icon-btn danger" data-lt-del title="Delete task">${App.icon("trash")}</button>
                </div>`).join("")}
              ${!tasks.length ? `<p class="muted small">No tasks linked to this ${isApp ? "application" : "course"}</p>` : ""}
            </div>
          </div>
          ${owner.notes ? `
            <div>
              <div class="section-label">Notes</div>
              <p class="small muted" style="white-space:pre-wrap">${esc(owner.notes)}</p>
            </div>` : ""}
        </div>`;
  }

  function courseCardHTML(course, uniTasks) {
    const tasks = uniTasks.filter((t) => t.university_course_id === course.id);
    return `
      <div class="card" data-owner="course" data-owner-id="${esc(course.id)}">
        <div class="card-pad" style="border-bottom:1px solid var(--hairline)">
          <div class="row between" style="align-items:flex-start">
            <div>
              <h3 style="font-size:16px">${esc(course.university_name)}</h3>
              <p class="muted" style="font-size:13px">${esc(course.course_name)}</p>
            </div>
            <div class="row wrap" style="gap:6px;justify-content:flex-end">
              ${course.decision ? outcomeChips(course) : statusChip(course.stage)}
              <button class="icon-btn" data-cact="edit" data-cid="${esc(course.id)}" title="Edit course">${App.icon("pencil")}</button>
              <button class="icon-btn danger" data-cact="delete" data-cid="${esc(course.id)}" title="Delete course">${App.icon("trash")}</button>
            </div>
          </div>
          <div class="uni-head-chips">
            ${dateChip("Apply by", course.application_deadline)}
            ${dateChip("Exam", course.entrance_exam_date)}
            ${dateChip("Interview", course.interview_date)}
          </div>
          ${factsHTML(course)}
          ${requirementBarsHTML(course)}
          ${linksHTML(course.links)}
        </div>
        ${trackerBodyHTML(course, tasks, null, false)}
      </div>`;
  }

  /* An application: its name, deadline, status and links on top; then each
     course as a row of its own — university, course, its own dates, decision
     and reply, offer conditions and a checklist just for it; then the
     application's shared tracker, materials, tasks and notes. */
  function applicationCardHTML(app, courses, uniTasks) {
    const ids = new Set(courses.map((c) => c.id));
    const tasks = uniTasks.filter((t) => t.university_course_id === app.id || ids.has(t.university_course_id));
    const byId = Object.fromEntries(courses.map((c) => [c.id, c]));
    const labelFor = (t) => byId[t.university_course_id]
      ? `${byId[t.university_course_id].university_name === app.name ? "" : byId[t.university_course_id].university_name + " · "}${byId[t.university_course_id].course_name}` : "";
    const warnings = App.applicationWarnings(app, courses);
    const sameUni = (c) => c.university_name.trim().toLowerCase() === String(app.name || "").trim().toLowerCase();
    return `
      <div class="card uni-app" data-owner="app" data-owner-id="${esc(app.id)}">
        <div class="card-pad" style="border-bottom:1px solid var(--hairline)">
          <div class="row between" style="align-items:flex-start">
            <div>
              <h3 style="font-size:16px">${esc(app.name || "Untitled application")}</h3>
              <p class="muted" style="font-size:13px">Application · ${courses.length ? `${courses.length} course${courses.length === 1 ? "" : "s"}` : "no courses yet"}</p>
            </div>
            <div class="row" style="gap:6px">
              ${statusChip(app.stage, "Application status")}
              <button class="icon-btn" data-app-edit="${esc(app.id)}" title="Edit application">${App.icon("pencil")}</button>
            </div>
          </div>
          <div class="uni-head-chips">${dateChip("Apply by", app.application_deadline)}</div>
          ${linksHTML(app.links)}
          ${warnings.length ? `
            <div class="uni-warn">${warnings.map((w) => `<div>${App.icon("alertTri")} ${esc(w)}</div>`).join("")}</div>` : ""}
        </div>
        <div class="uni-app-courses">
          ${courses.map((c, i) => `
            <div class="uni-app-course">
              <div class="row between" style="align-items:flex-start;gap:8px">
                <div style="min-width:0">
                  ${app.ranked ? `<div class="uac-rank">${ordinal(i + 1)} choice</div>` : ""}
                  ${sameUni(c) ? "" : `<div class="uac-uni">${esc(c.university_name)}</div>`}
                  <div class="uac-name">${esc(c.course_name)}</div>
                </div>
                <div class="row" style="gap:4px;flex-shrink:0">
                  ${app.ranked ? `
                    <button class="icon-btn" data-choice="-1" data-cid="${esc(c.id)}" title="Move up" aria-label="Move ${esc(c.course_name)} up" ${i === 0 ? "disabled" : ""}>${App.icon("chevU")}</button>
                    <button class="icon-btn" data-choice="1" data-cid="${esc(c.id)}" title="Move down" aria-label="Move ${esc(c.course_name)} down" ${i === courses.length - 1 ? "disabled" : ""}>${App.icon("chevD")}</button>` : ""}
                  <button class="icon-btn" data-cact="edit" data-cid="${esc(c.id)}" title="Edit course">${App.icon("pencil")}</button>
                  <button class="icon-btn danger" data-cact="delete" data-cid="${esc(c.id)}" title="Delete course">${App.icon("trash")}</button>
                </div>
              </div>
              ${(c.decision || c.own_deadline || c.entrance_exam_date || c.interview_date) ? `
                <div class="uni-head-chips">
                  ${outcomeChips(c)}
                  ${c.own_deadline ? dateChip("Own deadline", c.own_deadline) : ""}
                  ${dateChip("Exam", c.entrance_exam_date)}
                  ${dateChip("Interview", c.interview_date)}
                </div>` : ""}
              ${factsHTML(c)}
              ${requirementBarsHTML(c)}
              ${linksHTML(c.links)}
              ${c.notes ? `<p class="small muted mt-2" style="white-space:pre-wrap">${esc(c.notes)}</p>` : ""}
              ${/* Collapsed to a button until it has something in it: five
                    empty boxes on a UCAS card is a lot of nothing. */""}
              <div class="uac-steps" data-course-steps="${esc(c.id)}">
                ${(c.course_steps || []).length ? "" : `<button class="btn btn-ghost btn-sm uac-steps-open" data-cstep-open>${App.icon("plus")} Step for this course</button>`}
                <div data-cstep-body ${(c.course_steps || []).length ? "" : "hidden"}>
                  <div class="section-label" style="margin:10px 0 4px">For this course</div>
                  ${checklistHTML(c.course_steps || [], "cstep", "Add a step for this course…", "")}
                </div>
              </div>
            </div>`).join("")}
          <div class="uni-app-add">
            <button class="btn btn-ghost btn-sm" data-add-course-to="${esc(app.id)}">${App.icon("plus")} Add course to this application</button>
            <button class="btn btn-ghost btn-sm" data-link-courses-to="${esc(app.id)}">${App.icon("link")} Link existing courses</button>
          </div>
        </div>
        ${trackerBodyHTML(app, tasks, labelFor, true)}
      </div>`;
  }

  function gaugeHTML() {
    const pp = App.predictedPoints();
    const pct = pp.maxPoints ? App.clamp(Math.round((pp.totalPoints / pp.maxPoints) * 100), 0, 100) : 0;
    const r = 52, circumference = 2 * Math.PI * r;
    const offset = circumference * (1 - pct / 100);
    return `
      <div class="card card-pad mb-4" style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">
        <div class="prog-ring-wrap" style="flex-shrink:0;width:120px;height:120px;margin:0">
          <svg viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="9"/>
            <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--accent)" stroke-width="9"
              stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"
              style="transition:stroke-dashoffset .7s ease"/>
          </svg>
          <div class="prog-ring-center">
            <span class="v">${pp.gradesCount ? pp.totalPoints : "—"}</span>
            <span class="l">/ ${pp.maxPoints || "—"} pts</span>
          </div>
        </div>
        <div style="flex:1;min-width:200px">
          <div class="card-title mb-1">Predicted total IB points</div>
          <p class="card-sub">${pp.gradesCount
            ? `${pp.subjectPoints} subject point${pp.subjectPoints === 1 ? "" : "s"} across ${pp.gradesCount} graded subject${pp.gradesCount === 1 ? "" : "s"}, plus ${pp.failing ? "a failing core condition (TOK/EE)" : `${pp.corePoints ?? "—"} core point${pp.corePoints === 1 ? "" : "s"} (TOK/EE)`}.`
            : "Add current grades on the Grades page to see your predicted score here."}</p>
        </div>
      </div>`;
  }

  /* Plots the predicted total out of 45, not the average subject grade: /45 is
     the number offers are written in and the one worth watching move.

     Snapshots taken before totals were recorded have no `total` and are left
     out rather than guessed at — reconstructing one needs the subject count
     and core points as they stood that day, which were never stored. */
  function trendChartData() {
    return App.state().gradeSnapshots
      .filter((snap) => typeof snap.total === "number")
      .map((snap) => ({ label: D.fmtShort(snap.date), tipTitle: D.fmtMed(snap.date), value: snap.total }));
  }

  App.pages.university = {
    title: "University",
    render() {
      const s = App.state();
      const entries = App.universityEntries();
      const uniTasks = s.tasks.filter((t) => t.category === "university_application" && !App.isArchived(t));
      const owners = new Set([...s.courses.map((c) => c.id), ...s.applications.map((a) => a.id)]);
      const unlinked = uniTasks.filter((t) => !t.university_course_id || !owners.has(t.university_course_id));
      const empty = !s.courses.length && !s.applications.length;

      /* An application's deadline is listed once, under its name; a course's
         own deadline, exam and interview are listed under the course. */
      const deadlines = [];
      const courseName = (c) => `${c.university_name} — ${c.course_name}`;
      for (const { app, courses } of entries) {
        if (app && app.application_deadline) {
          deadlines.push({ title: app.name, type: `Application deadline · ${courses.length} course${courses.length === 1 ? "" : "s"}`, date: app.application_deadline, icon: "calendar" });
        }
        for (const c of courses) {
          const own = app ? c.own_deadline : c.application_deadline;
          if (own) deadlines.push({ title: courseName(c), type: app ? `Own deadline · ${app.name}` : "Application deadline", date: own, icon: "calendar" });
          if (c.entrance_exam_date) deadlines.push({ title: courseName(c), type: "Entrance exam", date: c.entrance_exam_date, icon: "fileText" });
          if (c.interview_date) deadlines.push({ title: courseName(c), type: "Interview", date: c.interview_date, icon: "clock" });
        }
      }
      deadlines.sort((a, b) => a.date.localeCompare(b.date));

      return `
        <div class="page">
          ${UI.pageHead("University", "Applications, deadlines and admissions tasks",
            `<div class="row wrap" style="gap:8px">
               <button class="btn btn-outline" data-add-app title="UCAS, Common App, or one university's application covering several courses">${App.icon("plus")} Add Application</button>
               <button class="btn btn-primary" data-add-course>${App.icon("plus")} Add Course</button>
             </div>`)}

          ${portalsHTML()}

          ${gaugeHTML()}

          ${empty ? UI.emptyState("building", "No university courses yet", "Track applications, offer conditions, deadlines and materials",
            `<button class="btn btn-outline btn-sm" data-add-course-2>${App.icon("plus")} Add your first course</button>`) : `

            ${deadlines.length ? `
              <div class="card card-pad mb-4">
                <div class="card-title mb-3">Upcoming deadlines</div>
                ${deadlines.map((d) => `
                  <div class="deadline-row ${isPast(d.date) ? "overdue" : ""}">
                    ${App.icon(d.icon)}
                    <div class="dl-main">
                      <div class="dl-title">${esc(d.title)}</div>
                      <div class="dl-type">${d.type}</div>
                    </div>
                    <div>
                      <div class="dl-date">${D.fmtMed(d.date)}</div>
                      ${isPast(d.date) ? `<div class="small" style="color:var(--danger-ink);text-align:right">passed</div>` : `<div class="small muted" style="text-align:right">in ${D.diffDays(D.today(), d.date)}d</div>`}
                    </div>
                  </div>`).join("")}
              </div>` : ""}

            <div class="stack">
              ${entries.map((e) => e.app ? applicationCardHTML(e.app, e.courses, uniTasks) : courseCardHTML(e.courses[0], uniTasks)).join("")}
            </div>

            ${unlinked.length ? `
              <div class="card card-pad mt-4" data-unlinked>
                <div class="row between mb-2">
                  <span class="card-title">Unlinked university tasks</span>
                  <button class="btn btn-ghost btn-sm" data-add-unlinked>${App.icon("plus")} Add task</button>
                </div>
                <div class="stack-sm" style="gap:2px">
                  ${unlinked.map((t) => `
                    <div class="checklist-row ${t.completed ? "done" : ""}" data-linked-task="${esc(t.id)}">
                      <button class="task-check ${t.completed ? "checked" : ""}" style="width:17px;height:17px" data-lt-toggle>${App.icon("check")}</button>
                      <span class="cl-text">${esc(t.title)}</span>
                      ${t.due_date ? `<span class="small ${App.isOverdue(t) ? "chip chip-danger" : "muted"}">${D.fmtShort(t.due_date)}</span>` : ""}
                      <button class="icon-btn danger" data-lt-del title="Delete task">${App.icon("trash")}</button>
                    </div>`).join("")}
                </div>
              </div>` : ""}`}

          ${C.card("grade-trend", "Predicted points", "Your total out of 45 — a point is added each time one of your grades changes")}
        </div>`;
    },

    mount(el) {
      const trend = trendChartData();
      C.mountCard(el, "grade-trend",
        (body) => C.line(body, trend, { minMax: 45, integer: true, valueLabel: "Predicted points", labelEvery: Math.max(1, Math.round(trend.length / 6)), emptyMsg: "Log your grades to see your predicted total move." }),
        { columns: ["Date", "Predicted points"], rows: trend.map((d) => [d.tipTitle, d.value]) });

      // portals
      el.querySelector("[data-portal-add]").addEventListener("click", () => openPortalModal(null));
      el.querySelectorAll("[data-portal-edit]").forEach((b) =>
        b.addEventListener("click", () => {
          const p = App.state().portals.find((x) => x.id === b.dataset.portalEdit);
          if (p) openPortalModal(p);
        }));

      el.querySelector("[data-add-course]").addEventListener("click", () => openCourseModal(null));
      el.querySelector("[data-add-app]").addEventListener("click", () => openApplicationModal(null));
      const add2 = el.querySelector("[data-add-course-2]");
      if (add2) add2.addEventListener("click", () => openCourseModal(null));
      const addUnlinked = el.querySelector("[data-add-unlinked]");
      if (addUnlinked) addUnlinked.addEventListener("click", () => openUniTaskModal(null));

      // linked/unlinked task rows
      el.querySelectorAll("[data-linked-task]").forEach((row) => {
        const id = row.dataset.linkedTask;
        row.querySelector("[data-lt-toggle]").addEventListener("click", () => {
          const t = App.taskById(id);
          const beforeLevel = App.xp.compute().level;
          if (t && !t.completed) App.confetti();
          App.toggleTask(id);
          App.xp.checkLevelUp(beforeLevel);
        });
        row.querySelector("[data-lt-del]").addEventListener("click", async () => {
          const t = App.taskById(id);
          const ok = await UI.confirm({ title: "Delete task?", message: `“${t ? t.title : ""}” will be permanently deleted.` });
          if (ok) App.deleteTask(id);
        });
      });

      // Edit / delete / choice order — per course, on a card of its own or a
      // row inside an application.
      const byId = (id) => App.state().courses.find((c) => c.id === id);
      el.querySelectorAll('[data-cact="edit"]').forEach((b) =>
        b.addEventListener("click", () => openCourseModal(byId(b.dataset.cid))));
      el.querySelectorAll('[data-cact="delete"]').forEach((b) =>
        b.addEventListener("click", async () => {
          const c = byId(b.dataset.cid);
          if (!c) return;
          const ok = await UI.confirm({
            title: "Delete course?",
            message: `${c.university_name} — ${c.course_name} will be removed. Linked tasks stay, but become unlinked.`
              + (c.application_id ? " The application and its shared tracker stay." : ""),
          });
          if (ok) { App.deleteCourse(c.id); App.toast("Course deleted"); }
        }));
      el.querySelectorAll("[data-choice]").forEach((b) =>
        b.addEventListener("click", () => App.moveCourseChoice(b.dataset.cid, Number(b.dataset.choice))));

      el.querySelectorAll("[data-app-edit]").forEach((b) =>
        b.addEventListener("click", () => openApplicationModal(App.applicationById(b.dataset.appEdit))));
      el.querySelectorAll("[data-add-course-to]").forEach((b) =>
        b.addEventListener("click", () => openCourseModal(null, b.dataset.addCourseTo)));
      el.querySelectorAll("[data-link-courses-to]").forEach((b) =>
        b.addEventListener("click", () => openLinkCoursesModal(App.applicationById(b.dataset.linkCoursesTo))));

      /* One wiring for every checklist on the page: tick, remove, add.
         `get` reads the list fresh; `set` writes it back. */
      const wireChecklist = (scope, kind, get, set) => {
        scope.querySelectorAll(`[data-${kind}]`).forEach((b) =>
          b.addEventListener("click", () => {
            const list = [...get()];
            const i = Number(b.getAttribute(`data-${kind}`));
            if (!list[i]) return;
            list[i] = { ...list[i], completed: !list[i].completed };
            set(list);
          }));
        scope.querySelectorAll(`[data-${kind}-del]`).forEach((b) =>
          b.addEventListener("click", () => {
            const i = Number(b.getAttribute(`data-${kind}-del`));
            set(get().filter((_, k) => k !== i));
          }));
        const input = scope.querySelector(`[data-${kind}-new]`);
        const add = () => {
          const v = input.value.trim();
          if (!v) return;
          set([...get(), { item: v, completed: false }]);
        };
        const addBtn = scope.querySelector(`[data-${kind}-add]`);
        if (addBtn) addBtn.addEventListener("click", add);
        if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
      };

      // Each card's tracker and materials belong to its owner: the course on
      // its own, or the application.
      el.querySelectorAll("[data-owner]").forEach((cardEl) => {
        const id = cardEl.dataset.ownerId;
        const isApp = cardEl.dataset.owner === "app";
        const owner = () => (isApp ? App.applicationById(id) : byId(id)) || {};
        const write = (patch) => (isApp ? App.updateApplication(id, patch) : App.updateCourse(id, patch));
        // Only the card's own lists — not the per-course lists nested inside it.
        const body = cardEl.querySelector(":scope > .card-pad.stack");
        wireChecklist(body, "step", () => owner().key_steps || [], (v) => write({ key_steps: v }));
        wireChecklist(body, "mat", () => owner().materials || [], (v) => write({ materials: v }));
        body.querySelector("[data-add-task-for]").addEventListener("click", () => openUniTaskModal(id));
      });

      // The "For this course" list on each course inside an application.
      el.querySelectorAll("[data-course-steps]").forEach((wrap) => {
        const cid = wrap.dataset.courseSteps;
        wireChecklist(wrap, "cstep", () => (byId(cid) || {}).course_steps || [], (v) => App.updateCourse(cid, { course_steps: v }));
        const open = wrap.querySelector("[data-cstep-open]");
        if (open) open.addEventListener("click", () => {
          open.remove();
          wrap.querySelector("[data-cstep-body]").hidden = false;
          wrap.querySelector("[data-cstep-new]").focus();
        });
      });
    },
  };
})();
