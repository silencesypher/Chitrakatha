# Citrakathā — project layout

A drawing-and-guessing game over Firebase Realtime Database. No build step, no
bundler, no `npm install` — native ES modules loaded straight from `src/`.

## Running it

Modules are fetched over HTTP, so serve the folder rather than opening the file
from disk:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` via `file://` will fail with a CORS error on the module
imports. This isn't a real constraint: the game is multiplayer across devices, so
it has to be served from a URL your friends can reach anyway.

To play: paste your Firebase web config into `src/config.js`, and make sure the
Realtime Database rules allow read/write on the `citrakatha:*` keys.

## Tests

```bash
node test/run.mjs      # 53 behavioural assertions on the pure game logic
node test/analyse.mjs  # syntax, import resolution, cycles, reachability
node test/smoke.mjs    # imports the whole graph + boots against a stubbed DOM
node test/markup.mjs   # 120 assertions: HTML/JS contract + mobile guards
node test/deploy.mjs   # 77 assertions: security rules + Vercel config
```

**Deploying?** See `DEPLOY.md`. Read the first section before you put this on a
public URL — the database rules are the only thing protecting your Firebase project,
and `database.rules.json` here is the safe starting set.

`test/markup.mjs` is the one to run after touching the HTML or CSS. The JS reaches
into the DOM by string id, so a renamed element fails silently at runtime — that
test walks all 81 `$("id")` references and checks each against the markup. It also
guards the mobile fixes that are easy to undo by accident, above all the 16px
minimum on inputs (anything smaller and iOS zooms the page whenever the guess box
is focused).

`test/run.mjs` imports the real modules directly — no browser stub, no bundler.
That's only possible because the game rules are free of DOM and Firebase
dependencies, which is the main thing this layout buys.

## Layout

```
index.html               markup + <script type="module" src="src/main.js">
citrakatha.css           styles
src/
  config.js              ← THE ONLY FILE YOU NEED TO EDIT. Firebase keys + tunables.
  main.js                entry point: config gate, wiring, session resume
  firebase.js            the only module that touches the global `firebase` SDK
  state.js               shared mutable state, derived reads, session persistence
  util.js                uid, room codes, shuffle, escapeHtml  (pure)
  clock.js               srvNow() backed by /.info/serverTimeOffset
  data/
    words.js             the 151-word bank  (pure data)
    keyboards.js         IAST + Devanagari on-screen keyboards  (pure data)
  net/
    store.js             room paths, reads/writes, coreTransaction
    presence.js          who is connected, and for how long they've been gone
    listeners.js         realtime subscriptions + board hydration
  game/
    matching.js          forgiving guess matching  (pure)
    wordpool.js          difficulty-aware word selection  (pure)
    rounds.js            turn advance, masking, round-end condition  (pure)
    phases.js            choosing / drawing / roundEnd handlers
    engine.js            core dispatch + host migration
    chat.js              chat push + guess submission and scoring
  ui/
    screens.js           screen switching, error and connection banners
    landing.js           create room / join room
    lobby.js             lobby render, settings, start game
    canvas.js            drawing surface, tools, stroke publishing
    gamescreen.js        keyboard bar, topbar, scoreboard, chat, final standings
test/
  run.mjs  analyse.mjs  smoke.mjs
```

## Dependency rules

Two rules keep the tree honest. `test/analyse.mjs` enforces the first
mechanically and will fail the build if either is broken.

1. **No cycles.** Dependencies point one way: `data` → `util`/`clock` → `state` →
   `net` → `game` → `ui` → `main`. Where a UI module and a game module both need
   something, it moves down into `state.js` or `util.js` rather than sideways.

2. **The pure modules stay pure.** `matching.js`, `wordpool.js`, `rounds.js`,
   `util.js` and `clock.js` must never import `firebase.js`, touch `document`, or
   read `state`. This is why `clock.js` takes `db` as an argument to
   `attachClock(db)` instead of importing it — one import would drag the whole
   Firebase SDK into the test process and make the game rules untestable.

Everything a transaction runs (`advanceToNextTurn`, `applyWordChoice`, `pickWords`)
lives in the pure layer, because RTDB may re-run an update function several times
before one attempt commits — so those functions must be synchronous and free of
side effects.

## Where shared state lives

