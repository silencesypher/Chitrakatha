# Push checklist

Ordered, and the order matters. Steps 1–2 are one-time; 3 onwards is your routine.

---

## 0. What changed from the zip you sent

All 24 source files were byte-identical to the last version handed over — nothing
had drifted. Three structural things were fixed, and seven files were missing:

| Fixed | Was | Now |
|---|---|---|
| Wrapper folder | everything inside `v2/` | contents at the root |
| Test location | `src/test/` | `test/` (sibling of `src/`) |
| Entry filename | `citrakatha.html` | `index.html` |

Added: `vercel.json`, `.vercelignore`, `firebase.json`, `.firebaserc`,
`database.rules.json`, `test/deploy.mjs`, `.gitignore`, `DEPLOY.md`.

The tests could not run from `src/test/` at all — they resolve the project root as
one level up from themselves, so from `src/test/` they were looking for
`src/index.html` and `src/src/data/words.js`. Both crashed with ENOENT.

---

## 1. Close the security hole (do this first, on its own)

Your database has been world-readable and world-writable since launch. This is
independent of the code update and safe against the version that is live right now.

```bash
npm install -g firebase-tools
firebase login
cd path/to/this/folder
firebase deploy
```

`firebase.json` here contains only a `database` block, so this command ships the
rules and nothing else — it cannot accidentally publish a competing copy of the site
to `*.web.app`.

Verify in the Firebase console under Realtime Database → Rules that the new rules are
live before moving on.

---

## 2. Wipe the old rooms

Old and new clients cannot share a room — four wire formats changed incompatibly
(chat, presence, wordChoices, settings). Rooms are ephemeral, so there is nothing to
preserve.

Firebase console → Realtime Database → Data → delete every top-level key beginning
`citrakatha:`.

---

## 3. Get it into GitHub

You have been uploading through the web UI, one file at a time. That does not work
for 36 files across nested folders. Use git:

```bash
cd path/to/this/folder
git init
git remote add origin https://github.com/GamingChamp-Hub/citrakatha.git
git fetch origin
git checkout -b main
```

Then remove the old single-file version and commit everything:

```bash
git rm --cached index.html 2>/dev/null || true   # only if the old one is tracked
git add -A
git commit -m "Replace single-file version with modular ES-module build"
git push -u origin main --force
```

`--force` because the history diverges from the old web-UI commits. If you would
rather keep that history, `git pull --rebase origin main` first and resolve the
`index.html` conflict in favour of the new file.

**GitHub Desktop is a fine alternative** if the CLI is unwelcome: add this folder as
a local repository, publish it to the existing `citrakatha` repo, and commit.

---

## 4. Vercel needs no reconfiguration

Your existing project already watches `main` and has Framework Preset "Other". It
will pick up the commit within seconds and redeploy `citrakatha.vercel.app` in about
20–30 seconds. `vercel.json` now sets the build settings explicitly so Vercel cannot
guess wrong.

Nothing to re-link, no new project, same URL.

---

## 5. First load after deploying

Tell everyone to hard-refresh once: **Ctrl/Cmd + Shift + R**, or on iOS close the tab
and reopen. `vercel.json` sends `no-cache` so this should not be needed again, but the
currently cached copy predates that header.

Then check, in this order:

- [ ] `citrakatha.vercel.app` loads the landing screen
- [ ] Browser console is clean — a MIME-type error on `src/main.js` means routing is
      wrong; a `PERMISSION_DENIED` means step 1 went wrong
- [ ] Create a room, join from your phone, play one round
- [ ] Type `Rama` for `Rāma` and confirm it is accepted (proves the new matcher is live)
- [ ] Refresh mid-round and confirm the drawing is still there (proves board hydration)

---

## 6. Routine, from now on

```bash
node test/run.mjs && node test/markup.mjs && node test/analyse.mjs \
  && node test/smoke.mjs && node test/deploy.mjs      # all five, under a second

python3 -m http.server 8000        # check locally at http://localhost:8000

git add -A && git commit -m "..." && git push        # Vercel deploys automatically
```

Changed the rules or `net/store.js` paths? `firebase deploy` as well — those are not
part of the git push.

Want a throwaway URL before touching production? Push to a branch instead of `main`;
Vercel builds a preview for it automatically and gives you a unique link you can open
on your phone.
