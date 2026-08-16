/* update.js — version check and, on the desktop app, self-update.
   ---------------------------------------------------------------------------
   Two very different environments share this one UI:

   • Desktop (Electron)  window.ibUpdater exists — the main process fetches the
     manifest, downloads the payload, verifies its SHA-256 and swaps it in, so
     the app really can update itself. See packaging/app/updater.js.
   • Browser (file:// or a static server)  a web page cannot write to disk, so
     the most we can honestly do is notice a newer version and link to it.

   Nothing here runs at all until js/version.js carries an `updateHost`. */
(function () {
  "use strict";
  const App = window.App;
  const UI = App.ui;
  const esc = App.esc;
  const B = window.APP_BUILD || {};

  const U = (App.updates = {});
  const CHECK_EVERY_HOURS = 24;
  const FETCH_TIMEOUT_MS = 10000;

  U.version = B.version || "0.0.0";

  // A bare hostname, optionally with a port for local testing. No scheme, no
  // path — anything else is treated as unconfigured rather than guessed at.
  const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;
  const host = String(B.updateHost || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const path = (p, fallback) => {
    const v = String(p || fallback);
    return v.startsWith("/") ? v : "/" + v;
  };

  U.updateHost = HOST_RE.test(host) ? host : "";
  U.payloadHost = U.updateHost
    ? (HOST_RE.test(String(B.payloadHost || "").trim()) ? String(B.payloadHost).trim() : U.updateHost)
    : "";
  U.configured = !!U.updateHost;
  U.desktop = !!(window.ibUpdater && window.ibUpdater.available);

  // Where to send someone who needs a full installer rather than an in-place
  // update — a shell-level release, or the browser build, which can't self-update.
  U.releasesURL = U.configured
    ? `https://${U.updateHost}${path(B.downloadPath, "/download")}`
    : "";

  U.manifestURLs = U.configured
    ? [`https://${U.updateHost}${path(B.manifestPath, "/updates/version.json")}`]
    : [];

  // live (not persisted) status: "idle" | "checking" | "current" | "available" | "error" | "installing"
  U.status = "idle";
  U.error = "";
  U.manifest = null;

  /* ---------- version compare ---------- */
  // "1.2.10" > "1.2.9"; a pre-release suffix ("1.2.0-beta.1") sorts below the
  // plain release. Returns 1 / 0 / -1.
  function nums(v) {
    return String(v || "0").trim().replace(/^v/i, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  }
  function pre(v) {
    const bits = String(v || "").trim().replace(/^v/i, "").split("-");
    return bits.length > 1 ? bits.slice(1).join("-") : "";
  }
  U.cmp = function (a, b) {
    const A = nums(a), Bv = nums(b);
    for (let i = 0; i < Math.max(A.length, Bv.length); i++) {
      const d = (A[i] || 0) - (Bv[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    const pa = pre(a), pb = pre(b);
    if (pa === pb) return 0;
    if (!pa) return 1;            // 1.2.0 > 1.2.0-beta
    if (!pb) return -1;
    return pa > pb ? 1 : -1;
  };

  U.isNewer = (v) => U.cmp(v, U.version) > 0;

  /* ---------- manifest ---------- */
  // Only the fields we actually use, and every one of them re-validated —
  // this JSON comes off the network.
  function bad(msg) { const e = new Error(msg); e.validation = true; return e; }

  function cleanManifest(raw) {
    if (!raw || typeof raw !== "object") throw bad("Malformed update manifest");
    const version = String(raw.version || "").trim().replace(/^v/i, "");
    if (!/^\d+(\.\d+){0,3}(-[\w.]+)?$/.test(version)) throw bad("Malformed version in manifest");
    const notes = Array.isArray(raw.notes)
      ? raw.notes.filter((n) => typeof n === "string").slice(0, 12).map((n) => n.slice(0, 200))
      : [];
    const p = raw.payload && typeof raw.payload === "object" ? raw.payload : {};
    return {
      version,
      released: typeof raw.released === "string" ? raw.released.slice(0, 10) : "",
      notes,
      min_shell: typeof raw.min_shell === "string" ? raw.min_shell : "",
      payload: {
        url: typeof p.url === "string" ? p.url : "",
        sha256: typeof p.sha256 === "string" ? p.sha256.toLowerCase() : "",
        size: Number(p.size) || 0,
      },
    };
  }

  // Electron wraps a rejected ipcMain.handle as
  // "Error invoking remote method 'x': Error: the real message" — users should
  // only ever see the real message.
  function unwrapIPCError(e) {
    const raw = (e && e.message) || String(e);
    const m = raw.match(/Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?(.*)$/);
    return m ? m[1] : raw;
  }

  async function fetchManifest() {
    // In the desktop app the main process does this — a file:// page has no
    // usable CORS origin for the release-asset fallback, and main can reuse the
    // exact same HTTPS/redirect rules it uses for the payload download.
    if (U.desktop) {
      try { return cleanManifest(await window.ibUpdater.fetchManifest()); }
      catch (e) { throw new Error(unwrapIPCError(e)); }
    }
    let lastErr;
    for (const url of U.manifestURLs) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(url, { cache: "no-store", signal: ctl.signal });
        clearTimeout(t);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return cleanManifest(await res.json());
      } catch (e) {
        if (e && e.validation) throw e;   // we reached the server; the file is wrong
        lastErr = e;
      }
    }
    throw new Error(lastErr && lastErr.name === "AbortError" ? "Timed out" : "Couldn't reach the update server");
  }

  /* ---------- checking ---------- */
  U.lastCheck = () => App.state().ui.update_last_check || "";

  U.lastCheckLabel = function () {
    const iso = U.lastCheck();
    if (!iso) return "never";
    const then = new Date(iso);
    if (isNaN(then)) return "never";
    const mins = Math.round((Date.now() - then.getTime()) / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return `${mins} minutes ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
    const days = Math.round(hrs / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
  };

  // check({manual}) — never throws; the result also lands on U.status/U.error.
  U.check = async function (opts) {
    opts = opts || {};
    if (!U.configured) { U.status = "unconfigured"; return U.status; }
    if (U.status === "checking" || U.status === "installing") return U.status;
    U.status = "checking";
    U.error = "";
    if (opts.manual) App.render();
    try {
      const m = await fetchManifest();
      U.manifest = m;
      U.status = U.isNewer(m.version) ? "available" : "current";
      App.update((s) => { s.ui.update_last_check = new Date().toISOString(); }, { silent: true, system: true });
    } catch (e) {
      U.error = (e && e.message) || "Update check failed";
      U.status = "error";
    }
    App.render();
    return U.status;
  };

  // Fire-and-forget check on launch, at most once a day, a few seconds after
  // boot so a slow network never delays the first paint.
  U.boot = function () {
    if (!U.configured) return;
    if (App.state().settings.auto_update_check === false) return;
    const last = U.lastCheck();
    if (last) {
      const age = Date.now() - new Date(last).getTime();
      if (age >= 0 && age < CHECK_EVERY_HOURS * 3600 * 1000) return;
    }
    setTimeout(() => { U.check({ manual: false }); }, 4000);
  };

  /* ---------- installing (desktop only) ---------- */
  U.dismiss = function (version) {
    App.update((s) => { s.ui.update_dismissed_version = version || ""; }, { silent: true, system: true });
    App.render();
  };

  function notesHTML(m) {
    if (!m.notes.length) return "";
    return `<ul class="upd-notes">${m.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;
  }

  U.openReleasePage = function () {
    if (!U.releasesURL) return;
    window.open(U.releasesURL, "_blank", "noopener,noreferrer");
  };

  // The whole install flow: show what's changing, get an explicit yes, hand off
  // to the main process, then relaunch. Data lives in localStorage, which the
  // update never touches — but say so, because "update" is a scary word.
  U.install = function () {
    const m = U.manifest;
    if (!m || !U.isNewer(m.version)) return;

    if (!U.desktop) { U.openReleasePage(); return; }

    // Some updates change the Electron shell itself, which lives inside the
    // signed app bundle and can't be hot-swapped — those need a fresh download.
    const shell = window.ibUpdater.shellVersion || U.version;
    if (m.min_shell && U.cmp(m.min_shell, shell) > 0) {
      UI.openModal({
        title: `Version ${esc(m.version)} needs a fresh download`,
        size: "sm",
        body: `<p class="muted" style="font-size:13px;line-height:1.5">This update changes the app itself, not just its contents, so it can't be installed in place. Download the new version and drag it to Applications — your data stays where it is.</p>${notesHTML(m)}`,
        foot: `<button class="btn btn-outline" data-close>Not now</button>
               <button class="btn btn-primary" data-open>${App.icon("download")} Open download page</button>`,
        onMount(el, handle) {
          el.querySelector("[data-open]").addEventListener("click", () => { U.openReleasePage(); handle.close(); });
        },
      });
      return;
    }

    if (!m.payload.url || !m.payload.sha256) {
      App.toast("This release has no installable download", "error");
      return;
    }

    const handle = UI.openModal({
      title: `Update to ${esc(m.version)}`,
      size: "sm",
      body: `
        <p class="muted" style="font-size:13px;line-height:1.5">
          You're on ${esc(U.version)}${m.released ? ` · released ${esc(m.released)}` : ""}.
          The app will restart when it's done. <b>Your tasks, sessions and settings are untouched</b> — an update only replaces the app's own files.
        </p>
        ${notesHTML(m)}
        <div class="upd-progress" data-progress hidden>
          <div class="upd-bar"><div class="upd-bar-fill" data-bar style="width:0%"></div></div>
          <p class="small muted mt-1" data-step>Starting…</p>
        </div>`,
      foot: `<button class="btn btn-outline" data-close>Not now</button>
             <button class="btn btn-primary" data-go>${App.icon("download")} Update &amp; restart</button>`,
      onMount(el, h) {
        const go = el.querySelector("[data-go]");
        go.addEventListener("click", async () => {
          go.disabled = true;
          el.querySelector("[data-close]").disabled = true;
          el.querySelector("[data-progress]").hidden = false;
          const bar = el.querySelector("[data-bar]");
          const step = el.querySelector("[data-step]");
          U.status = "installing";

          const off = window.ibUpdater.onProgress((p) => {
            if (p && typeof p.percent === "number") bar.style.width = App.clamp(p.percent, 0, 100) + "%";
            if (p && p.step) step.textContent = p.step;
          });

          let res;
          try { res = await window.ibUpdater.install(m); }
          catch (e) { res = { ok: false, error: unwrapIPCError(e) || "Update failed" }; }
          off && off();

          if (res && res.ok) {
            bar.style.width = "100%";
            step.textContent = "Restarting…";
            setTimeout(() => window.ibUpdater.relaunch(), 700);
          } else {
            U.status = "error";
            U.error = (res && res.error) || "Update failed";
            h.close();
            App.toast(U.error, "error");
            App.render();
          }
        });
      },
    });
    return handle;
  };

  /* ---------- Dashboard banner ---------- */
  U.bannerDue = function () {
    if (!U.configured || U.status !== "available" || !U.manifest) return false;
    return App.state().ui.update_dismissed_version !== U.manifest.version;
  };

  U.bannerHTML = function () {
    if (!U.bannerDue()) return "";
    const m = U.manifest;
    return `
      <div class="update-banner">
        ${App.icon("download")}
        <div class="ub-text">
          <b>Version ${esc(m.version)} is available</b> — you're on ${esc(U.version)}.
          ${U.desktop ? "It installs in a few seconds and your data stays put." : "Download it to get the latest version."}
        </div>
        <button class="btn btn-primary btn-sm" data-update-now>${U.desktop ? "Update" : "Download"}</button>
        <button class="icon-btn" data-update-dismiss aria-label="Dismiss">${App.icon("x")}</button>
      </div>`;
  };

  // Called by any page that renders bannerHTML().
  U.mountBanner = function (el) {
    const go = el.querySelector("[data-update-now]");
    if (go) go.addEventListener("click", () => U.install());
    const no = el.querySelector("[data-update-dismiss]");
    if (no) no.addEventListener("click", () => U.dismiss(U.manifest && U.manifest.version));
  };
})();
