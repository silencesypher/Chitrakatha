# Deploying Citrakathā

Hosting is on **Vercel**; the database stays on **Firebase**. That means two
deploys, and only one of them is about hosting.

```
your files ──▶ Vercel        (the site: HTML, CSS, ES modules)
database   ──▶ Firebase RTDB (rooms, strokes, chat — and the rules protecting them)
```

There's no build step, so Vercel just publishes the folder.

---

## Read this first: your database is currently wide open

Everything so far has run on `localhost` with permissive Realtime Database rules.
That was fine there. The moment the game is on a public URL, anyone can view source,
read `databaseURL` out of `src/config.js`, and talk to your database directly — read
every room, rewrite scores, or wipe it.

**Moving hosting to Vercel does not change this.** The database is still Firebase,
still reachable from anywhere, still governed only by its rules. Vercel has no say in
it. So `firebase deploy` is not optional — it's the step that actually protects
anything.

The Firebase **API key is not the problem**. Web API keys are public identifiers by
design, and there's no way to hide one in a browser app. The rules are the only thing
between your database and the internet.

`database.rules.json` is a safe starting set. It does three things:

1. **Confines access to the game's own namespace** — only keys matching
   `citrakatha:<5 chars>:(core|draw|chat|presence)` are readable or writable, so
   nobody can dump arbitrary data into your project.
2. **Blocks room enumeration** — the root has no `.read`, so nobody can list every
   room. Reaching one means knowing its 5-character code, out of ~33 million.
3. **Caps string sizes** on player names, scores and chat messages, which stops the
   obvious spam and payload bloat.

`node test/deploy.mjs` checks these rules against 10,000 real keys built with the
app's own path builders, so the pattern can't be rejecting something the game
actually writes.

### What these rules still can't do

They cannot stop cheating, because that requires knowing *who* is writing, and there
is no authentication:

- Anyone in a room can still read `core.word` and win every round.
- Anyone can still write any score to any player.
- Anyone who knows a room code can still vandalise that room.

Fixing that needs anonymous auth plus a nested key layout (`rooms/{code}/…` instead
of `citrakatha:{code}:core`), so rules can say *only the current drawer may write
strokes*. `net/store.js` is the only file that would change. Until then, treat this
as an honour-system game among people you know — a perfectly reasonable thing for it
to be.

---

## Deploy

### 1. The database rules (do this once, first)

```bash
npm install -g firebase-tools
firebase login
cd path/to/citrakatha
firebase deploy
```

`firebase.json` here contains **only** a `database` block, deliberately. If it also
configured hosting, a bare `firebase deploy` would quietly publish a second copy of
the site at `*.web.app` that then drifts out of sync with your Vercel deployment.
With hosting removed, `firebase deploy` does exactly one thing: ship the rules.

### 2. The site

```bash
npm install -g vercel
vercel login

cd path/to/citrakatha
vercel              # → a preview URL
vercel --prod       # → your production URL
```

The first run asks a few setup questions:

| Prompt | Answer |
|---|---|
| Set up and deploy? | **yes** |
| Which scope? | your account |
| Link to existing project? | **no** (first time) |
| Project name | `citrakatha`, or anything |
| In which directory is your code? | `./` |
| Want to modify build settings? | **no** — `vercel.json` already sets them |

