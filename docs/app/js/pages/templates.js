/* pages/templates.js — reusable task structures with sub-tasks */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = App.ui;

  function openTemplateModal(tpl) {
    const f = tpl || { name: "", category: "subject_task", subject_name: "", priority: "medium", estimated_minutes: "", sub_tasks: [] };
    let subTasks = (f.sub_tasks || []).map((s) => ({ title: s.title || "", estimated_minutes: s.estimated_minutes || 0 }));

    const subRowsHTML = () => subTasks.map((st, i) => `
      <div class="row mb-2" style="gap:7px" data-tpl-sub="${i}">
        <input class="input input-sm" data-sub-title value="${esc(st.title)}" placeholder="Sub-task title" style="flex:1">
        <input class="input input-sm" data-sub-min type="number" min="0" value="${st.estimated_minutes || ""}" placeholder="min" style="width:64px">
        <button class="icon-btn danger" data-sub-del title="Remove">${App.icon("x")}</button>
      </div>`).join("");

    UI.openModal({
      title: tpl ? "Edit Template" : "New Template",
      size: "lg",
      body: `
        <div class="field"><label>Template name *</label><input class="input" name="name" value="${esc(f.name)}" placeholder="e.g. Past paper session"></div>
        <div class="form-row">
          <div class="field"><label>Category</label>${UI.selectHTML("category", UI.categoryOptions(), f.category)}</div>
          <div class="field"><label>Priority</label>${UI.selectHTML("priority", UI.priorityOptions(), f.priority)}</div>
        </div>
        <div class="form-row">
          <div class="field"><label>Subject</label>${UI.selectHTML("subject_name", UI.subjectOptions(f.subject_name, true), f.subject_name)}</div>
          <div class="field"><label>Estimated time (min)</label><input class="input" type="number" name="estimated_minutes" min="0" value="${f.estimated_minutes || ""}"></div>
        </div>
        <div class="field">
          <div class="row between mb-2">
            <label style="margin-bottom:0">Sub-tasks</label>
            <button class="btn btn-ghost btn-sm" data-sub-add>${App.icon("plus")} Add</button>
          </div>
          <div data-sub-rows>${subRowsHTML()}</div>
        </div>`,
      foot: `<button class="btn btn-outline" data-close>Cancel</button>
             <button class="btn btn-primary" data-save>${tpl ? "Update" : "Create"}</button>`,
      onMount(el, handle) {
        const rows = el.querySelector("[data-sub-rows]");
        const readSubs = () => {
          subTasks = [...rows.querySelectorAll("[data-tpl-sub]")].map((r) => ({
            title: r.querySelector("[data-sub-title]").value,
            estimated_minutes: parseInt(r.querySelector("[data-sub-min]").value) || 0,
          }));
        };
        const rebind = () => {
          rows.querySelectorAll("[data-sub-del]").forEach((b, i) =>
            b.addEventListener("click", () => {
              readSubs();
              subTasks.splice(i, 1);
              rows.innerHTML = subRowsHTML();
              rebind();
            }));
        };
        rebind();
        el.querySelector("[data-sub-add]").addEventListener("click", () => {
          readSubs();
          subTasks.push({ title: "", estimated_minutes: 0 });
          rows.innerHTML = subRowsHTML();
          rebind();
          const inputs = rows.querySelectorAll("[data-sub-title]");
          if (inputs.length) inputs[inputs.length - 1].focus();
        });
        el.querySelector("[data-save]").addEventListener("click", () => {
          const data = UI.readForm(el);
          if (!String(data.name || "").trim()) { App.toast("A name is required", "error"); return; }
          readSubs();
          App.saveTemplate(tpl ? tpl.id : null, {
            name: data.name.trim(), category: data.category, priority: data.priority,
            subject_name: data.subject_name || "",
            estimated_minutes: Number(data.estimated_minutes) || 0,
            sub_tasks: subTasks.filter((s) => s.title.trim()),
          });
          App.toast(tpl ? "Template updated" : "Template created");
          handle.close();
        });
      },
    });
  }

  App.pages.templates = {
    title: "Templates",
    render() {
      const templates = App.state().templates;
      return `
        <div class="page">
          ${UI.pageHead("Templates", "Reusable task structures — one click creates the task with its sub-tasks",
            `<button class="btn btn-primary" data-add-tpl>${App.icon("plus")} Create Template</button>`)}
          ${templates.length ? `
            <div class="tpl-grid">
              ${templates.map((t) => `
                <div class="card tpl-card" data-tpl="${esc(t.id)}">
                  <div class="row between" style="align-items:flex-start">
                    <div class="tpl-name">${esc(t.name)}</div>
                    <div class="t-actions">
                      <button class="icon-btn" data-tpl-use title="Use template">${App.icon("copy")}</button>
                      <button class="icon-btn" data-tpl-edit title="Edit">${App.icon("pencil")}</button>
                      <button class="icon-btn danger" data-tpl-del title="Delete">${App.icon("trash")}</button>
                    </div>
                  </div>
                  <div class="row wrap mt-2" style="gap:5px">
                    ${UI.categoryChip(t.category)}
                    ${UI.priorityChip(t.priority)}
                    ${UI.subjectChip(t.subject_name)}
                  </div>
                  <div class="row mt-3 muted small" style="gap:14px">
                    ${t.estimated_minutes ? `<span>${App.fmtMinutes(t.estimated_minutes)}</span>` : ""}
                    ${(t.sub_tasks || []).length ? `<span>${t.sub_tasks.length} sub-task${t.sub_tasks.length > 1 ? "s" : ""}</span>` : ""}
                  </div>
                  <button class="btn btn-outline btn-sm btn-block mt-3" data-tpl-use>${App.icon("copy")} Use template</button>
                </div>`).join("")}
            </div>` :
            UI.emptyState("template", "No templates yet", "Templates let you spin up recurring task structures — like a past-paper routine — in one click",
              `<button class="btn btn-outline btn-sm" data-add-tpl-2>${App.icon("plus")} Create your first template</button>`)}
        </div>`;
    },
    mount(el) {
      el.querySelector("[data-add-tpl]").addEventListener("click", () => openTemplateModal(null));
      const add2 = el.querySelector("[data-add-tpl-2]");
      if (add2) add2.addEventListener("click", () => openTemplateModal(null));
      el.querySelectorAll("[data-tpl]").forEach((card) => {
        const id = card.dataset.tpl;
        const tpl = () => App.state().templates.find((t) => t.id === id);
        card.querySelectorAll("[data-tpl-use]").forEach((b) =>
          b.addEventListener("click", () => {
            // open the New Task form prefilled from the template — the student
            // names the task; the template only supplies the structure
            const t = tpl();
            App.taskui.openTaskModal(null, {
              category: t.category || "subject_task",
              priority: t.priority || "medium",
              subject_name: t.subject_name || "",
              estimated_minutes: t.estimated_minutes || "",
              __templateId: t.id,
            });
          }));
        card.querySelector("[data-tpl-edit]").addEventListener("click", () => openTemplateModal(tpl()));
        card.querySelector("[data-tpl-del]").addEventListener("click", async () => {
          const ok = await UI.confirm({ title: "Delete template?", message: `“${tpl().name}” will be removed. Tasks already created from it are unaffected.` });
          if (ok) { App.deleteTemplate(id); App.toast("Template deleted"); }
        });
      });
    },
  };
})();
