/* ================= CORE DISPATCH =================
   The single entry point for a room-state snapshot. Called by the core listener
   and by the local tick, so it must be safe to run repeatedly on identical data. */
import { HOST_GRACE_MS } from "../config.js";
import { uid } from "../util.js";
import { srvNow } from "../clock.js";
import { state } from "../state.js";
import { coreTransaction } from "../net/store.js";
import { isPresent, isPresenceLoaded, absentFor, refreshAbsence } from "../net/presence.js";
import { renderLobbyScreen, syncSettingsForm } from "../ui/lobby.js";
import { enterGameScreenUI, renderTopbar, renderScoreboard, handleGameEnd } from "../ui/gamescreen.js";
import { handleChoosing, handleDrawing, handleRoundEnd } from "./phases.js";
import { pushChat } from "./chat.js";

export function onCoreSnapshot(core){
  state.core = core;
  state.isHost = (core.hostId === state.myId);

  refreshAbsence();
  maybeMigrateHost(core);

  if(core.phase === "lobby"){
    // Seed the settings form exactly once per lobby visit (fresh join, or "play
    // again"), never on the repeat ticks that follow.
    if(state.lastPhaseSeen !== "lobby") syncSettingsForm(core);
    state.lastPhaseSeen = "lobby";
    state.enteredGame = false;
    state.gameEndHandled = false;
    renderLobbyScreen(core);
    return;
  }

  state.lastPhaseSeen = core.phase;

  if(core.phase === "gameEnd"){
    handleGameEnd(core);
    return;
  }

  if(!state.enteredGame){
    state.enteredGame = true;
    enterGameScreenUI();
  }
  renderTopbar(core);
  renderScoreboard(core);

  if(core.phase === "choosing")      handleChoosing(core);
  else if(core.phase === "drawing")  handleDrawing(core);
  else if(core.phase === "roundEnd") handleRoundEnd(core);
}

/* ---------- host migration ----------
   hostId used to be written once at creation and never revisited, so when the host
   closed their tab the room became unusable: nobody could press "Start game" in the
   lobby, and "Play again" was hidden from everyone at the end.

   Only the successor writes, so N clients don't all pile on, and the transaction
   re-checks hostId so a simultaneous handover can't double-apply. The grace period
   means a host who simply refreshes keeps the role. */
async function maybeMigrateHost(core){
  if(state.migratingHost || !isPresenceLoaded()) return;
  if(!core.hostId || isPresent(core.hostId)) return;
  if(!absentFor(core.hostId, HOST_GRACE_MS)) return;

  // Everyone computes the same successor from the same roster order; only they write.
  const successor = (core.players||[]).find(p => isPresent(p.id));
  if(!successor || successor.id !== state.myId) return;

  state.migratingHost = true;
  const departedId = core.hostId;
  const res = await coreTransaction(cur=>{
    if(cur.hostId !== departedId) return undefined;   // somebody already handled it
    cur.hostId = state.myId;
    return cur;
  });
  state.migratingHost = false;

  if(res.committed){
    pushChat({id:uid(), type:"system", text:`${state.myName} is the host now.`, ts:srvNow()});
  }
}
