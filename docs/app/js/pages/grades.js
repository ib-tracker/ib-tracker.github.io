/* pages/grades.js — subject grades, IB points estimate, TOK/EE core points matrix */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = App.ui;
  const D = App.dates;

  function openGradeModal(grade) {
    const f = grade || { subject_name: "", current_grade: "", target_grade: "", notes: "" };
    UI.openModal({
      title: grade ? "Edit Grade" : "Add Subject Grade",
      size: "sm",
      body: `
        <div class="field">
          <label>Subject</label>
          ${UI.selectHTML("subject_name", UI.subjectOptions(f.subject_name, false), f.subject_name)}
          <p class="hint">Subjects are managed in Settings.</p>
        </div>
        <div class="form-row">
          <div class="field"><label>Current grade (1–7)</label><input class="input" type="number" name="current_grade" min="1" max="7" value="${f.current_grade || ""}"></div>
          <div class="field"><label>Target grade (1–7)</label><input class="input" type="number" name="target_grade" min="1" max="7" value="${f.target_grade || ""}"></div>
        </div>
        <div class="field"><label>Notes</label><textarea class="textarea" name="notes" rows="2">${esc(f.notes || "")}</textarea></div>`,
      foot: `<button class="btn btn-outline" data-close>Cancel</button>
             <button class="btn btn-primary" data-save>${grade ? "Update" : "Add"}</button>`,
      onMount(el, handle) {
        el.querySelector("[data-save]").addEventListener("click", () => {
          const data = UI.readForm(el);
          if (!data.subject_name) { App.toast("Pick a subject", "error"); return; }
          const cur = App.clamp(Number(data.current_grade) || 0, 0, 7);
          const tgt = App.clamp(Number(data.target_grade) || 0, 0, 7);
          if (!cur || !tgt) { App.toast("Grades must be between 1 and 7", "error"); return; }
          App.saveGrade(grade ? grade.id : null, {
            subject_name: data.subject_name, current_grade: cur, target_grade: tgt, notes: data.notes || "",
          });
          App.toast(grade ? "Grade updated" : "Grade added");
          handle.close();
        });
      },
    });
  }

  function matrixHTML(tok, ee) {
    const letters = ["A", "B", "C", "D", "E"];
    return `
      <div class="cpm">
        <div class="hdr">TOK/EE</div>
        ${letters.map((l) => `<div class="hdr">${l}</div>`).join("")}
        ${letters.map((row) => `
          <div class="hdr">${row}</div>
          ${letters.map((col) => {
            const v = App.CORE_MATRIX[row][col];
            const active = tok === row && ee === col;
            return `<div class="cell ${v === null ? "fail" : ""} ${active ? "active" : ""}">${v === null ? "✗" : v}</div>`;
          }).join("")}`).join("")}
      </div>`;
  }

  App.pages.grades = {
    title: "Grades",
    render() {
      const s = App.state();
      const grades = [...s.grades].sort((a, b) => a.subject_name.localeCompare(b.subject_name));
      const pp = App.predictedPoints();
      const { tok, ee, corePoints, failing, maxPoints } = pp;
      const totalPoints = pp.totalPoints;
      const avg = pp.avgGrade === null ? "—" : pp.avgGrade.toFixed(1);
      const openBySubject = (name) => s.tasks.filter((t) => t.subject_name === name && !t.completed);

      const target = App.clamp(s.settings.target_points || 40, 24, 45);
      const gap = target - totalPoints;
      const onTrack = totalPoints >= target;
      const goalPct = App.clamp(Math.round((totalPoints / target) * 100), 0, 100);
      const improvements = grades
        .filter((g) => (g.target_grade || 0) > (g.current_grade || 0))
        .map((g) => ({ name: g.subject_name, emoji: App.subjectMeta(g.subject_name).emoji, current: g.current_grade, target: g.target_grade, gain: (g.target_grade || 0) - (g.current_grade || 0) }))
        .sort((a, b) => b.gain - a.gain)
        .slice(0, 4);

      return `
        <div class="page">
          ${UI.pageHead("Grades", "Track subject grades and IB core points",
            `<button class="btn btn-primary" data-add-grade>${App.icon("plus")} Add Subject</button>`)}

          <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
            <div class="card stat-tile" style="justify-content:center;text-align:center">
              <div>
                <div class="stat-value" style="color:var(--accent-soft-ink)">${totalPoints}<span class="muted" style="font-size:14px;font-weight:500"> / ${maxPoints || "—"}</span></div>
                <div class="stat-label">Predicted IB points</div>
              </div>
            </div>
            <div class="card stat-tile" style="justify-content:center;text-align:center">
              <div>
                <div class="stat-value" style="color:${failing ? "var(--danger-ink)" : "var(--good-ink)"}">${failing ? "F" : corePoints ?? "—"}<span class="muted" style="font-size:14px;font-weight:500"> / 3</span></div>
                <div class="stat-label">Core points</div>
              </div>
            </div>
            <div class="card stat-tile" style="justify-content:center;text-align:center">
              <div>
                <div class="stat-value">${avg}</div>
                <div class="stat-label">Avg subject grade</div>
              </div>
            </div>
          </div>

          ${grades.length ? `
            <div class="card card-pad mb-6">
              <div class="row between mb-2" style="align-items:center">
                <div class="card-title" style="margin:0">Diploma target</div>
                <div class="row" style="gap:6px;align-items:center">
                  <span class="muted small">Goal</span>
                  <input class="input" type="number" min="24" max="45" data-target-points value="${target}" style="width:74px;text-align:center">
                  <span class="muted small">pts</span>
                </div>
              </div>
              <div class="xp-bar"><span style="width:${goalPct}%${onTrack ? ";background:linear-gradient(90deg,var(--good),#1baf7a)" : ""}"></span></div>
              <p class="small" style="margin-top:8px">
                ${onTrack
                  ? `On track — your predicted <b>${totalPoints}</b> meets your goal of <b>${target}</b>. Keep it up.`
                  : `You're at a predicted <b>${totalPoints}</b> — <b>${gap}</b> point${gap === 1 ? "" : "s"} short of your <b>${target}</b> goal.`}
              </p>
              ${!onTrack && improvements.length ? `
                <div class="section-label" style="margin-top:12px">Biggest opportunities</div>
                <div class="stack-sm" style="gap:6px">
                  ${improvements.map((o) => `
                    <div class="row between" style="font-size:12.5px">
                      <span>${o.emoji ? o.emoji + " " : ""}${esc(o.name)}: <b>${o.current} → ${o.target}</b></span>
                      <span class="chip chip-good">+${o.gain} pt${o.gain === 1 ? "" : "s"}</span>
                    </div>`).join("")}
                </div>
                <p class="hint" style="margin-top:8px">Raising each subject to its target would add those points to your total.</p>` : ""}
              ${failing ? `<p class="small" style="color:var(--danger-ink);margin-top:8px">⚠︎ Your TOK/EE combination is currently a failing condition — resolve that first (see the core-points section below).</p>` : ""}
            </div>` : ""}

          ${grades.length ? `
            <div class="card mb-6" style="overflow:hidden">
              <div class="table-wrap">
                <table class="tbl">
                  <thead>
                    <tr>
                      <th>Subject</th><th class="num">Current</th><th class="num">Target</th>
                      <th class="num">Gap</th><th class="num">Open tasks</th><th>Notes</th><th class="right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${grades.map((g) => {
                      const gap = (g.target_grade || 0) - (g.current_grade || 0);
                      const pending = openBySubject(g.subject_name);
                      return `
                        <tr>
                          <td style="font-weight:600">${UI.subjectLabel(g.subject_name)}</td>
                          <td class="num"><span class="grade-badge current">${g.current_grade}</span></td>
                          <td class="num"><span class="grade-badge target">${g.target_grade}</span></td>
                          <td class="num" style="font-weight:650;color:${gap > 0 ? "var(--warning-ink)" : gap === 0 ? "var(--good-ink)" : "var(--accent-soft-ink)"}">${gap > 0 ? "+" + gap : gap}</td>
                          <td class="num">
                            <span class="pop-anchor">
                              <button class="chip chip-plain" data-popover-trigger data-pending="${esc(g.subject_name)}" style="cursor:pointer">${pending.length} open ${App.icon("chevD")}</button>
                            </span>
                          </td>
                          <td class="muted small" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.notes || "—")}</td>
                          <td class="right">
                            <button class="icon-btn" data-edit-grade="${esc(g.id)}" title="Edit">${App.icon("pencil")}</button>
                            <button class="icon-btn danger" data-del-grade="${esc(g.id)}" title="Delete">${App.icon("trash")}</button>
                          </td>
                        </tr>`;
                    }).join("")}
                  </tbody>
                </table>
              </div>
            </div>` : `
            <div class="mb-6">
              ${UI.emptyState("gradcap", "No grades recorded yet", "Add your subjects and current vs. target grades",
                `<button class="btn btn-outline btn-sm" data-add-grade-2>${App.icon("plus")} Add your first subject</button>`)}
            </div>`}

          <div class="card card-pad">
            <div class="card-title mb-1">Core points — TOK + Extended Essay</div>
            <p class="card-sub mb-4">Your combined TOK and EE grades earn up to 3 extra IB points. An E in either is a failing condition.</p>
            <div class="grid-2">
              <div>
                <div class="form-row">
                  <div class="field">
                    <label>TOK grade</label>
                    ${UI.selectHTML("tok", [["", "Not graded yet"], ...["A","B","C","D","E"].map((g) => [g, g])], tok, 'data-core="tok"')}
                  </div>
                  <div class="field">
                    <label>Extended Essay grade</label>
                    ${UI.selectHTML("ee", [["", "Not graded yet"], ...["A","B","C","D","E"].map((g) => [g, g])], ee, 'data-core="ee"')}
                  </div>
                </div>
                <div class="chip ${failing ? "chip-danger" : "chip-accent"}" style="font-size:13px;padding:7px 13px">
                  ${failing ? "⚠︎ Failing condition — diploma not awarded with an E" : `Core points: ${corePoints ?? "—"}`}
                </div>
              </div>
              <div style="display:flex;align-items:center;justify-content:center">
                ${matrixHTML(tok, ee)}
              </div>
            </div>
          </div>
        </div>`;
    },

    mount(el) {
      const targetInput = el.querySelector("[data-target-points]");
      if (targetInput) targetInput.addEventListener("change", () => {
        const v = App.clamp(Math.round(Number(targetInput.value) || 40), 24, 45);
        App.update((s) => { s.settings.target_points = v; });
      });

      const add = () => {
        if (!App.state().subjects.length) {
          App.toast("Add your subjects in Settings first", "error");
          return;
        }
        openGradeModal(null);
      };
      el.querySelector("[data-add-grade]").addEventListener("click", add);
      const add2 = el.querySelector("[data-add-grade-2]");
      if (add2) add2.addEventListener("click", add);

      el.querySelectorAll("[data-edit-grade]").forEach((b) =>
        b.addEventListener("click", () => {
          const g = App.state().grades.find((x) => x.id === b.dataset.editGrade);
          if (g) openGradeModal(g);
        }));
      el.querySelectorAll("[data-del-grade]").forEach((b) =>
        b.addEventListener("click", async () => {
          const ok = await UI.confirm({ title: "Delete grade?", message: "This subject's grade entry will be removed." });
          if (ok) { App.deleteGrade(b.dataset.delGrade); App.toast("Grade deleted"); }
        }));

      el.querySelectorAll("[data-pending]").forEach((btn) =>
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const name = btn.dataset.pending;
          const pending = App.state().tasks.filter((t) => t.subject_name === name && !t.completed);
          const html = `
            <div class="pop-title">Open tasks — ${esc(name)}</div>
            ${pending.length
              ? pending.map((t) => `<div class="pop-item">${esc(t.title)}${t.due_date ? ` <span class="muted">· ${D.fmtShort(t.due_date)}</span>` : ""}</div>`).join("")
              : `<div class="pop-item muted">No open tasks</div>`}`;
          UI.togglePopover(btn, html);
        }));

      // core grade selects save immediately (no separate Save button to forget)
      el.querySelectorAll("[data-core]").forEach((sel) =>
        sel.addEventListener("change", () => {
          App.update((s) => {
            if (sel.dataset.core === "tok") s.settings.tok_grade = sel.value;
            else s.settings.ee_grade = sel.value;
          });
          App.toast("Core grades saved");
        }));
    },
  };
})();
