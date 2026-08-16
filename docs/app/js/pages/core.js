/* pages/core.js — TOK / EE / CAS progress */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = App.ui;
  const TK = App.taskui;

  // `short` exists for buttons and chips. "Add a Extended Essay task" was both
  // ungrammatical and too wide for the button it sat in; every one of these has
  // an abbreviation every IB student already uses.
  const CORE = [
    { key: "tok", label: "Theory of Knowledge", short: "TOK" },
    { key: "extended_essay", label: "Extended Essay", short: "EE" },
    { key: "cas", label: "CAS", short: "CAS" },
  ];

  App.pages.core = {
    title: "Core Requirements",
    render() {
      const taskMap = App.taskMap();
      const tasks = App.sortedTasks().filter((t) => !App.isArchived(t));

      const sections = CORE.map((c) => {
        const items = App.displayOrder(tasks.filter((t) => t.category === c.key), taskMap);
        const done = items.filter((t) => t.completed).length;
        return { ...c, items, done, pct: items.length ? Math.round((done / items.length) * 100) : 0 };
      });

      return `
        <div class="page">
          ${UI.pageHead("Core Requirements", "TOK, Extended Essay & CAS progress",
            `<button class="btn btn-primary" data-add-task>${App.icon("plus")} Add Task</button>`)}
          <div class="stack" data-task-region>
            ${sections.map((sec) => `
              <div>
                <div class="row between mb-2">
                  <div class="section-label" style="margin-bottom:0">${esc(sec.label)}</div>
                  <span class="muted small">${sec.done}/${sec.items.length} completed</span>
                </div>
                ${sec.items.length ? `<div class="progress thin mb-3"><span style="width:${sec.pct}%"></span></div>` : ""}
                ${sec.items.length
                  ? `<div class="task-list">${sec.items.map((t) => TK.taskCardHTML(t, { taskMap })).join("")}</div>`
                  : `<div class="empty empty-inline">
                       <span>Nothing tracked yet</span>
                       <button class="btn btn-outline btn-sm" data-add-core-task="${esc(sec.key)}">
                         ${App.icon("plus")} Add ${esc(sec.short)} task
                       </button>
                     </div>`}
              </div>`).join("")}
          </div>
        </div>`;
    },
    mount(el) {
      el.querySelector("[data-add-task]").addEventListener("click", () => TK.openTaskModal(null, { category: "tok" }));
      // Each empty section offers its own kind, pre-set — the point of being
      // on this page is that TOK, the EE and CAS are tracked separately.
      el.querySelectorAll("[data-add-core-task]").forEach((b) =>
        b.addEventListener("click", () => TK.openTaskModal(null, { category: b.dataset.addCoreTask })));
      TK.bindTaskList(el.querySelector("[data-task-region]"));
    },
  };
})();
