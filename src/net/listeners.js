/* ================= REALTIME SUBSCRIPTIONS =================
   Attached once per session, after we know we're on the room's roster. */
import { db } from "../firebase.js";
import { CHAT_KEEP, TICK_MS, FLUSH_MS, ROOM_BEAT_MS } from "../config.js";
import { srvNow } from "../clock.js";
import { state, amIDrawerNow } from "../state.js";
import { coreKey, chatListKey, drawKey, presenceKey, describeDbError } from "./store.js";
import { onPresenceSnapshot } from "./presence.js";
import { onCoreSnapshot } from "../game/engine.js";
import { renderChat } from "../ui/gamescreen.js";
import { redrawAllStrokes, flushStrokesIfDirty } from "../ui/canvas.js";
import { hideConnBanner, showConnBanner } from "../ui/screens.js";

export function attachRoomListeners(){
  if(state.listenersAttached) return;
  state.listenersAttached = true;

  const onListenerError = (label)=>(err)=>{
    console.error(`${label} listener error:`, err);
    showConnBanner("Lost connection to the game — " + describeDbError(err));
  };

  db.ref(coreKey()).on("value", snap=>{
    hideConnBanner();
    const core = snap.val();
    if(core) onCoreSnapshot(core);
  }, onListenerError("core"));

  // Chat is an append-only list read with limitToLast, so two people typing at
  // once can't overwrite each other's message. forEach preserves push-key order.
  db.ref(chatListKey()).limitToLast(CHAT_KEEP).on("value", snap=>{
    const out = [];
    snap.forEach(child=>{ out.push(child.val()); });
    renderChat(out);
  }, onListenerError("chat"));

  db.ref(drawKey()).on("value", snap=>{
    const d = snap.val();
    if(!d) return;
    if(amIDrawerNow()) return;                                  // drawer paints locally
    if(!state.core || d.roundId !== state.core.roundId) return;  // stale round
    redrawAllStrokes(d.strokes || []);
  }, onListenerError("draw"));

  db.ref(presenceKey()).on("value", snap=>{
    onPresenceSnapshot(snap.val());
  }, onListenerError("presence"));

  state.tickTimer  = setInterval(()=>{ if(state.core) onCoreSnapshot(state.core); }, TICK_MS);
  state.flushTimer = setInterval(flushStrokesIfDirty, FLUSH_MS);

  // Marks the room alive while people are still in it, so a lobby or a long
  // drawing round — neither of which writes to core — isn't mistaken for
  // abandoned and swept. Only the host writes: host migration guarantees exactly
  // one present player holds the role, so this stays one write a minute per room
  // however many are playing. A room everybody has left stops beating, which is
  // precisely what lets it age out.
  state.beatTimer = setInterval(()=>{
    if(!state.isHost || !state.core) return;
    db.ref(`${coreKey()}/lastActiveAt`).set(srvNow());
  }, ROOM_BEAT_MS);

  window.addEventListener("beforeunload", ()=>{
    clearInterval(state.tickTimer);
    clearInterval(state.flushTimer);
    clearInterval(state.beatTimer);
  });
}
