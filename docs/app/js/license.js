/* license.js — license keys.
   ---------------------------------------------------------------------------
   Keys are prepaid blocks of access: 1, 3, 6 or 12 months, or lifetime. Nothing
   auto-renews. A key looks like

     IBT1.<payload>.<signature>          both parts base64url

   where payload is compact JSON {n,t,x,id} and the signature is ECDSA P-256 /
   SHA-256 over the payload STRING exactly as it appears in the key — signing
   the encoded text rather than the JSON sidesteps every canonicalisation
   question about key order and whitespace.

   Only the PUBLIC key ships. The app can therefore check a key but not mint
   one, so nobody generates their own by reading this file. Someone determined
   can still patch the app — that is inherent to software that runs on a
   machine you don't control, and the point here is to make honesty easy, not
   to make dishonesty impossible.

   ECDSA P-256, not Ed25519: Electron 33 ships Chromium 130, whose WebCrypto
   does NOT implement Ed25519. Verified on the real target, where it throws
   NotSupportedError. P-256 works everywhere the app runs.                    */
(function () {
  "use strict";
  const App = window.App;
  const L = (App.license = {});

  // Public half of the signing keypair. Safe to publish — see above.
  const PUBLIC_SPKI_B64 =
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE+Uejkim34yaGl8E0/zPXKmzxLE9mlMYuDmU5ktBbhbSdcb11u9liqHIcFTMmbCGPe629LbZwZMePdSG/p+JI8w==";

  const TIERS = {
    "1m":   { label: "1 month",   months: 1 },
    "3m":   { label: "3 months",  months: 3 },
    "6m":   { label: "6 months",  months: 6 },
    "12m":  { label: "12 months", months: 12 },
    "life": { label: "Lifetime",  months: 0 },
  };
  L.TIERS = TIERS;

  /* ---------- state ---------- */
  // "none" (never entered) | "licensed" | "expired" | "invalid"
  L.status = "none";
  L.tier = "";
  L.name = "";
  L.expiry = "";      // "" for lifetime
  L.id = "";
  L.reason = "";      // why an entered key isn't being honoured
  L.ready = false;    // verification has finished at least once

  L.isLifetime = () => L.status === "licensed" && !L.expiry;
  L.tierLabel = () => (TIERS[L.tier] ? TIERS[L.tier].label : L.tier || "");

  /* ---------- free trial ------------------------------------------------
     Full editing from first launch. Without it a new install is read-only
     forever, which means the app can only ever be judged on sample data.

     `trialLeft` is a cached number, refreshed by refreshTrial() at boot and
     whenever a key is applied or removed. It matters that readOnly() only
     READS it: readOnly() is consulted by every single App.update, and both
     stamping the start date and effectiveToday() write state, so computing
     the trial inside readOnly() would recurse through update() forever.

     A trial that expires mid-session therefore only takes hold on the next
     launch, which is the forgiving direction to round in.

     This is local state on a local-first app, so clearing it buys another
     trial. That's a deliberate trade: the alternative is accounts and a
     server, which is the thing this app exists to avoid.

     Longer in a browser than on the desktop, deliberately.

     The browser build is the top of the funnel: it is the version somebody
     tries on a school Chromebook with no download, no install and no security
     warning, and it has to survive long enough to be judged across real
     coursework. The Mac app is downloaded by people who already decided they
     liked it, so it does not need to do the same convincing.

     window.ibUpdater is injected by the desktop shell's preload before any of
     this runs, and is the same signal update.js uses to tell the two apart. */
  const IS_DESKTOP = !!(window.ibUpdater && window.ibUpdater.available);
  const TRIAL_DAYS = IS_DESKTOP ? 7 : 30;
  let trialLeft = TRIAL_DAYS;

  L.TRIAL_DAYS = TRIAL_DAYS;

  L.refreshTrial = function () {
    const s = App.state();
    let start = (s.ui && s.ui.trial_started_at) || "";
    if (!start) {
      start = App.dates.today();
      App.update((st) => { st.ui.trial_started_at = start; }, { silent: true, system: true });
    }
    // Measured against effectiveToday() so the same clock-rollback protection
    // that guards license expiry guards the trial.
    const used = App.dates.diffDays(start, effectiveToday());
    trialLeft = Math.max(0, TRIAL_DAYS - Math.max(0, used));
    return trialLeft;
  };

  L.trialDaysLeft = () => trialLeft;
  L.inTrial = () => L.status !== "licensed" && trialLeft > 0;

  // Everything is readable; editing is what a license buys, once the trial is
  // over. Fails CLOSED: before the first check has finished we don't yet know
  // whether this copy is licensed, and guessing "yes" would let anything that
  // writes during boot slip past the one gate every change funnels through.
  L.readOnly = () => !L.ready || (L.status !== "licensed" && trialLeft <= 0);

  /* ---------- encoding helpers ---------- */
  function b64urlToBytes(s) {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function b64ToBytes(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  let pubKeyPromise = null;
  function publicKey() {
    if (!pubKeyPromise) {
      pubKeyPromise = crypto.subtle.importKey(
        "spki", b64ToBytes(PUBLIC_SPKI_B64),
        { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    }
    return pubKeyPromise;
  }

  /* ---------- the clock ----------
     A license that expires is only as honest as the machine's clock, and
     winding it back is the obvious way to cheat. So remember the furthest date
     ever seen and judge expiry against max(now, furthest): moving the clock
     back can never buy time, while a genuine correction of a few hours or a
     timezone change costs nobody anything. */
  function effectiveToday() {
    const s = App.state();
    const now = App.dates.today();
    const seen = (s.ui && s.ui.license_date_seen) || "";
    const eff = seen && seen > now ? seen : now;
    if (eff !== seen) {
      App.update((st) => { st.ui.license_date_seen = eff; }, { silent: true, system: true });
    }
    return eff;
  }
  L.effectiveToday = effectiveToday;

  /* ---------- verification ---------- */
  // Resolves to a plain result; never throws, so a malformed key can't wedge boot.
  L.verify = async function (key) {
    const raw = String(key || "").trim().replace(/\s+/g, "");
    if (!raw) return { ok: false, reason: "" };

    const parts = raw.split(".");
    if (parts.length !== 3 || parts[0] !== "IBT1") {
      return { ok: false, reason: "That doesn't look like a license key." };
    }
    const [, payloadB64, sigB64] = parts;

    let sigOK = false;
    try {
      sigOK = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        await publicKey(),
        b64urlToBytes(sigB64),
        new TextEncoder().encode(payloadB64));
    } catch (e) {
      return { ok: false, reason: "That key is damaged — check it copied in full." };
    }
    if (!sigOK) return { ok: false, reason: "That key isn't valid." };

    let p;
    try { p = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64))); }
    catch (e) { return { ok: false, reason: "That key is damaged — check it copied in full." }; }

    const tier = String(p.t || "");
    if (!TIERS[tier]) return { ok: false, reason: "That key is for a plan this version doesn't know about." };

    const expiry = tier === "life" ? "" : String(p.x || "");
    if (tier !== "life" && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
      return { ok: false, reason: "That key is damaged — check it copied in full." };
    }

    return {
      ok: true,
      tier,
      expiry,
      name: String(p.n || ""),
      id: String(p.id || ""),
      expired: !!expiry && expiry < effectiveToday(),
    };
  };

  /* ---------- apply / load ---------- */
  function settle(res) {
    if (!res || !res.ok) {
      L.status = res && res.reason ? "invalid" : "none";
      L.tier = L.name = L.expiry = L.id = "";
      L.reason = (res && res.reason) || "";
    } else {
      L.status = res.expired ? "expired" : "licensed";
      L.tier = res.tier; L.name = res.name; L.expiry = res.expiry; L.id = res.id;
      L.reason = res.expired ? "This license ran out on " + App.dates.fmtShort(res.expiry) + "." : "";
    }
    L.ready = true;
    // Every path that settles a license status runs through here (boot, apply,
    // remove), which makes it the one place the trial can't be missed. Its
    // writes are {system}, so they don't consult readOnly and can't recurse.
    L.refreshTrial();
    return L.status;
  }

  L.storedKey = () => (App.state().ui && App.state().ui.license_key) || "";

  // Called once during boot, before the first render, so the app never briefly
  // allows edits it is about to refuse.
  L.load = async function () {
    return settle(await L.verify(L.storedKey()));
  };

  // Save only if it actually verifies — refuse to store a key we'd reject
  // later, so Settings can never show a key that silently does nothing.
  L.apply = async function (key) {
    const res = await L.verify(key);
    if (!res.ok) { settle(res); return res; }
    App.update((s) => { s.ui.license_key = String(key).trim().replace(/\s+/g, ""); },
      { silent: true, system: true });
    settle(res);
    return res;
  };

  L.remove = function () {
    App.update((s) => { s.ui.license_key = ""; }, { silent: true, system: true });
    settle({ ok: false, reason: "" });
  };

  L.daysLeft = function () {
    if (!L.expiry) return Infinity;
    return App.dates.diffDays(effectiveToday(), L.expiry);
  };

  /* ---------- banner ---------- */
  // Not dismissible: unlike an update notice, this explains why the app isn't
  // accepting changes. Hiding it would just leave edits silently failing.
  L.bannerHTML = function () {
    const esc = App.esc;

    // Trial running out. Worth saying before it happens rather than letting
    // the app go read-only mid-sentence, but only in the last few days: a
    // countdown from day one is just nagging.
    if (!L.readOnly() && L.inTrial() && trialLeft <= 3) {
      return `
        <div class="license-banner">
          ${App.icon("alertTri")}
          <div class="lb-text">
            <strong>${trialLeft} day${trialLeft === 1 ? "" : "s"} left in your trial.</strong>
            After that the app turns read-only: everything you've added stays,
            and stays searchable and exportable, but adding more needs a key.
          </div>
          <button class="btn btn-primary btn-sm" data-license-goto>Add a key</button>
        </div>`;
    }

    if (!L.readOnly()) return "";
    const headline = L.status === "expired"
      ? esc(L.reason)
      : L.status === "invalid"
        ? esc(L.reason)
        : `Your ${TRIAL_DAYS}-day trial has finished.`;
    return `
      <div class="license-banner">
        ${App.icon("alertTri")}
        <div class="lb-text">
          <strong>Read-only.</strong> ${headline}
          Everything is still here to read, search and export — you just can't
          add or change anything until a key is in.
        </div>
        <button class="btn btn-primary btn-sm" data-license-goto>Add a key</button>
      </div>`;
  };

  L.mountBanner = function (el) {
    const b = el.querySelector("[data-license-goto]");
    if (b) b.addEventListener("click", () => App.navigate("settings"));
  };
})();
