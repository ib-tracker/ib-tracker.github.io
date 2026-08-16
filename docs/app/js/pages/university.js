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

  function openCourseModal(course) {
    const f = course || {
      university_name: "", course_name: "", application_deadline: "", entrance_exam_date: "",
      interview_date: "", offer_ib_points: "", hl_total_required: "", requirements: [], links: [],
      status: "not_started", tuition_cny: "", tuition_secondary: "", tuition_currency: "USD", notes: "",
    };
    const ibPoints = [];
    for (let p = 24; p <= 45; p++) ibPoints.push([String(p), p + " points"]);
    UI.openModal({
      title: course ? "Edit Course" : "Add University Course",
      size: "lg",
      body: `
        <div class="form-row">
          <div class="field"><label>University *</label><input class="input" name="university_name" value="${esc(f.university_name)}" placeholder="e.g. Oxford"></div>
          <div class="field"><label>Course *</label><input class="input" name="course_name" value="${esc(f.course_name)}" placeholder="e.g. PPE"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Application deadline</label><input class="input" type="date" name="application_deadline" value="${esc(f.application_deadline)}"></div>
          <div class="field"><label>Status</label>${UI.selectHTML("status", Object.entries(App.UNI_STATUSES).map(([k, v]) => [k, v.label]), f.status)}</div>
        </div>
        <div class="form-row">
          <div class="field"><label>Entrance exam date</label><input class="input" type="date" name="entrance_exam_date" value="${esc(f.entrance_exam_date)}"></div>
          <div class="field"><label>Interview date</label><input class="input" type="date" name="interview_date" value="${esc(f.interview_date)}"></div>
        </div>
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
          <p class="hint mb-2">Course page, application portal, prospectus — anything you keep re-finding.</p>
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
          const requirements = [...reqList.querySelectorAll("[data-req-row]")].map((rowEl) => ({
            subject_name: rowEl.querySelector("[data-req-subject]").value,
            grade: App.clamp(Number(rowEl.querySelector("[data-req-grade]").value) || 0, 0, 7),
          })).filter((r) => r.subject_name && r.grade);
          const payload = {
            university_name: data.university_name.trim(), course_name: data.course_name.trim(),
            application_deadline: data.application_deadline || "", entrance_exam_date: data.entrance_exam_date || "",
            interview_date: data.interview_date || "", status: data.status,
            offer_ib_points: Number(data.offer_ib_points) || 0,
            hl_total_required: App.clamp(Number(data.hl_total_required) || 0, 0, 21),
            requirements,
            links: readLinks(),
            tuition_cny: Number(data.tuition_cny) || 0,
            tuition_secondary: Number(data.tuition_secondary) || 0,
            tuition_currency: data.tuition_currency || "USD",
            notes: data.notes || "",
          };
          if (!course) {
            payload.key_steps = App.defaultKeySteps().map((item) => ({ item, completed: false }));
            payload.materials = App.defaultMaterials().map((item) => ({ item, completed: false }));
          }
          App.saveCourse(course ? course.id : null, payload);
          App.toast(course ? "Course updated" : "Course added");
          handle.close();
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

  function courseCardHTML(course, uniTasks) {
    const status = App.UNI_STATUSES[course.status] || App.UNI_STATUSES.not_started;
    const keySteps = course.key_steps || [];
    const doneSteps = keySteps.filter((k) => k.completed).length;
    const stepPct = keySteps.length ? Math.round((doneSteps / keySteps.length) * 100) : 0;
    const materials = course.materials || [];
    const courseTasks = uniTasks.filter((t) => t.university_course_id === course.id);

    const dateChip = (label, ds, overduePrefix) => {
      if (!ds) return "";
      const late = isPast(ds);
      return `<span class="chip ${late ? "chip-danger" : "chip-plain"}">${App.icon("calendar")} ${label}: ${D.fmtMed(ds)}${late ? " · " + (overduePrefix || "passed") : ""}</span>`;
    };

    return `
      <div class="card" data-course="${esc(course.id)}">
        <div class="card-pad" style="border-bottom:1px solid var(--hairline)">
          <div class="row between" style="align-items:flex-start">
            <div>
              <h3 style="font-size:16px">${esc(course.university_name)}</h3>
              <p class="muted" style="font-size:13px">${esc(course.course_name)}</p>
            </div>
            <div class="row" style="gap:6px">
              <span class="chip ${status.chip}">${esc(status.label)}</span>
              <button class="icon-btn" data-cact="edit" title="Edit course">${App.icon("pencil")}</button>
              <button class="icon-btn danger" data-cact="delete" title="Delete course">${App.icon("trash")}</button>
            </div>
          </div>
          <div class="uni-head-chips">
            ${dateChip("Apply by", course.application_deadline)}
            ${dateChip("Exam", course.entrance_exam_date)}
            ${dateChip("Interview", course.interview_date)}
          </div>
          ${(course.offer_ib_points || course.tuition_cny || course.tuition_secondary) ? `
            <div class="uni-facts">
              ${course.offer_ib_points ? `<span>Offer: <strong>${course.offer_ib_points} pts</strong></span>` : ""}
              ${course.tuition_cny ? `<span>Tuition: <strong>¥${course.tuition_cny.toLocaleString()}/yr</strong></span>` : ""}
              ${course.tuition_secondary ? `<span><strong>${course.tuition_secondary.toLocaleString()} ${esc(course.tuition_currency || "USD")}/yr</strong></span>` : ""}
            </div>` : ""}
          ${requirementBarsHTML(course)}
          ${(course.links || []).length ? `
            <div class="uni-links">
              ${course.links.map((l) => `
                <a class="uni-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">
                  ${App.icon("link")} ${esc(l.label)}
                </a>`).join("")}
            </div>` : ""}
        </div>
        <div class="card-pad stack">
          <div>
            <div class="row between mb-2">
              <span class="section-label" style="margin-bottom:0">Application tracker <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">· tick off, remove, or add your own</span></span>
              <span class="muted small">${doneSteps}/${keySteps.length}</span>
            </div>
            <div class="progress thin mb-3"><span style="width:${stepPct}%"></span></div>
            <div class="stack-sm" style="gap:2px">
              ${keySteps.map((step, i) => `
                <div class="checklist-row ${step.completed ? "done" : ""}">
                  <button class="task-check ${step.completed ? "checked" : ""}" style="width:17px;height:17px" data-step="${i}">${App.icon("check")}</button>
                  <span class="cl-text">${esc(step.item)}</span>
                  <button class="icon-btn danger" data-step-del="${i}" title="Remove">${App.icon("x")}</button>
                </div>`).join("")}
              ${!keySteps.length ? `<p class="muted small">No steps yet</p>` : ""}
            </div>
            <div class="subtask-add">
              <input class="input input-sm" data-step-new placeholder="Add a step…" style="flex:1">
              <button class="btn btn-outline btn-sm" data-step-add>${App.icon("plus")}</button>
            </div>
          </div>
          <div>
            <div class="section-label">Required materials <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">· tick off, remove, or add your own below</span></div>
            <div class="stack-sm" style="gap:2px">
              ${materials.map((m, i) => `
                <div class="checklist-row ${m.completed ? "done" : ""}">
                  <button class="task-check ${m.completed ? "checked" : ""}" style="width:17px;height:17px" data-mat="${i}">${App.icon("check")}</button>
                  <span class="cl-text">${esc(m.item)}</span>
                  <button class="icon-btn danger" data-mat-del="${i}" title="Remove">${App.icon("x")}</button>
                </div>`).join("")}
              ${!materials.length ? `<p class="muted small">No materials added</p>` : ""}
            </div>
            <div class="subtask-add">
              <input class="input input-sm" data-mat-new placeholder="Add material…" style="flex:1">
              <button class="btn btn-outline btn-sm" data-mat-add>${App.icon("plus")}</button>
            </div>
          </div>
          <div>
            <div class="row between mb-2">
              <span class="section-label" style="margin-bottom:0">Linked tasks</span>
              <button class="btn btn-ghost btn-sm" data-add-task-for>${App.icon("plus")} Add task</button>
            </div>
            <div class="stack-sm" style="gap:2px">
              ${courseTasks.map((t) => `
                <div class="checklist-row ${t.completed ? "done" : ""}" data-linked-task="${esc(t.id)}">
                  <button class="task-check ${t.completed ? "checked" : ""}" style="width:17px;height:17px" data-lt-toggle>${App.icon("check")}</button>
                  <span class="cl-text">${esc(t.title)}</span>
                  ${t.due_date ? `<span class="small ${App.isOverdue(t) ? "chip chip-danger" : "muted"}">${D.fmtShort(t.due_date)}</span>` : ""}
                  ${UI.priorityChip(t.priority)}
                  <button class="icon-btn danger" data-lt-del title="Delete task">${App.icon("trash")}</button>
                </div>`).join("")}
              ${!courseTasks.length ? `<p class="muted small">No tasks linked to this course</p>` : ""}
            </div>
          </div>
          ${course.notes ? `
            <div>
              <div class="section-label">Notes</div>
              <p class="small muted" style="white-space:pre-wrap">${esc(course.notes)}</p>
            </div>` : ""}
        </div>
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
      const courses = [...s.courses].sort((a, b) => (a.application_deadline || "9999").localeCompare(b.application_deadline || "9999"));
      const uniTasks = s.tasks.filter((t) => t.category === "university_application" && !App.isArchived(t));
      const unlinked = uniTasks.filter((t) => !t.university_course_id || !courses.some((c) => c.id === t.university_course_id));

      const deadlines = [];
      courses.forEach((c) => {
        if (c.application_deadline) deadlines.push({ c, type: "Application deadline", date: c.application_deadline, icon: "calendar" });
        if (c.entrance_exam_date) deadlines.push({ c, type: "Entrance exam", date: c.entrance_exam_date, icon: "fileText" });
        if (c.interview_date) deadlines.push({ c, type: "Interview", date: c.interview_date, icon: "clock" });
      });
      deadlines.sort((a, b) => a.date.localeCompare(b.date));

      return `
        <div class="page">
          ${UI.pageHead("University", "Applications, deadlines and admissions tasks",
            `<button class="btn btn-primary" data-add-course>${App.icon("plus")} Add Course</button>`)}

          ${portalsHTML()}

          ${gaugeHTML()}

          ${!courses.length ? UI.emptyState("building", "No university courses yet", "Track applications, offer conditions, deadlines and materials",
            `<button class="btn btn-outline btn-sm" data-add-course-2>${App.icon("plus")} Add your first course</button>`) : `

            ${deadlines.length ? `
              <div class="card card-pad mb-4">
                <div class="card-title mb-3">Upcoming deadlines</div>
                ${deadlines.map((d) => `
                  <div class="deadline-row ${isPast(d.date) ? "overdue" : ""}">
                    ${App.icon(d.icon)}
                    <div class="dl-main">
                      <div class="dl-title">${esc(d.c.university_name)} — ${esc(d.c.course_name)}</div>
                      <div class="dl-type">${d.type}</div>
                    </div>
                    <div>
                      <div class="dl-date">${D.fmtMed(d.date)}</div>
                      ${isPast(d.date) ? `<div class="small" style="color:var(--danger-ink);text-align:right">passed</div>` : `<div class="small muted" style="text-align:right">in ${D.diffDays(D.today(), d.date)}d</div>`}
                    </div>
                  </div>`).join("")}
              </div>` : ""}

            <div class="stack">
              ${courses.map((c) => courseCardHTML(c, uniTasks)).join("")}
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

      // per-course interactions
      el.querySelectorAll("[data-course]").forEach((cardEl) => {
        const courseId = cardEl.dataset.course;
        const course = () => App.state().courses.find((c) => c.id === courseId);

        cardEl.querySelector('[data-cact="edit"]').addEventListener("click", () => openCourseModal(course()));
        cardEl.querySelector('[data-cact="delete"]').addEventListener("click", async () => {
          const c = course();
          const ok = await UI.confirm({
            title: "Delete course?",
            message: `${c.university_name} — ${c.course_name} will be removed. Linked tasks stay, but become unlinked.`,
          });
          if (ok) { App.deleteCourse(courseId); App.toast("Course deleted"); }
        });

        cardEl.querySelectorAll("[data-step]").forEach((b) =>
          b.addEventListener("click", () => {
            const c = course();
            const steps = [...(c.key_steps || [])];
            const i = Number(b.dataset.step);
            steps[i] = { ...steps[i], completed: !steps[i].completed };
            App.updateCourse(courseId, { key_steps: steps });
          }));

        // Steps are add/removable, exactly as materials below are. Every course
        // needs a different set: a UK application has no portfolio deadline and
        // a US one has no interview to prepare for.
        cardEl.querySelectorAll("[data-step-del]").forEach((b) =>
          b.addEventListener("click", () => {
            const c = course();
            App.updateCourse(courseId, { key_steps: (c.key_steps || []).filter((_, i) => i !== Number(b.dataset.stepDel)) });
          }));
        const stepInput = cardEl.querySelector("[data-step-new]");
        const stepAdd = () => {
          const v = stepInput.value.trim();
          if (!v) return;
          const c = course();
          App.updateCourse(courseId, { key_steps: [...(c.key_steps || []), { item: v, completed: false }] });
        };
        const stepAddBtn = cardEl.querySelector("[data-step-add]");
        if (stepAddBtn) stepAddBtn.addEventListener("click", stepAdd);
        if (stepInput) stepInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); stepAdd(); }
        });

        cardEl.querySelectorAll("[data-mat]").forEach((b) =>
          b.addEventListener("click", () => {
            const c = course();
            const mats = [...(c.materials || [])];
            const i = Number(b.dataset.mat);
            mats[i] = { ...mats[i], completed: !mats[i].completed };
            App.updateCourse(courseId, { materials: mats });
          }));
        cardEl.querySelectorAll("[data-mat-del]").forEach((b) =>
          b.addEventListener("click", () => {
            const c = course();
            App.updateCourse(courseId, { materials: (c.materials || []).filter((_, i) => i !== Number(b.dataset.matDel)) });
          }));
        const matInput = cardEl.querySelector("[data-mat-new]");
        const matAdd = () => {
          const v = matInput.value.trim();
          if (!v) return;
          const c = course();
          App.updateCourse(courseId, { materials: [...(c.materials || []), { item: v, completed: false }] });
        };
        cardEl.querySelector("[data-mat-add]").addEventListener("click", matAdd);
        matInput.addEventListener("keydown", (e) => { if (e.key === "Enter") matAdd(); });

        cardEl.querySelector("[data-add-task-for]").addEventListener("click", () => openUniTaskModal(courseId));
      });
    },
  };
})();
