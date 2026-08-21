import { $ } from "../util.js";

export function showScreen(id){
  const el = $(id);
  // Idempotent: renderLobbyScreen() calls this on every core snapshot (players
  // joining, presence pings, settings edits), not just on real transitions. Without
  // this guard, the redundant class remove+add is a display:none->block toggle on
  // an element that never actually left, which restarts any fill-mode animation on
  // it — the lobby seal's one-time "stamp" entrance never got to settle, it just
  // kept snapping back to its oversized starting frame on every room activity.
  if(el && el.classList.contains("active") && document.querySelectorAll(".screen.active").length === 1) return;
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  if(el) el.classList.add("active");
}

/* Landing-form error line. Empty string hides it. */
export function showErr(msg){
  const e = $("landing-err");
  if(!e) return;
  e.textContent = msg;
  e.style.display = msg ? "block" : "none";
}

export function showConnBanner(msg){
  const b = $("conn-banner");
  if(!b) return;
  b.textContent = msg;
  b.style.display = "block";
}

export function hideConnBanner(){
  const b = $("conn-banner");
  if(b) b.style.display = "none";
}

/* Replaces the landing card entirely, for the two setup dead-ends. */
export function showSetupNote(html){
  const card = $("landing-card");
  if(card) card.innerHTML = `<div class="setup-note">${html}</div>`;
}
