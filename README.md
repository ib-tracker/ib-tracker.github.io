# IB Tracker — downloads & updates

This repo is **only** the distribution surface for the IB Study Tracker. It is
public because GitHub Pages serves it; the app's source lives elsewhere.

```
docs/
  index.html            the download page   → /ib-tracker-updates/
  .nojekyll             serve files as-is, no Jekyll processing
  updates/
    version.json        the manifest installed apps poll once a day
    ib-tracker-*.zip    update payloads (index.html, css/, js/)
```

Served at `https://captaimrishi-ctrl.github.io/ib-tracker-updates/`.

## Publishing a release

Don't hand-edit anything in `docs/updates/`. Both files are generated from the
source repo, which stamps the payload's SHA-256 into the manifest — they have to
match or every install rejects the update:

```bash
bash packaging/publish-pages.sh     # run in the source repo
```

That stages both files here. Review the diff, then commit and push.

**The manifest is the trigger.** Publishing `version.json` is the moment every
installed app starts downloading the payload it names, so the `.zip` must be
committed in the same push (or before it) — never point the manifest at a file
that isn't live yet.

Keep old payload `.zip`s. Only the newest is strictly needed, but leaving them
makes a rollback a one-file change.

## The `.dmg` goes to Releases, not here

The installer is ~110 MB, well past what belongs in a git repo. Attach it to a
[GitHub Release](https://github.com/captaimrishi-ctrl/ib-tracker-updates/releases)
— that's where the download page points.

## This host is load-bearing

`captaimrishi-ctrl.github.io` is baked into the app's **signed** bundle, and the
app refuses any payload served from anywhere else. Renaming this repo or moving
the account breaks auto-updates for every existing install, and the only fix is
having each person download a new build by hand. Treat the URL as permanent.