Or connect the Git repo at [vercel.com/new](https://vercel.com/new) and it deploys on
every push, with a unique preview URL per branch and pull request. That's the better
setup if you're iterating.

---

## What's in vercel.json, and why

Every line prevents a specific failure. `test/deploy.mjs` asserts each one.

- **No rewrites at all.** The entry file is `index.html`, which Vercel already
  serves at `/`. The earlier version of this project called it `citrakatha.html` and
  needed a `"/"` rewrite to map the root; renaming removed the need for any routing
  config, which is one less thing that can go wrong.

- **No catch-all rewrite.** A `"/(.*)" → "/index.html"` rule — the standard SPA
  recipe — would make `src/main.js` return the HTML page, and every import would die
  on a MIME-type error. Don't add one; there's no client-side router here.

- **`framework: null`, `buildCommand: null`, and no `package.json`.** There is nothing
  to build. Without these, Vercel may detect a framework and run a build that fails.

- **`cleanUrls: false`.** With it on, Vercel redirects `/index.html` to `/index`,
  which is harmless but confusing when you are reading logs.

- **`Cache-Control: no-cache`.** This matters most while you're making changes: with
  native ES modules each file is fetched separately, so under long caching a redeploy
  serves a *mix* of new and stale modules, which fails in baffling ways. See "Going
  to production" for when to change it.

`.vercelignore` keeps `test/`, the docs, and — importantly — `database.rules.json`
and the Firebase config out of the deployed site. No reason to serve your rules file
over HTTP.

---

## Does RTDB work from a vercel.app domain?

Yes. Realtime Database access is governed by rules, not by origin, and
`firebaseio.com` accepts cross-origin connections. You don't need to change
`authDomain` in `src/config.js`, and there's no CORS setup.

One thing for later: **if you add anonymous auth**, add your Vercel domain under
Firebase console → Authentication → Settings → Authorized domains. Auth does check
origin, even though the database doesn't.

---

## The loop for making changes

```bash
# 1. edit

# 2. test  (all five run in under a second)
node test/run.mjs        # 53  game logic
node test/markup.mjs     # 120 HTML/JS contract + mobile guards
node test/analyse.mjs    #     imports, cycles, reachability
node test/smoke.mjs      #     whole graph boots
node test/deploy.mjs     # 77  rules + hosting config

# 3. see it locally
python3 -m http.server 8000     # http://localhost:8000

# 4. real URL, not production
vercel                          # unique preview URL per deploy

# 5. ship
vercel --prod
```

**Use `vercel` before `vercel --prod`.** Every preview gets its own permanent URL you
can open on your phone and send to one other person, so you can test a change with
two real players without disturbing anyone on the live site. For a multiplayer game
that's Vercel's most useful feature.

Rules changed? Separate deploy: `firebase deploy`.

### Which test after what

- Touched `src/game/**` → `run.mjs`
- Touched `index.html` or `.css` → `markup.mjs`. It catches the silent failures:
  a renamed id the JS still reaches for, or an input `font-size` dropping under 16px
  and bringing iOS auto-zoom back.
- Added or moved a module → `analyse.mjs`
- Changed `vercel.json` or the rules → `deploy.mjs`

### If you change the room-key format

`net/store.js` builds every path and `database.rules.json` has to match. Change one
without the other and every write fails with a permission error — which looks like a
network problem and isn't. `deploy.mjs` catches exactly this: it builds keys with the
real path builders and tests them against the real rule pattern.

---

## Going to production

Once you've stopped iterating, tighten the cache header in `vercel.json`:

```json
"headers": [
  { "source": "/(.*)\\.(js|css)",
    "headers": [{ "key": "Cache-Control", "value": "public, max-age=604800" }] },
  { "source": "/(.*)\\.html",
    "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }
]
```

HTML stays `no-cache` so it can point at new assets. But with no build step there is
no content hashing in filenames, so a week-long cache means a week-long stale client.
Either keep `no-cache` on `.js`, or bump a version string on the entry import in the
HTML (`src/main.js?v=2`) each time you deploy.

Two more things before sharing the link widely:

- **Set a Firebase budget alert.** The Spark (free) plan can't generate a bill, but on
  Blaze an open database is an open meter.
- **Add a `lastActive` timestamp and prune old rooms.** Nothing deletes rooms today,
  so the database grows forever. Not urgent at small scale, but it never gets easier
  to add.

---

## If you'd rather use Firebase Hosting after all

One tool for both halves. Add this back to `firebase.json`:

```json
"hosting": {
  "public": ".",
  "ignore": ["firebase.json", ".firebaserc", "database.rules.json",
             "README.md", "DEPLOY.md", "test/**", "**/.*", "**/node_modules/**"],
  "headers": [{ "source": "**/*.@(html|js|css)",
    "headers": [{ "key": "Cache-Control", "value": "no-cache, max-age=0" }] }]
}
```

Then `firebase deploy` ships site and rules together. Note that `test/deploy.mjs`
asserts `hosting` is *absent*, so flip that assertion if you switch. And if you ever
run `firebase init hosting`, answer **no** to "configure as a single-page app" — it
adds the catch-all rewrite that breaks module loading.