`state.js` exports one mutable `state` object that modules mutate directly. This
is deliberate: ES module bindings are read-only to importers, so a plain
`export let roomCode` can't be assigned from another file, and the alternative is
a setter for every field.

Local drawing state (the stroke array, current tool, redo stack) deliberately does
**not** live there — `ui/canvas.js` owns it privately and exposes
`resetLocalBoard()`, `hydrateStrokes()`, `redrawAllStrokes()` and
`flushStrokesIfDirty()` instead.

## Mobile

Designed to fit one phone screen with no page scrolling — only the chat log
scrolls. Verified to fit on a 360x640 Android through to a Pixel 7, for both the
drawer (who gets a two-row toolbar) and guessers (who don't).

Layout notes:

- **The canvas coordinate space stays 800x500 on every device, deliberately.**
  Strokes travel over the wire as canvas coordinates, so resizing the buffer per
  screen would distort what other players see. Only the CSS display size adapts,
  which is why a portrait phone gets a wide, short canvas (~62% of viewport width
  in height) and why the chrome around it had to become genuinely compact.
  Landscape roughly doubles the drawing area — the drawer sees a one-line hint
  saying so.
- **No devicePixelRatio scaling**, on purpose. An 800px backing store shown across
  ~360 CSS px is already oversampled about 2.2x. At DPR 3 that leaves a mild
  1.35-1.45x upscale, barely visible on hand-drawn strokes and far cheaper than
  doubling the pixels the flood-fill tool rescans on every repaint.
- **The script keyboard is a bottom sheet on phones**, toggled by the button left
  of the guess box, and hidden entirely from the drawer (who never types a guess).
  Inline as before on desktop. 62 Devanagari keys would otherwise fill the screen.
- **The scoreboard collapses to a scrollable strip of chips** on phones.
- **Two breakpoints**: `max-width:720px` for portrait, and
  `max-width:900px and max-height:540px and orientation:landscape`, which returns
  to two columns because a full-width canvas would be taller than the viewport.
- Pinch-zoom is *not* disabled. `user-scalable=no` is an accessibility regression
  and modern iOS ignores it; the auto-zoom-on-focus problem is solved by the 16px
  input rule instead.

## Deploying

Two targets, because hosting and the database are separate services:

```bash
firebase deploy     # database rules  (firebase.json is database-only on purpose)
vercel --prod       # the site        (vercel.json: no build step, root rewrite)
```

`vercel` on its own gives a preview URL — worth using before `--prod` so you can
test a change with two real players without touching the live site. Full
instructions, the Vercel gotchas, and the iterate-and-redeploy loop are in
`DEPLOY.md`.

## Known limitations

Data-model problems, not bugs in any one file:

- **`core.word` is broadcast to every client.** Any player can read the answer in
  DevTools; the masking is cosmetic. Needs a server, or a drawer-only path guarded
  by security rules.
- **Scores are self-reported.** The transactions in `store.js` make concurrent
  writes *correct*, not *trustworthy*.
- **Strokes are re-uploaded as one whole array every 350 ms** (O(n²) traffic).
  Wants an append-only log with `push()` + `child_added`. Only
  `canvas.js:publishStrokes` and the draw listener in `listeners.js` would change.
- **Room keys are flat** (`citrakatha:CODE:core`), which blocks per-room security
  rules. `database.rules.json` confines the namespace, blocks room enumeration and
  caps string sizes, but it cannot express "only the current drawer may write
  strokes" — that needs anonymous auth plus a nested `rooms/{code}/…` layout.
  `net/store.js` is the only file that would change.
- **Rooms are never deleted.** Add a `lastActive` timestamp and prune.
- **One accessibility gap left**: `.guessform.disabled` uses
  `pointer-events:none`, which does not stop keyboard tabbing into a disabled
  input. It needs the real `disabled` attribute. (Swatches, sizes, keys and tool
  buttons are now real buttons with labels; focus rings and reduced-motion are in.)
- **UX gaps** vs skribbl: no countdown during the choosing phase, no "close guess"
  feedback, correct guessers are locked out of chat and still see the masked word,
  no "3 of 5 have guessed" progress, no way for the drawer to skip a word, and
  "Round 1 / 3" doesn't convey that five players means fifteen turns.
