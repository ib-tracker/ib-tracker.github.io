/* version.js — the single source of truth for the app version and where
   updates come from. Bump the version HERE and nowhere else: the packaging
   scripts read this file to stamp the .app bundle and to name a release, and
   the desktop shell reads it (from inside the signed bundle) to decide where
   it is allowed to download from.

   `updateHost` is the site that serves updates — a bare hostname, no scheme
   and no trailing slash ("ibtracker.app"). While it is empty the update
   checker stays completely idle: no network calls, no UI.

   Because this file lives inside the SIGNED bundle, the host here is what
   pins downloads. A manifest is just JSON on the internet — it can ask us to
   install anything — so the payload it names must sit on `payloadHost`
   (or `updateHost` when that is blank) or the shell refuses it.

   See packaging/RELEASING.md. */
(function () {
  window.APP_BUILD = {
    version: "1.6.3",

    // Served by GitHub Pages out of the ib-tracker/ib-tracker.github.io repo.
    // The repo is named after the org, which makes it an ORG ROOT SITE: it is
    // served at the domain root, so the paths below carry no project prefix.
    updateHost: "ib-tracker.github.io",
    payloadHost: "",                         // optional: separate CDN/bucket host for the .zip
    manifestPath: "/updates/version.json",
    downloadPath: "/",                       // page to send people to for a full installer
  };
})();
