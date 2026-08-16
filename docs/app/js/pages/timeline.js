/* pages/timeline.js — all incomplete tasks sorted by due date, with filters + batch actions */
(function () {
  "use strict";
  const App = window.App;
  const UI = App.ui;
  const TK = App.taskui;

  const filters = {};
  const selected = new Set();

  App.pages.timeline = {
    title: "Timeline",
    render() {
      const taskMap = App.taskMap();
      let tasks = App.applyTaskFilters(App.sortedTasks().filter((t) => !t.completed), filters);
      tasks = tasks.sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.localeCompare(b.due_date);
      });

      // within each section, unlocked tasks first; locked/blocked sink down
      const overdue = App.displayOrder(tasks.filter((t) => App.isOverdue(t)), taskMap);
      const today = App.displayOrder(tasks.filter((t) => App.isDueToday(t)), taskMap);
      const upcoming = App.displayOrder(tasks.filter((t) => !App.isOverdue(t) && !App.isDueToday(t)), taskMap);

      const section = (label, items, chipCls) => {
        if (!items.length) return "";
        return `
          <div>
            <span class="chip ${chipCls}" style="margin-bottom:10px">${label} · ${items.length}</span>
            <div class="task-list" style="margin-top:8px">
              ${items.map((t) => TK.taskCardHTML(t, { taskMap, selectable: true, selected: selected.has(t.id) })).join("")}
            </div>
          </div>`;
      };

      return `
        <div class="page">
          ${UI.pageHead("Timeline", "All open tasks sorted by due date",
            `<button class="btn btn-primary" data-add-task>${App.icon("plus")} Add Task</button>`)}
          ${TK.filterBarHTML(filters, { showCompleted: false })}
          <div class="stack" data-task-region>
            ${section("Overdue", overdue, "chip-danger")}
            ${section("Today", today, "chip-warning")}
            ${section("Upcoming", upcoming, "chip-accent")}
            ${!tasks.length ? UI.emptyState("checkCircle", "No open tasks", "Everything is done — or nothing matches your filters",
              `<button class="btn btn-outline btn-sm" data-add-task>${App.icon("plus")} Add a task</button>`) : ""}
          </div>
          ${TK.batchBarHTML(selected)}
        </div>`;
    },
    mount(el) {
      // querySelectorAll: there are two of these now, the header one and the
      // one in the empty state, and querySelector would leave the second dead.
      el.querySelectorAll("[data-add-task]").forEach((b) =>
        b.addEventListener("click", () => TK.openTaskModal(null)));
      TK.bindFilterBar(el, filters, () => { selected.clear(); App.render(); });
      TK.bindTaskList(el.querySelector("[data-task-region]"), {
        onSelect(id) {
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          App.render();
        },
      });
      TK.bindBatchBar(el, selected, () => App.render());
    },
  };
})();
