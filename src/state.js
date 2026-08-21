/* ================= SHARED MUTABLE STATE =================
   This game is one big distributed state machine, so rather than scatter a dozen
   module-level `let`s across files (and then need setters to cross the module
   boundary, since ES module bindings are read-only to importers), all the
   cross-cutting mutable state lives on one object that everyone mutates directly.

   Local-only drawing state (strokes, current tool, redo stack) deliberately does
   NOT live here — it belongs to ui/canvas.js, which exposes functions instead. */

export const state = {
  /* identity */
  myId: null,
  myName: "",
  roomCode: "",
  isHost: false,

  /* last known synced snapshot of the room (was `cachedCore`) */
  core: null,

  /* per-round local bookkeeping */
  roundIdSeen: null,        // was currentRoundIdSeen
  choiceMade: false,        // was choiceMadeLocally

  /* screen lifecycle */
  enteredGame: false,       // was enteredGameScreen
  gameEndHandled: false,
  lastPhaseSeen: null,
  gameLanguage: "iast",

  /* re-entrancy guards: the 500ms tick can fire a handler again before the
     previous one's write has landed, so these stop duplicate transactions */
  migratingHost: false,
  skippingDrawer: false,
  listenersAttached: false,

  /* intervals, cleared on unload */
  tickTimer: null,
  flushTimer: null,
  beatTimer: null           // host-only room keep-alive; see ROOM_BEAT_MS
};

/* ---------- derived reads ---------- */
export function currentPhase(){ return state.core ? state.core.phase : null; }
export function amIDrawerNow(){ return !!(state.core && state.core.drawerId === state.myId); }

/* There is deliberately no session persistence here. A refresh used to stash
   {roomCode, myId, myName} in sessionStorage and silently rejoin the room on the
   next load; that was removed on purpose, so a refresh now returns you to the
   landing form and you rejoin by entering the code again. The roster entry left
   behind is not orphaned — presence drops the old tab, and landing.js already
   lets a join reclaim a name whose previous tab is no longer connected, carrying
   the same id, score and turn order across. */
