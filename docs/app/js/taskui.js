/* taskui.js — shared task components: card, list binding, task modal,
   filter bar with saved views, batch action bar, subtask editor */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = App.ui;
  const D = App.dates;
  const TK = (App.taskui = {});

  /* Which cards have their sub-tasks open. Module-level rather than in the
     store: it is a view preference, not data, and every tick re-renders the
     whole list, so it has to survive a render without being persisted to a
     backup or synced anywhere. */
  const expandedSubs = new Set();

  /* ---------- task card ---------- */
  TK.taskCardHTML = function (task, opts) {
    opts = opts || {};
    const taskMap = opts.taskMap;
    const locked = App.isLocked(task, taskMap);
    const subs = App.subtasksOf(task.id);
    const subsDone = subs.filter((s) => s.completed).length;
    const subsOpen = subs.length > 0 && expandedSubs.has(task.id);
    const timerActive = !!App.state().timer;

    return `
      <div class="task-card ${task.completed ? "done" : ""} ${opts.selected ? "selected" : ""}" data-task-id="${esc(task.id)}">
        ${opts.selectable ? `
          <button class="sel-check ${opts.selected ? "checked" : ""}" data-tact="select" aria-label="Select task">${App.icon("check")}</button>` : ""}
        <button class="task-check ${task.completed ? "checked" : ""} ${locked && !task.completed ? "locked" : ""}"
          data-tact="toggle" aria-label="${task.completed ? "Mark incomplete" : "Mark complete"}"
          ${locked && !task.completed ? `title="Locked — finish its predecessor first"` : ""}>
          ${App.icon("check")}
        </button>
        <div class="t-body">
          <div class="t-top">
            <div style="flex:1;min-width:0">
              <div class="t-title">${esc(task.title)}</div>
              ${task.description ? `<div class="t-desc">${esc(task.description)}</div>` : ""}
            </div>
            <div class="t-actions">
              <button class="icon-btn" data-tact="timer" title="Start timer" ${timerActive ? "disabled" : ""}>${App.icon("play")}</button>
              <button class="icon-btn" data-tact="edit" title="Edit">${App.icon("pencil")}</button>
              <button class="icon-btn danger" data-tact="delete" title="Delete">${App.icon("trash")}</button>
            </div>
          </div>
          <div class="t-meta">
            ${UI.categoryChip(task.category)}
            ${UI.priorityChip(task.priority)}
            ${UI.subjectChip(task.subject_name)}
            ${locked ? `<span class="chip chip-warning">${App.icon("lock")} Locked</span>` : ""}
            ${task.recurring && task.recurring !== "none" ? `<span class="chip chip-plain">${App.icon("repeat")} ${esc(App.RECURRENCE[task.recurring])}</span>` : ""}
            ${UI.dueChip(task)}
            ${task.estimated_minutes > 0 ? `<span class="t-mins">${App.fmtMinutes(task.estimated_minutes)}</span>` : ""}
            ${subs.length ? `
              <button class="t-subprog" data-tact="subs" aria-expanded="${subsOpen}"
                      title="${subsOpen ? "Hide" : "Show"} sub-tasks">
                ${App.icon("checkCircle")} ${subsDone}/${subs.length}
                <span class="tsp-chev ${subsOpen ? "open" : ""}">${App.icon("chevD")}</span>
              </button>` : ""}
          </div>
          ${subsOpen ? `
            <div class="t-subs">
              ${subs.map((st) => `
                <div class="t-sub ${st.completed ? "done" : ""}">
                  <button class="task-check ${st.completed ? "checked" : ""}" data-subtoggle="${esc(st.id)}"
                          aria-label="${st.completed ? "Mark incomplete" : "Mark complete"}: ${esc(st.title)}">${App.icon("check")}</button>
                  <span class="t-sub-title">${esc(st.title)}</span>
                  ${st.estimated_minutes ? `<span class="t-mins">${App.fmtMinutes(st.estimated_minutes)}</span>` : ""}
                </div>`).join("")}
            </div>` : ""}
        </div>
      </div>`;
  };

  // Event delegation for any container of task cards
  TK.bindTaskList = function (container, opts) {
    opts = opts || {};
    container.addEventListener("click", async (e) => {
      // Sub-task checkboxes first: they sit inside the card, so the [data-tact]
      // lookup below would otherwise walk past them to the card's own buttons.
      const subBtn = e.target.closest("[data-subtoggle]");
      if (subBtn) {
        e.stopPropagation();
        App.toggleSubtask(subBtn.dataset.subtoggle);
        return;
      }
      const btn = e.target.closest("[data-tact]");
      if (!btn) return;
      const card = btn.closest("[data-task-id]");
      const id = card && card.dataset.taskId;
      const task = id && App.taskById(id);
      if (!task) return;
      const act = btn.dataset.tact;
      if (act === "toggle") {
        if (!task.completed && App.isLocked(task)) {
          App.toast("Locked — finish its predecessor first", "error");
          return;
        }
        const beforeLevel = App.xp.compute().level;
        const completed = App.toggleTask(id);
        if (completed) { App.confetti(); App.xp.checkLevelUp(beforeLevel); }
      } else if (act === "subs") {
        // Expanding is a read, so it stays available in read-only mode.
        if (expandedSubs.has(id)) expandedSubs.delete(id); else expandedSubs.add(id);
        App.render();
      } else if (act === "edit") {
        TK.openTaskModal(task);
      } else if (act === "delete") {
        const ok = await UI.confirm({ title: "Delete task?", message: `“${task.title}” and its sub-tasks will be permanently deleted.` });
        if (ok) { App.deleteTask(id); App.toast("Task deleted"); }
      } else if (act === "timer") {
        App.timer.start(task.id, task.title, task.estimated_minutes || 0);
      } else if (act === "select" && opts.onSelect) {
        opts.onSelect(id);
      }
    });
  };

  /* ---------- subtask editor (inside task modal) ---------- */
  function subtaskEditorHTML(taskId) {
    const subs = App.subtasksOf(taskId);
    const done = subs.filter((s) => s.completed).length;
    const totalMin = subs.reduce((s, x) => s + (x.estimated_minutes || 0), 0);
    return `
      <div data-subtask-editor>
        ${subs.length ? `
          <div class="row between mb-2" style="font-size:11.5px;color:var(--ink-3)">
            <span>${done}/${subs.length} done</span>
            ${totalMin ? `<span>total ${App.fmtMinutes(totalMin)}</span>` : ""}
          </div>
          <div class="progress thin mb-2"><span class="good" style="width:${subs.length ? Math.round((done / subs.length) * 100) : 0}%"></span></div>` : ""}
        <div data-subtask-rows>
          ${subs.map((st) => `
            <div class="subtask-row ${st.completed ? "done" : ""}" data-subtask-id="${esc(st.id)}" draggable="true">
              <span class="drag-handle">${App.icon("grip")}</span>
              <button class="task-check ${st.completed ? "checked" : ""}" style="width:16px;height:16px" data-stact="toggle">${App.icon("check")}</button>
              <span class="st-title">${esc(st.title)}</span>
              ${st.estimated_minutes ? `<span class="t-mins">${App.fmtMinutes(st.estimated_minutes)}</span>` : ""}
              <button class="icon-btn danger" data-stact="delete" title="Remove">${App.icon("x")}</button>
            </div>`).join("")}
        </div>
        <div class="subtask-add">
          <input class="input input-sm" data-st-new placeholder="Add a sub-task…" style="flex:1">
          <input class="input input-sm" data-st-min type="number" min="0" placeholder="min" style="width:64px">
          <button class="btn btn-outline btn-sm" data-st-add>${App.icon("plus")}</button>
        </div>
      </div>`;
  }

  /* Sub-tasks for a task that does not exist yet.

     App.createSubtask needs a task_id to attach to, and a task being created
     has no id until it is saved. So these are held in the form and created
     immediately afterwards. Until now the whole section was simply hidden on
     create, which meant saving, reopening and editing just to break a task
     into steps. */
  let draftSubs = [];

  function draftSubtaskEditorHTML() {
    const totalMin = draftSubs.reduce((n, x) => n + (x.estimated_minutes || 0), 0);
    return `
      <div data-draft-subtasks>
        ${draftSubs.length ? `
          <div class="row between mb-2" style="font-size:11.5px;color:var(--ink-3)">
            <span>${draftSubs.length} step${draftSubs.length === 1 ? "" : "s"}</span>
            ${totalMin ? `<span>total ${App.fmtMinutes(totalMin)}</span>` : ""}
          </div>` : ""}
        <div>
          ${draftSubs.map((st, i) => `
            <div class="subtask-row">
              <span class="st-title" style="flex:1">${esc(st.title)}</span>
              ${st.estimated_minutes ? `<span class="t-mins">${App.fmtMinutes(st.estimated_minutes)}</span>` : ""}
              <button class="icon-btn danger" data-draft-del="${i}" title="Remove" type="button">${App.icon("x")}</button>
            </div>`).join("")}
        </div>
        <div class="subtask-add">
          <input class="input input-sm" data-draft-new placeholder="Add a sub-task…" style="flex:1">
          <input class="input input-sm" data-draft-min type="number" min="0" placeholder="min" style="width:64px">
          <button class="btn btn-outline btn-sm" data-draft-add type="button">${App.icon("plus")}</button>
        </div>
      </div>`;
  }

  function bindDraftSubtasks(rootEl) {
    const wrap = rootEl.querySelector("[data-draft-subtasks]");
    if (!wrap) return;
    const refresh = () => {
      const holder = wrap.parentElement;
      holder.innerHTML = draftSubtaskEditorHTML();
      bindDraftSubtasks(rootEl);
    };
    const titleEl = wrap.querySelector("[data-draft-new]");
    const minEl = wrap.querySelector("[data-draft-min]");
    const add = () => {
      const title = titleEl.value.trim();
      if (!title) return;
      draftSubs.push({ title, estimated_minutes: parseInt(minEl.value) || 0 });
      refresh();
      const next = rootEl.querySelector("[data-draft-new]");
      if (next) next.focus();
    };
    wrap.querySelector("[data-draft-add]").addEventListener("click", add);
    titleEl.addEventListener("keydown", (e) => {
      // Enter adds a step rather than submitting the half-filled task form.
      if (e.key === "Enter") { e.preventDefault(); add(); }
    });
    wrap.querySelectorAll("[data-draft-del]").forEach((b) =>
      b.addEventListener("click", () => { draftSubs.splice(Number(b.dataset.draftDel), 1); refresh(); }));
  }

  function bindSubtaskEditor(rootEl, taskId) {
    const ed = rootEl.querySelector("[data-subtask-editor]");
    if (!ed) return;

    const refresh = () => {
      const wrap = ed.parentElement;
      wrap.innerHTML = subtaskEditorHTML(taskId);
      bindSubtaskEditor(rootEl, taskId);
    };

    const addInput = ed.querySelector("[data-st-new]");
    const minInput = ed.querySelector("[data-st-min]");
    const add = () => {
      const title = addInput.value.trim();
      if (!title) return;
      App.createSubtask(taskId, title, parseInt(minInput.value) || 0);
      refresh();
      const ni = rootEl.querySelector("[data-st-new]");
      if (ni) ni.focus();
    };
    ed.querySelector("[data-st-add]").addEventListener("click", add);
    addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });

    ed.querySelectorAll("[data-subtask-id]").forEach((row) => {
      const stId = row.dataset.subtaskId;
      row.querySelector('[data-stact="toggle"]').addEventListener("click", () => { App.toggleSubtask(stId); refresh(); });
      row.querySelector('[data-stact="delete"]').addEventListener("click", () => { App.deleteSubtask(stId); refresh(); });
      row.addEventListener("dragstart", (e) => {
        e.dataTransfer.effectAllowed = "move";
        row.classList.add("dragging");
      });
      row.addEventListener("dragend", () => row.classList.remove("dragging"));
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        const dragging = ed.querySelector(".subtask-row.dragging");
        if (!dragging || dragging === row) return;
        const rows = [...ed.querySelectorAll(".subtask-row")];
        const from = rows.indexOf(dragging), to = rows.indexOf(row);
        if (from < to) row.after(dragging); else row.before(dragging);
      });
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        const ids = [...ed.querySelectorAll(".subtask-row")].map((r) => r.dataset.subtaskId);
        App.reorderSubtasks(taskId, ids);
      });
    });
  }

  /* ---------- task create/edit modal ---------- */
  TK.openTaskModal = function (task, defaults) {
    const isEdit = !!task;
    // Fresh every time the form opens, so steps typed into an abandoned task
    // don't reappear on the next one.
    draftSubs = [];
    const f = Object.assign({
      title: "", description: "", category: "subject_task", subject_name: "",
      university_course_id: "",
      due_date: "", priority: "medium", estimated_minutes: "", recurring: "none",
      predecessor_id: "",
    }, defaults || {}, task || {});
    // the advanced block (recurrence, predecessor) stays hidden until
    // asked for — but opens automatically when editing a task that already uses it
    const advOpen = !!(isEdit && ((f.recurring && f.recurring !== "none") || f.predecessor_id));
    const allTasks = App.sortedTasks().filter((t) => (!task || t.id !== task.id) && !App.isArchived(t));
    const templates = App.state().templates;
    const courses = App.state().courses;
    const isUni = f.category === "university_application";

    const defaultTplId = (defaults || {}).__templateId || "";
    const body = `
      <form data-task-form>
        ${!isEdit && templates.length ? `
          <div class="field">
            <label>Start from a template</label>
            ${UI.selectHTML("__template", [["", "Blank task…"], ...templates.map((t) => [t.id, t.name])], defaultTplId)}
            <p class="hint">A template fills in the details and sub-tasks below — the task name is yours to write.</p>
          </div>
          <hr class="divider">` : ""}
        <div class="field">
          <label>Title *</label>
          <input class="input" name="title" value="${esc(f.title)}" placeholder="What needs to be done?" required>
        </div>
        <div class="field">
          <label>Description</label>
          <textarea class="textarea" name="description" rows="2" placeholder="Optional details…">${esc(f.description)}</textarea>
        </div>
        <div class="form-row">
          <div class="field">
            <label>Category</label>
            ${UI.selectHTML("category", UI.categoryOptions(), f.category)}
          </div>
          <div class="field">
            <label>Priority</label>
            ${UI.selectHTML("priority", UI.priorityOptions(), f.priority)}
          </div>
        </div>
        ${/* A university task belongs to a course, not a subject. Both fields
              are rendered and one is hidden, rather than re-rendering the form
              on every category change, so anything half-typed elsewhere in the
              form survives switching category by accident. */""}
        <div class="field" data-subject-field ${isUni ? "hidden" : ""}>
          <label>Subject</label>
          ${UI.selectHTML("subject_name", UI.subjectOptions(f.subject_name, true), f.subject_name)}
        </div>
        <div class="field" data-course-field ${isUni ? "" : "hidden"}>
          <label>University course</label>
          ${courses.length
            ? UI.selectHTML("university_course_id",
                [["", "Not tied to a course"], ...courses.map((c) => [c.id, `${c.university_name} — ${c.course_name}`])],
                f.university_course_id)
            : `<p class="hint" style="margin:0">No university courses yet. Add one on the University page and it'll show up here.</p>`}
        </div>
        <div class="form-row">
          <div class="field">
            <label>Due date</label>
            <input class="input" type="date" name="due_date" value="${esc(f.due_date)}">
          </div>
          <div class="field">
            <label>Estimated time (min)</label>
            <input class="input" type="number" name="estimated_minutes" min="0" value="${f.estimated_minutes || ""}">
          </div>
        </div>
        <button type="button" class="adv-toggle" data-adv-toggle aria-expanded="${advOpen ? "true" : "false"}">
          ${App.icon("chevD")}<span>${advOpen ? "Fewer options" : "More options"}</span>
        </button>
        <div data-advanced ${advOpen ? "" : "hidden"}>
          <div class="form-row">
            <div class="field">
              <label>Recurrence</label>
              ${UI.selectHTML("recurring", Object.entries(App.RECURRENCE), f.recurring)}
            </div>
            <div class="field">
              <label>Predecessor task</label>
              ${UI.selectHTML("predecessor_id", [["", "None"], ...allTasks.filter((t) => !t.completed).map((t) => [t.id, t.title])], f.predecessor_id)}
            </div>
          </div>
          <p class="hint" style="font-size:11.5px;color:var(--ink-3);margin:-6px 0 12px">A task with a predecessor is locked until the predecessor is completed; the auto-scheduler places it afterwards.</p>
        </div>

        <hr class="divider">
        <div class="field">
          <label>Sub-tasks</label>
          <div>${isEdit ? subtaskEditorHTML(task.id) : draftSubtaskEditorHTML()}</div>
        </div>
      </form>`;

    UI.openModal({
      title: isEdit ? "Edit Task" : "New Task",
      size: "lg",
      body,
      foot: `
        <button class="btn btn-outline" data-close>Cancel</button>
        <button class="btn btn-primary" data-save>${isEdit ? "Save Changes" : "Create Task"}</button>`,
      onMount(el, handle) {
        const form = el.querySelector("[data-task-form]");
        if (isEdit) bindSubtaskEditor(el, task.id);
        else bindDraftSubtasks(el);

        // "More options" disclosure for recurrence / predecessor
        const advToggle = form.querySelector("[data-adv-toggle]");
        const adv = form.querySelector("[data-advanced]");
        const syncAdv = () => {
          const open = !adv.hidden;
          advToggle.setAttribute("aria-expanded", open ? "true" : "false");
          advToggle.querySelector("span").textContent = open ? "Fewer options" : "More options";
          const svg = advToggle.querySelector("svg");
          if (svg) svg.style.transform = open ? "rotate(180deg)" : "";
        };
        if (advToggle && adv) {
          syncAdv();
          advToggle.addEventListener("click", () => { adv.hidden = !adv.hidden; syncAdv(); });
        }

        /* Swap Subject <-> University course as the category changes, so the
           second field always asks the question that makes sense for what this
           task actually is. */
        const catSel = form.querySelector('[name="category"]');
        const subjField = form.querySelector("[data-subject-field]");
        const courseField = form.querySelector("[data-course-field]");
        const syncCategoryField = () => {
          const uni = catSel.value === "university_application";
          if (subjField) subjField.hidden = uni;
          if (courseField) courseField.hidden = !uni;
        };
        if (catSel) catSel.addEventListener("change", syncCategoryField);

        // Templates prefill everything except the title — the task keeps its own name.
        const tplSel = form.querySelector('[name="__template"]');
        if (tplSel) {
          tplSel.addEventListener("change", () => {
            const tpl = App.state().templates.find((t) => t.id === tplSel.value);
            if (!tpl) return;
            form.querySelector('[name="category"]').value = tpl.category || "subject_task";
            form.querySelector('[name="priority"]').value = tpl.priority || "medium";
            form.querySelector('[name="subject_name"]').value = tpl.subject_name || "";
            if (tpl.estimated_minutes) form.querySelector('[name="estimated_minutes"]').value = tpl.estimated_minutes;
          });
        }

        el.querySelector("[data-save]").addEventListener("click", () => {
          const data = UI.readForm(form);
          if (!String(data.title || "").trim()) {
            App.toast("A title is required", "error");
            form.querySelector('[name="title"]').focus();
            return;
          }
          const patch = {
            title: String(data.title).trim(),
            description: data.description || "",
            category: data.category,
            priority: data.priority,
            /* Only one of these can be meaningful at a time, and the other is
               cleared rather than left behind: a task that used to be filed
               under Physics and is now a Cambridge application should not
               still be counted in Physics' totals. */
            subject_name: data.category === "university_application" ? "" : (data.subject_name || ""),
            university_course_id: data.category === "university_application" ? (data.university_course_id || "") : "",
            due_date: data.due_date || "",
            estimated_minutes: Number(data.estimated_minutes) || 0,
            recurring: data.recurring || "none",
            predecessor_id: data.predecessor_id || "",
          };
          if (patch.predecessor_id && task && patch.predecessor_id === task.id) patch.predecessor_id = "";

          if (isEdit) {
            App.updateTask(task.id, patch);
            App.toast("Task updated");
          } else {
            const tplId = tplSel && tplSel.value;
            if (tplId) {
              const tpl = App.state().templates.find((t) => t.id === tplId);
              const created = App.createTask(patch);
              (tpl && tpl.sub_tasks || []).forEach((st) => App.createSubtask(created.id, st.title, st.estimated_minutes));
              draftSubs.forEach((st) => App.createSubtask(created.id, st.title, st.estimated_minutes));
            } else {
              const created = App.createTask(patch);
              // Only now does a task_id exist to hang them on.
              if (created) draftSubs.forEach((st) => App.createSubtask(created.id, st.title, st.estimated_minutes));
            }
            App.toast("Task created");
          }
          handle.close();
        });
      },
    });
  };

  /* ---------- filter bar (with saved views that can be deleted) ---------- */
  TK.filterBarHTML = function (filters, opts) {
    opts = opts || {};
    const subjects = App.state().subjects;
    const savedViews = App.state().savedFilters;
    const hasFilters = Object.values(filters).some((v) => v && v !== "all");
    return `
      <div class="filter-bar" data-filter-bar>
        <span style="color:var(--ink-3);display:flex">${App.icon("filter")}</span>
        ${UI.selectHTML("f_category", [["all", "All categories"], ...UI.categoryOptions()], filters.category || "all")}
        ${UI.selectHTML("f_priority", [["all", "All priorities"], ...UI.priorityOptions()], filters.priority || "all")}
        ${opts.showCompleted !== false ? UI.selectHTML("f_completed", [["all", "Any status"], ["incomplete", "Incomplete"], ["done", "Done"]], filters.completed || "all") : ""}
        ${UI.selectHTML("f_subject", [["all", "All subjects"], ...subjects.map((s) => [s.name, s.name])], filters.subject_name || "all")}
        ${hasFilters ? `<button class="btn btn-ghost btn-sm" data-clear-filters>${App.icon("x")} Clear</button>` : ""}
        <span class="spacer"></span>
        ${/* Only offered once something is actually filtered. Saving "all
             categories, all priorities, all subjects" is saving nothing, and a
             button that is always there invites exactly that. */""}
        ${hasFilters ? `
          <button class="btn btn-ghost btn-sm" data-save-view
                  title="Save these filters under a name so you can come back to them">
            ${App.icon("save")} Save these filters
          </button>` : ""}
        ${savedViews.length ? `
          <div class="pop-anchor">
            <button class="btn btn-outline btn-sm" data-popover-trigger data-views-btn
                    title="Your saved filter combinations">${App.icon("filter")} Saved filters (${savedViews.length})</button>
          </div>` : ""}
      </div>`;
  };

  TK.bindFilterBar = function (container, filters, onChange) {
    const bar = container.querySelector("[data-filter-bar]");
    if (!bar) return;
    const map = { f_category: "category", f_priority: "priority", f_completed: "completed", f_subject: "subject_name" };
    bar.querySelectorAll("select").forEach((sel) => {
      sel.addEventListener("change", () => {
        filters[map[sel.name]] = sel.value;
        onChange();
      });
    });
    const clear = bar.querySelector("[data-clear-filters]");
    if (clear) clear.addEventListener("click", () => {
      Object.keys(filters).forEach((k) => delete filters[k]);
      onChange();
    });
    const saveViewBtn = bar.querySelector("[data-save-view]");
    if (saveViewBtn) saveViewBtn.addEventListener("click", () => {
      // Spell out what is being saved. "View" meant nothing to anyone who
      // hadn't already worked out that it stores the filter row above.
      const summary = [
        filters.category && filters.category !== "all" ? filters.category : null,
        filters.priority && filters.priority !== "all" ? filters.priority + " priority" : null,
        filters.subject_name && filters.subject_name !== "all" ? filters.subject_name : null,
        filters.completed && filters.completed !== "all" ? filters.completed : null,
      ].filter(Boolean).join(" · ");

      UI.openModal({
        title: "Save these filters",
        size: "sm",
        body: `
          <p class="muted small mb-3" style="line-height:1.5">
            Saves the filters you've just set, so you can switch back to them in
            one click from <strong>Saved filters</strong>.
          </p>
          ${summary ? `<p class="small mb-3"><strong>Saving:</strong> ${esc(summary)}</p>` : ""}
          <div class="field">
            <label>Call it</label>
            <input class="input" data-view-name placeholder="e.g. High-priority IAs">
          </div>`,
        foot: `<button class="btn btn-outline" data-close>Cancel</button>
               <button class="btn btn-primary" data-save>Save</button>`,
        onMount(el, handle) {
          const input = el.querySelector("[data-view-name]");
          const save = () => {
            const name = input.value.trim();
            if (!name) return;
            App.saveFilterView(name, filters);
            App.toast("View saved");
            handle.close();
          };
          el.querySelector("[data-save]").addEventListener("click", save);
          input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
        },
      });
    });
    const viewsBtn = bar.querySelector("[data-views-btn]");
    if (viewsBtn) viewsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const views = App.state().savedFilters;
      const html = `
        <div class="pop-title">Saved views</div>
        ${views.map((v) => `
          <div class="pop-item row between" data-view-id="${esc(v.id)}">
            <button data-load-view style="flex:1;text-align:left;font-size:12px;font-weight:550">${esc(v.name)}</button>
            <button class="icon-btn danger" data-del-view style="width:22px;height:22px">${App.icon("trash")}</button>
          </div>`).join("")}`;
      UI.togglePopover(viewsBtn, html);
      const pop = document.querySelector(".popover");
      if (!pop) return;
      pop.querySelectorAll("[data-view-id]").forEach((row) => {
        const view = views.find((v) => v.id === row.dataset.viewId);
        row.querySelector("[data-load-view]").addEventListener("click", () => {
          Object.keys(filters).forEach((k) => delete filters[k]);
          Object.assign(filters, view.filters || {});
          UI.closePopovers();
          onChange();
        });
        row.querySelector("[data-del-view]").addEventListener("click", (ev) => {
          ev.stopPropagation();
          App.deleteFilterView(row.dataset.viewId);
          UI.closePopovers();
          onChange();
        });
      });
    });
  };

  /* ---------- batch action bar ---------- */
  TK.batchBarHTML = function (selected) {
    if (!selected.size) return "";
    return `
      <div class="batch-bar" data-batch-bar>
        <span class="count">${selected.size} selected</span>
        <button class="btn btn-outline btn-sm" data-bact="reschedule">${App.icon("calendar")} Reschedule</button>
        <button class="btn btn-outline btn-sm" data-bact="priority">${App.icon("flag")} Priority</button>
        <button class="btn btn-outline btn-sm" data-bact="category">${App.icon("tag")} Category</button>
        <button class="btn btn-outline btn-sm" data-bact="complete">${App.icon("checkCircle")} Complete</button>
        <button class="btn btn-danger btn-sm" data-bact="delete">${App.icon("trash")} Delete</button>
        <button class="icon-btn" data-bact="clear" title="Clear selection">${App.icon("x")}</button>
      </div>`;
  };

  TK.bindBatchBar = function (container, selected, onDone) {
    const bar = container.querySelector("[data-batch-bar]");
    if (!bar) return;
    bar.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-bact]");
      if (!btn) return;
      const act = btn.dataset.bact;
      const ids = [...selected];
      if (act === "clear") { selected.clear(); onDone(); return; }
      if (act === "complete") {
        const beforeLevel = App.xp.compute().level;
        const written = App.update((s) => {
          const nowISO = new Date().toISOString();
          s.tasks.forEach((t) => {
            if (selected.has(t.id) && !t.completed) {
              t.completed = true; t.completed_at = nowISO; t.progress = 100; t.updated_at = nowISO;
            }
          });
        });
        if (written === false) return; // read-only — App.update already explained why
        App.confetti();
        App.sfx("task"); // this path writes the tasks directly, so it isn't covered by App.toggleTask
        App.xp.checkLevelUp(beforeLevel);
        App.toast(`${ids.length} task${ids.length > 1 ? "s" : ""} completed`);
        selected.clear();
        onDone();
        return;
      }
      if (act === "delete") {
        const ok = await UI.confirm({ title: `Delete ${ids.length} task${ids.length > 1 ? "s" : ""}?`, message: "All selected tasks and their sub-tasks will be permanently deleted." });
        if (!ok) return;
        ids.forEach((id) => App.deleteTask(id));
        App.toast("Tasks deleted");
        selected.clear();
        onDone();
        return;
      }
      // value-based actions in a small modal
      const config = {
        reschedule: { title: "Reschedule tasks", field: `<input class="input" type="date" data-batch-val>` },
        priority: { title: "Set priority", field: UI.selectHTML("", UI.priorityOptions(), "medium").replace("<select", '<select data-batch-val') },
        category: { title: "Set category", field: UI.selectHTML("", UI.categoryOptions(), "subject_task").replace("<select", '<select data-batch-val') },
      }[act];
      UI.openModal({
        title: config.title,
        size: "sm",
        body: `<div class="field"><label>Apply to ${ids.length} task${ids.length > 1 ? "s" : ""}</label>${config.field}</div>`,
        foot: `<button class="btn btn-outline" data-close>Cancel</button>
               <button class="btn btn-primary" data-apply>Apply</button>`,
        onMount(el, handle) {
          el.querySelector("[data-apply]").addEventListener("click", () => {
            const val = el.querySelector("[data-batch-val]").value;
            if (!val) return;
            App.update((s) => {
              s.tasks.forEach((t) => {
                if (!selected.has(t.id)) return;
                if (act === "reschedule") t.due_date = val;
                if (act === "priority") t.priority = val;
                if (act === "category") t.category = val;
                t.updated_at = new Date().toISOString();
              });
            });
            App.toast("Updated");
            selected.clear();
            handle.close();
            onDone();
          });
        },
      });
    });
  };
})();
