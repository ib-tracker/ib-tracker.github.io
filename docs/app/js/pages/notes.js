/* pages/notes.js — a proper notebook with a live rich-text editor.
   Type and see formatting directly (⌘B bold, ⌘I italic, ⌘U underline), plus a
   toolbar for headings, bullet/numbered lists, checklists and links. Built on the
   browser's native contenteditable — no external libraries. Note bodies are saved
   as HTML; older Markdown notes are converted the first time you open Notes. */
(function () {
  "use strict";
  const App = window.App;
  const UI = App.ui;
  const D = App.dates;
  const esc = App.esc;

  // view state (survives re-renders; not persisted)
  let sel = null;         // selected note id
  let q = "";             // search query
  let justCreated = null; // id to autofocus after creation

  /* ---------- Markdown → HTML (only to migrate old notes) ---------- */
  function inlineMd(s) {
    return s
      .replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
        (_m, t, u) => `<a href="${u}">${t}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, "$1<em>$2</em>");
  }
  function mdToHtml(src) {
    const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0, listType = null;
    const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
    const special = (l) => /^```/.test(l) || /^\s*---+\s*$/.test(l) || /^#{1,6}\s/.test(l)
      || /^\s*>\s?/.test(l) || /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l) || /^\s*$/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) { closeList(); const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) { buf.push(esc(lines[i])); i++; } i++; out.push(`<pre>${buf.join("\n")}</pre>`); continue; }
      if (/^\s*---+\s*$/.test(line)) { closeList(); out.push("<hr>"); i++; continue; }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { closeList(); out.push(`<h3>${inlineMd(esc(h[2]))}</h3>`); i++; continue; }
      if (/^\s*>\s?/.test(line)) { closeList(); out.push(`<blockquote>${inlineMd(esc(line.replace(/^\s*>\s?/, "")))}</blockquote>`); i++; continue; }
      const ul = line.match(/^\s*[-*]\s+(.*)$/);
      if (ul) { if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; } out.push(`<li>${inlineMd(esc(ul[1]))}</li>`); i++; continue; }
      const ol = line.match(/^\s*\d+\.\s+(.*)$/);
      if (ol) { if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; } out.push(`<li>${inlineMd(esc(ol[1]))}</li>`); i++; continue; }
      if (/^\s*$/.test(line)) { closeList(); i++; continue; }
      closeList();
      const para = [];
      while (i < lines.length && !special(lines[i])) { para.push(inlineMd(esc(lines[i]))); i++; }
      out.push(`<div>${para.join("<br>")}</div>`);
    }
    closeList();
    return out.join("");
  }

  function migrateNotes() {
    const s = App.state();
    if (s.notes.some((n) => n.format !== "html")) {
      App.update((st) => {
        st.notes.forEach((n) => { if (n.format !== "html") { n.body = mdToHtml(n.body || ""); n.format = "html"; } });
      }, { silent: true });
    }
  }

  /* ---------- helpers ---------- */
  const htmlToText = App.htmlToText;
  // Everything that reaches the DOM goes through the sanitizer: a note body can
  // come from a pasted web page or a restored backup, so it is never trusted.
  const rawBody = (n) => (!n ? "" : n.format === "html" ? (n.body || "") : mdToHtml(n.body || ""));
  const bodyHtml = (n) => App.sanitizeHtml(rawBody(n)); // only for HTML that is rendered
  // previews/search read text straight from the raw body — htmlToText never
  // touches the DOM, so it is safe and much cheaper than sanitizing every note
  const firstTextLine = (n) => htmlToText(rawBody(n)).split("\n").map((l) => l.trim()).find(Boolean) || "";
  // String(): a note from a restored backup may have no title at all — migrate()
  // checks that notes is an array but doesn't normalise the records in it, and a
  // bare .trim() here blanked the whole page. rawBody() already guards body the
  // same way; title was the one field that didn't.
  const noteTitle = (n) => String((n && n.title) || "").trim() || firstTextLine(n) || "Untitled";
  const snippet = (n) => { const t = htmlToText(rawBody(n)).replace(/\s+/g, " ").trim(); return t ? t.slice(0, 64) : "No additional text"; };
  function wordCount(html) { const w = htmlToText(html).trim(); const n = w ? w.split(/\s+/).length : 0; return `${n} word${n === 1 ? "" : "s"}`; }

  function sortedFiltered(notes, query) {
    const ql = query.trim().toLowerCase();
    const matched = ql ? notes.filter((n) => (n.title + "\n" + htmlToText(rawBody(n))).toLowerCase().includes(ql)) : notes.slice();
    return matched.sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return (b.updated_at || "").localeCompare(a.updated_at || "");
    });
  }

  function noteRow(n, isSel) {
    return `
      <button class="note-row ${isSel ? "active" : ""}" data-note-row="${esc(n.id)}" type="button">
        <div class="nr-top">
          ${n.pinned ? `<span class="nr-pin" title="Pinned">${App.icon("flag")}</span>` : ""}
          <span class="nr-title">${esc(noteTitle(n))}</span>
        </div>
        <div class="nr-sub">${esc(snippet(n))}</div>
        <div class="nr-date">${esc(D.fmtShort(D.isoToDateStr(n.updated_at) || D.today()))}</div>
      </button>`;
  }

  const TOOLBAR = `
    <div class="note-toolbar" data-note-toolbar>
      <button class="note-tool" data-cmd="bold" title="Bold (⌘B)" type="button"><b>B</b></button>
      <button class="note-tool" data-cmd="italic" title="Italic (⌘I)" type="button"><i>I</i></button>
      <button class="note-tool" data-cmd="underline" title="Underline (⌘U)" type="button"><u>U</u></button>
      <span class="note-tool-sep"></span>
      <button class="note-tool" data-cmd="heading" title="Heading" type="button">H</button>
      <button class="note-tool" data-cmd="ul" title="Bullet list" type="button">•</button>
      <button class="note-tool" data-cmd="ol" title="Numbered list" type="button">1.</button>
      <button class="note-tool" data-cmd="checklist" title="Checklist" type="button">☑</button>
      <span class="note-tool-sep"></span>
      <button class="note-tool" data-cmd="link" title="Add link" type="button">${App.icon("link")}</button>
    </div>`;

  function editorHTML(n) {
    const html = bodyHtml(n);
    const empty = !htmlToText(html).trim();
    return `
      <div class="editor-bar">
        <input class="editor-title" data-note-title placeholder="Untitled note" value="${esc(n.title)}">
        <div class="editor-actions">
          <button class="icon-btn ${n.pinned ? "is-on" : ""}" data-note-pin title="${n.pinned ? "Unpin" : "Pin to top"}" type="button">${App.icon("flag")}</button>
          <button class="icon-btn danger" data-note-del title="Delete note" type="button">${App.icon("trash")}</button>
        </div>
      </div>
      ${TOOLBAR}
      <div class="note-editor ${empty ? "is-empty" : ""}" data-note-body contenteditable="true"
           data-placeholder="Start writing…  ⌘B bold · ⌘I italic · or use the toolbar.">${html}</div>
      <div class="editor-foot">
        <span data-note-status>Saved</span>
        <span class="editor-count" data-note-count>${wordCount(html)}</span>
      </div>`;
  }

  App.pages.notes = {
    title: "Notes",
    onEnter() { migrateNotes(); },
    render() {
      const s = App.state();
      if (sel && !s.notes.some((n) => n.id === sel)) sel = null;
      const notes = sortedFiltered(s.notes, q);
      if (!sel && notes.length) sel = notes[0].id;
      const active = sel ? App.noteById(sel) : null;

      return `
        <div class="page notes-page">
          ${UI.pageHead("Notes", "Ideas, formulae and anything that isn't a task — saved on this computer",
            `<button class="btn btn-primary" data-new-note>${App.icon("plus")} New note</button>`)}
          <div class="notes-app">
            <aside class="notes-list card">
              <div class="notes-search">
                ${App.icon("search")}
                <input class="notes-search-input" data-note-search placeholder="Search notes…" value="${esc(q)}">
              </div>
              <div class="notes-items" data-note-items>
                ${notes.length ? notes.map((n) => noteRow(n, n.id === sel)).join("")
                  : `<div class="notes-empty">${q ? "No notes match your search." : "No notes yet."}</div>`}
              </div>
            </aside>
            <section class="notes-editor card">
              ${active ? editorHTML(active)
                : UI.emptyState("fileText", q ? "No note selected" : "Your notebook is empty",
                    "Create a note to start writing.",
                    `<button class="btn btn-outline btn-sm" data-new-note-2>${App.icon("plus")} New note</button>`)}
            </section>
          </div>
        </div>`;
    },

    mount(el) {
      const newNote = () => { const id = App.addNote(""); sel = id; justCreated = id; };
      el.querySelector("[data-new-note]").addEventListener("click", newNote);
      const new2 = el.querySelector("[data-new-note-2]");
      if (new2) new2.addEventListener("click", newNote);

      // search filters the list in place (keeps the search box focused)
      const search = el.querySelector("[data-note-search]");
      const bindRows = () => el.querySelectorAll("[data-note-row]").forEach((b) =>
        b.addEventListener("click", () => { sel = b.dataset.noteRow; App.render(); }));
      if (search) search.addEventListener("input", () => {
        q = search.value;
        const cont = el.querySelector("[data-note-items]");
        const notes = sortedFiltered(App.state().notes, q);
        cont.innerHTML = notes.length ? notes.map((n) => noteRow(n, n.id === sel)).join("")
          : `<div class="notes-empty">${q ? "No notes match your search." : "No notes yet."}</div>`;
        bindRows();
      });
      bindRows();

      const titleEl = el.querySelector("[data-note-title]");
      const editor = el.querySelector("[data-note-body]");
      const statusEl = el.querySelector("[data-note-status]");
      const countEl = el.querySelector("[data-note-count]");
      const status = (t) => { if (statusEl) statusEl.textContent = t; };

      if (titleEl) {
        const save = App.debounce(() => { App.updateNote(sel, { title: titleEl.value }, { silent: true }); status("Saved"); }, 350);
        titleEl.addEventListener("input", () => {
          status("Saving…"); save();
          const row = el.querySelector(`[data-note-row="${CSS.escape(sel)}"] .nr-title`);
          if (row) row.textContent = titleEl.value.trim() || firstTextLine(App.noteById(sel)) || "Untitled";
        });
      }

      if (editor) {
        // a 'checked' class only means something on a non-empty item inside a checklist
        const cleanup = () => editor.querySelectorAll("li.checked").forEach((li) => {
          if (!li.parentElement.classList.contains("checklist") || !li.textContent.trim()) li.classList.remove("checked");
        });
        const persist = () => App.updateNote(sel, { body: editor.innerHTML, format: "html" }, { silent: true });
        const saveDebounced = App.debounce(() => { persist(); status("Saved"); }, 400);
        const updateEmpty = () => editor.classList.toggle("is-empty", !editor.textContent.trim() && !editor.querySelector("img,hr,li"));
        const updateCount = () => { if (countEl) countEl.textContent = wordCount(editor.innerHTML); };
        const updateRow = () => {
          const row = el.querySelector(`[data-note-row="${CSS.escape(sel)}"] .nr-sub`);
          if (row) row.textContent = snippet({ format: "html", title: "", body: editor.innerHTML });
        };
        const saveNow = () => { cleanup(); persist(); status("Saved"); updateEmpty(); updateCount(); updateRow(); };

        editor.addEventListener("input", () => {
          cleanup();
          status("Saving…"); updateEmpty(); updateCount(); updateRow(); saveDebounced();
        });

        // Paste keeps basic formatting (bold/italic/lists/links/headings) but
        // drops the source page's fonts, colours, images and any scripting, so
        // pasted text adopts this note's styling instead of looking foreign.
        editor.addEventListener("paste", (e) => {
          const dt = e.clipboardData;
          if (!dt) return;
          e.preventDefault();
          const html = dt.getData("text/html");
          if (html) {
            const clean = App.sanitizeHtml(html);
            if (clean.trim()) { document.execCommand("insertHTML", false, clean); saveNow(); return; }
          }
          document.execCommand("insertText", false, dt.getData("text/plain") || "");
          saveNow();
        });

        // native ⌘B / ⌘I / ⌘U already work; keep an explicit fallback for reliability
        editor.addEventListener("keydown", (e) => {
          if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
          const k = e.key.toLowerCase();
          if (k === "b" || k === "i" || k === "u") {
            e.preventDefault();
            document.execCommand(k === "b" ? "bold" : k === "i" ? "italic" : "underline");
            saveNow();
          }
        });

        // click a checklist checkbox (the box sits in the left gutter) to toggle it
        editor.addEventListener("mousedown", (e) => {
          const li = e.target.closest && e.target.closest("li");
          if (li && li.parentElement && li.parentElement.classList.contains("checklist")) {
            const rect = li.getBoundingClientRect();
            if (e.clientX - rect.left < 28) { e.preventDefault(); li.classList.toggle("checked"); saveNow(); }
          }
        });

        // ----- toolbar -----
        let savedRange = null;
        const saveSel = () => { const s = document.getSelection(); if (s && s.rangeCount && editor.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange(); };
        const restoreSel = () => { editor.focus(); if (savedRange) { const s = document.getSelection(); s.removeAllRanges(); s.addRange(savedRange); } };

        const currentUL = () => {
          const s = document.getSelection();
          let node = s && s.anchorNode;
          node = node && (node.nodeType === 1 ? node : node.parentElement);
          return node && node.closest ? node.closest("ul") : null;
        };
        const exec = (cmd) => {
          editor.focus();
          if (cmd === "bold" || cmd === "italic" || cmd === "underline") document.execCommand(cmd);
          else if (cmd === "ul") document.execCommand("insertUnorderedList");
          else if (cmd === "ol") document.execCommand("insertOrderedList");
          else if (cmd === "heading") {
            const cur = (document.queryCommandValue("formatBlock") || "").toLowerCase();
            document.execCommand("formatBlock", false, cur === "h3" ? "div" : "h3");
          } else if (cmd === "checklist") {
            const ul = currentUL();
            if (ul && ul.classList.contains("checklist")) document.execCommand("insertUnorderedList"); // toggle off
            else if (ul) ul.classList.add("checklist");
            else { document.execCommand("insertUnorderedList"); const u2 = currentUL(); if (u2) u2.classList.add("checklist"); }
          }
        };

        const promptLink = (cb) => UI.openModal({
          title: "Add link", size: "sm",
          body: `<div class="field" style="margin:0"><label>Link URL</label><input class="input" data-lu placeholder="https://…"></div>`,
          foot: `<button class="btn btn-outline" data-close>Cancel</button><button class="btn btn-primary" data-ok>Add link</button>`,
          onMount(m, h) {
            const inp = m.querySelector("[data-lu]");
            const go = () => { let v = (inp.value || "").trim(); h.close(); if (!v) return; if (!/^(https?:\/\/|mailto:)/i.test(v)) v = "https://" + v; cb(v); };
            m.querySelector("[data-ok]").addEventListener("click", go);
            inp.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
          },
        });

        el.querySelectorAll(".note-tool").forEach((btn) => {
          btn.addEventListener("mousedown", (e) => e.preventDefault()); // don't steal the selection
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            const cmd = btn.dataset.cmd;
            if (cmd === "link") {
              saveSel();
              promptLink((url) => {
                restoreSel();
                if (!savedRange || savedRange.collapsed) document.execCommand("insertHTML", false, `<a href="${esc(url)}">${esc(url)}</a>`);
                else document.execCommand("createLink", false, url);
                saveNow();
              });
              return;
            }
            exec(cmd);
            saveNow();
          });
        });
      }

      const pin = el.querySelector("[data-note-pin]");
      if (pin) pin.addEventListener("click", () => { const n = App.noteById(sel); App.updateNote(sel, { pinned: !n.pinned }); });

      const del = el.querySelector("[data-note-del]");
      if (del) del.addEventListener("click", async () => {
        const n = App.noteById(sel);
        const ok = await UI.confirm({ title: "Delete note?", message: `“${(n && noteTitle(n)) || "Untitled"}” will be permanently deleted.` });
        if (ok) { App.deleteNote(sel); sel = null; }
      });

      // autofocus a freshly created note's title
      if (titleEl && justCreated && justCreated === sel) { justCreated = null; setTimeout(() => titleEl.focus(), 40); }
    },
  };
})();
