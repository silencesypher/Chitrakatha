/* ================================================================
   THE ONLY FILE YOU NEED TO EDIT TO GET THE GAME RUNNING.

   Paste your Firebase web config below. Get it from:
   Firebase console → Project settings → your web app.
   Until apiKey is filled in, the game shows a setup message instead
   of the landing form.
   ================================================================ */
export const firebaseConfig = {
  apiKey: "AIzaSyCfPgdlAHcd4mQbiTjE2PdqR09N-EfFEiY",
  authDomain: "ancient-tales--draw-n-guess.firebaseapp.com",
  databaseURL: "https://ancient-tales--draw-n-guess-default-rtdb.firebaseio.com",
  projectId: "ancient-tales--draw-n-guess",
  storageBucket: "ancient-tales--draw-n-guess.firebasestorage.app",
  messagingSenderId: "77623155131",
  appId: "1:77623155131:web:76c61dbeb208ff0fcacc9e"
};

export const CONFIG_READY =
  !!(firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes("PASTE"));

/* ================= GAMEPLAY TUNABLES ================= */
export const CHOOSE_MS       = 16000;  // how long the drawer has to pick a word
export const ROUND_END_MS    = 4500;   // how long the round-end banner stays up
export const DRAWER_GRACE_MS = 7000;   // absence before we give up on a drawer
export const HOST_GRACE_MS   = 9000;   // absence before the host role is handed on
export const CHAT_KEEP       = 60;     // messages rendered in the log
export const TICK_MS         = 500;    // local state-machine / countdown tick
export const FLUSH_MS        = 350;    // how often the drawer publishes strokes

/* ---- room lifetime ----
   A room untouched for ROOM_IDLE_MS is considered closed: the next client to
   touch it deletes it, and its five-letter code goes back into circulation.

   "Touched" means any change to core — every coreTransaction stamps lastActiveAt,
   so no mutation can forget to — plus a heartbeat the host writes every
   ROOM_BEAT_MS while people are still in the room. The heartbeat is the part that
   matters: a group sitting in the lobby, or a drawer midway through a long round,
   writes to the chat and draw nodes but not to core, and would otherwise be reaped
   out from under themselves. Only the host beats, so the cost is one write a
   minute per room no matter how many players are in it. */
export const ROOM_IDLE_MS    = 2 * 60 * 60 * 1000;   // 2 hours with nobody in it
export const ROOM_BEAT_MS    = 60 * 1000;            // host keep-alive interval

/* The host picks a script for the room specifically — देवनागरी to make people
   practise it, IAST/English if they'd rather not deal with the on-screen
   keyboard — so a guess typed in the other script no longer counts, even if
   it's a correct spelling of the word in that script. Flip to true to accept
   either script regardless of the room's setting. */
export const ACCEPT_EITHER_SCRIPT = false;

/* Canvas backdrop. The eraser paints with this and the flood-fill tool matches
   against it, so it must stay a flat colour and must equal the CSS --sheet value
   used on .board-frame. Board pixel size lives in the <canvas>
   width/height attributes in index.html. */
export const BG_COLOR = "#f2ebd8";
