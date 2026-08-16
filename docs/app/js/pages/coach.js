/* pages/coach.js — chat with the study coach */
(function () {
  "use strict";
  const App = window.App;
  const esc = App.esc;
  const UI = App.ui;
  const C = App.coach;

  const SUGGESTIONS = [
    "What should I work on now?",
    "Plan my week",
    "What's my predicted score?",
    "How long until my exams?",
    "Give me a study tip",
    "I'm feeling overwhelmed",
  ];

  let focusInput = false; // re-focus the input after a send re-renders the page

  // message text → safe HTML (line breaks, "• "/"- " bullets, **bold** from AI replies)
  function fmtMsg(text) {
    return esc(text)
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .split("\n")
      .map((line) => {
        const m = line.match(/^\s*[-•]\s+(.*)$/);
        return m ? `<span class="msg-bullet">${m[1]}</span>` : line;
      })
      .join("<br>");
  }

  function timeLabel(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function actionCard(action) {
    // Everything here comes out of coach.messages, which is persisted and so
    // arrives from whatever backup was restored. status drives a CSS class in an
    // attribute — whitelist it rather than escape it, so an unknown value lands
    // on the inert "cancelled" branch instead of rendering live buttons. The two
    // arrays are guarded because a missing items[] threw and blanked the page,
    // and renderNow() is deliberately unguarded at boot: a throw here costs a
    // bootOK() and can roll a good update back.
    const status = ["pending", "done", "cancelled"].includes(action.status) ? action.status : "cancelled";
    const items = Array.isArray(action.items) ? action.items : [];
    const summary = Array.isArray(action.summary) ? action.summary : [];
    return `
      <div class="action-card ${status}">
        <div class="action-title">${App.icon("zap")} Proposed change${items.length > 1 ? "s" : ""}</div>
        <div class="action-summary">${summary.map((l) => `<div>${esc(l)}</div>`).join("")}</div>
        ${status === "pending" ? `
          <div class="action-btns">
            <button class="btn btn-primary btn-sm" data-action-confirm="${esc(action.id)}">${App.icon("check")} Confirm</button>
            <button class="btn btn-outline btn-sm" data-action-cancel="${esc(action.id)}">Cancel</button>
          </div>` : `
          <div class="action-status ${status}">${status === "done" ? "✓ Applied" : "✕ Cancelled"}</div>`}
      </div>`;
  }

  App.pages.coach = {
    title: "Coach",
    render() {
      const msgs = App.state().coach.messages;
      const hasKey = C.hasKey();
      const aiOn = C.aiActive();
      const tone = C.tone();
      const sub = aiOn
        ? `AI coach (${C.modelLabel(C.model())}) · ${tone} tone · can make changes with your OK`
        : hasKey
          ? `Built-in coach · ${tone} tone · AI is switched off`
          : `Built-in coach · ${tone} tone — handles advice and clear commands; add an API key in Settings for full AI chat`;

      const intro = `
        <div class="coach-intro">
          <div class="coach-avatar big">${App.icon("messageCircle")}</div>
          <h2 style="font-size:16px;margin-top:10px">${tone === "direct" ? "Let's get to work." : "Hey — I'm your study coach."}</h2>
          <p class="muted small" style="max-width:430px;margin:6px auto 0;line-height:1.55">
            I can see your tasks, deadlines, grades and study habits — ask me what to work on,
            how to plan the week, or just vent. I can also <strong>make changes for you</strong>:
            "set all Chemistry tasks to high priority", paste a list of tasks to add them,
            or "schedule my Math IA for tomorrow". You always confirm before anything changes.
          </p>
        </div>`;

      return `
        <div class="coach-wrap">
          <div class="coach-head">
            <div>
              <h1 style="font-size:22px;letter-spacing:-0.02em">Coach</h1>
              <p class="sub muted small">${esc(sub)}</p>
            </div>
            <div class="row" style="gap:8px">
              <button class="ai-toggle ${aiOn ? "on" : ""}" data-ai-toggle
                title="${hasKey ? "Toggle AI mode" : "Add an API key in Settings to enable AI mode"}">
                ${App.icon("sparkles")} AI <span class="ai-state">${aiOn ? "On" : "Off"}</span>
              </button>
              <button class="icon-btn" data-coach-settings title="Coach settings">${App.icon("settings")}</button>
              ${msgs.length ? `<button class="icon-btn danger" data-coach-clear title="Clear conversation">${App.icon("trash")}</button>` : ""}
            </div>
          </div>

          <div class="chat-log" data-chat-log>
            ${msgs.length ? "" : intro}
            ${msgs.map((m) => m.role === "user" ? `
              <div class="msg-row user">
                <div class="msg-bubble user">${fmtMsg(m.text)}</div>
              </div>` : `
              <div class="msg-row coach">
                <div class="coach-avatar">${App.icon("messageCircle")}</div>
                <div style="min-width:0;max-width:82%">
                  <div class="msg-bubble coach">${fmtMsg(m.text)}</div>
                  ${m.action ? actionCard(m.action) : ""}
                  <div class="msg-meta">${m.via === "ai" ? "AI coach" : m.via === "action" ? "coach" : "built-in coach"} · ${timeLabel(m.ts)}</div>
                </div>
              </div>`).join("")}
            ${C.pending ? `
              <div class="msg-row coach">
                <div class="coach-avatar">${App.icon("messageCircle")}</div>
                <div class="msg-bubble coach typing"><span></span><span></span><span></span></div>
              </div>` : ""}
          </div>

          <div class="coach-foot">
            <div class="chip-suggest-row">
              ${SUGGESTIONS.map((s2) => `<button class="chip-suggest" data-suggest="${esc(s2)}">${esc(s2)}</button>`).join("")}
            </div>
            <div class="chat-input-row">
              <textarea class="input chat-input" data-chat-input rows="1"
                placeholder="${tone === "direct" ? "Say it — or paste a task list." : "Ask anything, give a command, or paste a task list…"}"
                ${C.pending ? "disabled" : ""} maxlength="8000"></textarea>
              <button class="btn btn-primary" data-chat-send ${C.pending ? "disabled" : ""} aria-label="Send">
                ${App.icon("send")}
              </button>
            </div>
          </div>
        </div>`;
    },

    mount(el) {
      const log = el.querySelector("[data-chat-log]");
      log.scrollTop = log.scrollHeight;

      const input = el.querySelector("[data-chat-input]");
      if (focusInput && !C.pending) { input.focus(); focusInput = false; }

      // grow the textarea with its content (up to ~6 lines)
      const autosize = () => {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 150) + "px";
      };
      input.addEventListener("input", autosize);

      const doSend = (text) => {
        focusInput = true;
        C.send(text);
      };

      el.querySelector("[data-chat-send]").addEventListener("click", () => {
        if (input.value.trim()) doSend(input.value);
      });
      input.addEventListener("keydown", (e) => {
        // Enter sends; Shift+Enter makes a new line (for pasting/writing lists)
        if (e.key === "Enter" && !e.shiftKey && input.value.trim()) {
          e.preventDefault();
          doSend(input.value);
        }
      });
      el.querySelectorAll("[data-suggest]").forEach((b) =>
        b.addEventListener("click", () => doSend(b.dataset.suggest)));

      // action confirm / cancel buttons
      el.querySelectorAll("[data-action-confirm]").forEach((b) =>
        b.addEventListener("click", () => { focusInput = true; C.confirmAction(b.dataset.actionConfirm); }));
      el.querySelectorAll("[data-action-cancel]").forEach((b) =>
        b.addEventListener("click", () => { focusInput = true; C.cancelAction(b.dataset.actionCancel); }));

      el.querySelector("[data-ai-toggle]").addEventListener("click", () => C.toggleAI());
      el.querySelector("[data-coach-settings]").addEventListener("click", () => App.navigate("settings"));
      const clear = el.querySelector("[data-coach-clear]");
      if (clear) clear.addEventListener("click", async () => {
        const ok = await UI.confirm({
          title: "Clear conversation?",
          message: "The whole chat history with your coach will be deleted.",
          confirmLabel: "Clear",
        });
        if (ok) C.clearConversation();
      });
    },
  };
})();
