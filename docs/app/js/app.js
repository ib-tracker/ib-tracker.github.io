/* app.js — bootstrap */
(function () {
  "use strict";
  const App = window.App;

  App.applyTheme();
  App.subscribe(() => App.render());
  window.addEventListener("hashchange", () => App.renderNow());

  if (!location.hash) location.replace("#/dashboard");

  // Settle the license before the first paint, so the UI never briefly offers
  // edits it is about to refuse. It's one signature check — well under a
  // millisecond — and load() swallows its own errors, but the .catch stays as
  // a belt-and-braces guarantee: if this promise never settled, bootOK() below
  // would never fire and the shell would roll back a perfectly good update.
  App.license.load().catch(() => {}).then(() => {
    // This writes, so it runs AFTER the license has settled — read-only now
    // fails closed, and doing it earlier would have slipped past the gate (the
    // backfill is a migration and opts out with {system}).
    //
    // Guarded: it walks saved data that may have arrived from an import, and is
    // not important enough to cost a boot. An exception here would skip bootOK()
    // below, and two of those in a row make the shell roll back an update that
    // was in fact fine.
    //
    // Grade-trend points are NOT recorded here. They are recorded by
    // saveGrade/deleteGrade, so the series tracks when grades changed rather
    // than when the app happened to be opened.
    try { App.backfillSubjectLevels(); } catch (e) { console.error(e); }
    // A clock left running overnight would otherwise resume as if no time had
    // passed and offer to log the whole night. Guarded like the backfill above:
    // a failure here must not cost a boot.
    try { App.timer.dropAbandoned(); } catch (e) { console.error(e); }
    App.renderNow();

    // Tell the desktop shell this build booted cleanly (it rolls a bad update
    // back otherwise), then look for a newer version in the background.
    if (window.ibUpdater && window.ibUpdater.bootOK) window.ibUpdater.bootOK();
    App.updates.boot();
  });
})();
