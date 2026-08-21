/* ================= ENTRY POINT =================
   Loaded as <script type="module">, which is deferred, so the DOM is already
   parsed by the time this runs. Import order below is the dependency order.

   The modules no longer wire DOM handlers as a side effect of being imported —
   each UI module exports an init function that this file calls, so the startup
   sequence is readable in one place. */
import { CONFIG_READY } from "./config.js";
import { db, firebaseInitError } from "./firebase.js";
import { escapeHtml } from "./util.js";
import { attachClock } from "./clock.js";
import { initLanding } from "./ui/landing.js";
import { initLobby } from "./ui/lobby.js";
import { initEndScreen, initMobileUI } from "./ui/gamescreen.js";
import { initGuessForm } from "./game/chat.js";
import { showSetupNote } from "./ui/screens.js";

/* Log unexpected runtime errors instead of letting the page silently die. */
window.addEventListener("error", (e)=>{ console.error("Unhandled error:", e.error || e.message); });
window.addEventListener("unhandledrejection", (e)=>{ console.error("Unhandled promise rejection:", e.reason); });

async function boot(){
  if(!CONFIG_READY){
    showSetupNote(`<strong>One step left.</strong><br><br>
      This game needs a free Firebase project to sync players. Open
      <code>src/config.js</code>, and paste your project's values into
      <code>firebaseConfig</code> — then reload this page.`);
    return;
  }
  if(firebaseInitError || !db){
    showSetupNote(`<strong>Couldn't connect to Firebase.</strong><br><br>
      ${escapeHtml(firebaseInitError ? firebaseInitError.message : "Unknown error.")}<br><br>
      Check that the values in <code>src/config.js</code> match what Firebase gave
      you (no missing quotes or commas), then reload.`);
    return;
  }

  attachClock(db);
  initLanding();
  initLobby();
  initEndScreen();
  initGuessForm();
  initMobileUI();

  // No session resume: a refresh lands on the landing form and you rejoin by
  // entering the room code again. See the note in state.js for what happens to
  // the roster entry the refreshed tab leaves behind.
}

boot();
