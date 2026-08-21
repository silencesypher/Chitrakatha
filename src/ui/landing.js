import { CONFIG_READY } from "../config.js";
import { $, uid, genRoomCode } from "../util.js";
import { srvNow } from "../clock.js";
import { state } from "../state.js";
import { db } from "../firebase.js";
import {
  sGetResult, sSet, sRemove, claimIfFree, describeDbError,
  coreKey, drawKey, chatKey, presenceKey
} from "../net/store.js";
import { isRoomClosed } from "../game/rooms.js";
import { markPresent, isPlayerPresentOnce } from "../net/presence.js";
import { attachRoomListeners } from "../net/listeners.js";
import { showErr } from "./screens.js";

function setLandingBusy(busy){
  ["btn-create","btn-join"].forEach(id=>{
    const b = $(id);
    if(!b) return;
    b.disabled = busy;
    b.style.opacity = busy ? .6 : 1;
  });
}

/* Rolls a code and claims it atomically, so an unlucky creator can never evict a
   room that's mid-game. If another tab took the code a millisecond earlier the
   claim aborts and we try a new one. */
async function claimRoomCode(core, maxTries = 10){
  for(let i = 0; i < maxTries; i++){
    const code = genRoomCode();
    // A code whose room has gone idle is fair game to take over — that is what
    // keeps the code space from filling up with games nobody will return to.
    const res = await claimIfFree(coreKey(code), core, cur=>isRoomClosed(cur, srvNow()));
    if(res.error) return {ok:false, error:res.error};
    if(res.ok) return {ok:true, code};
  }
  return {ok:false, error:new Error("Every code we tried was already taken. Try again.")};
}

export function initLanding(){
  const how = $("how-toggle");
  if(how) how.onclick = ()=>{
    const b = $("how-body");
    b.style.display = b.style.display === "block" ? "none" : "block";
  };

  const create = $("btn-create");
  if(create) create.onclick = async ()=>{
    if(create.disabled) return;
    if(!CONFIG_READY){ showErr("Firebase isn't configured yet — see the note above."); return; }
    const name = $("in-name").value.trim();
    if(!name){ showErr("Enter your name first."); return; }
    showErr("");
    setLandingBusy(true);

    state.myName = name;
    state.myId = uid();
    state.isHost = true;
    const core = {
      players:[{id:state.myId, name:state.myName, score:0}],
      hostId: state.myId,
      settings:{rounds:3, drawSeconds:80, difficulty:"mixed", language:"iast"},
      started:false,
      phase:"lobby",
      createdAt: srvNow()
    };

    const claim = await claimRoomCode(core);
    if(!claim.ok){
      showErr("Couldn't create the room — " + describeDbError(claim.error));
      setLandingBusy(false);
      return;
    }
    state.roomCode = claim.code;
    await sSet(drawKey(), {roundId:null, strokes:[]});
    await sRemove(chatKey());
    // The code may have been recycled off a closed room, whose side nodes are not
    // covered by the core claim. Presence especially: a leftover entry would make
    // a player from the old game read as present here, and presence drives host
    // migration and turn skipping.
    await sRemove(presenceKey());
    markPresent(state.myId);
    attachRoomListeners();
    // no need to re-enable: attachRoomListeners moves us off the landing screen
  };

  const join = $("btn-join");
  if(join) join.onclick = async ()=>{
    if(join.disabled) return;
    if(!CONFIG_READY){ showErr("Firebase isn't configured yet — see the note above."); return; }
    const name = $("in-name").value.trim();
    const code = $("in-code").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if(!name){ showErr("Enter your name first."); return; }
    if(!code){ showErr("Enter a room code to join."); return; }
    showErr("");
    setLandingBusy(true);
    state.roomCode = code;

    // A read failure and a missing room are different problems and say so.
    const res = await sGetResult(coreKey());
    if(!res.ok){
      showErr("Couldn't reach the database — " + describeDbError(res.error));
      setLandingBusy(false);
      return;
    }
    if(res.value === null){
      showErr("No room found with that code — double check it with whoever created the room.");
      setLandingBusy(false);
      return;
    }
    const core = res.value;

    if(isRoomClosed(core, srvNow())){
      // Idle past its lifetime, so it is closed rather than joinable. Sweeping it
      // here is the only cleanup the game gets — there is no server to run one —
      // which is why this deletes the side nodes too and not just core.
      await sRemove(coreKey());
      await sRemove(drawKey());
      await sRemove(chatKey());
      await sRemove(presenceKey());
      showErr("That room has closed — it sat empty too long. Ask for a fresh code.");
      setLandingBusy(false);
      return;
    }

    const existing = (core.players||[]).find(p=>String(p.name).toLowerCase() === name.toLowerCase());
    if(existing){
      // Someone with this name is already on the roster — but if their old tab
      // isn't connected any more (closed, crashed, or refreshed away and never
      // came back), let this join reclaim that identity rather than bouncing them
      // with a "name taken" error. Score, host status and draw turn all carry over
      // automatically since it's the same id.
      if(await isPlayerPresentOnce(existing.id)){
        showErr("Someone in this room already has that name — try a different one.");
        setLandingBusy(false);
        return;
      }
      state.myId = existing.id;
      state.myName = existing.name;
      state.isHost = (core.hostId === state.myId);
      markPresent(state.myId);
      attachRoomListeners();
      return;
    }

    state.myId = uid();
    state.myName = name;

    /* Adding yourself to the roster is a read-modify-write like any other, so it
       goes through a transaction: two people joining at once both get a seat.

       IMPORTANT — this cannot use coreTransaction(). RTDB runs the update function
       first against the *locally cached* value, and a path is only cached while a
       'value' listener is attached. The joiner attaches listeners only after
       landing on the roster, so this first attempt arrives as null even though the
       room plainly exists — we just read it above. Treating that null as "room
       deleted" and aborting breaks every single join, because an abort is final:
       RTDB never retries after one. So null means "not synced yet": fall back to
       the snapshot we already have, let the server reject the mismatch, and do the
       real merge on the retry. */
    let joinFailed = null;
    let sawServerData = false;
    const joinRes = await db.ref(coreKey()).transaction(cur=>{
      joinFailed = null;                     // each attempt starts clean
      let base;
      if(cur === null || cur === undefined){
        base = JSON.parse(JSON.stringify(core));
      } else {
        sawServerData = true;
        base = cur;
      }
      base.players = base.players || [];
      if(base.players.some(p=>String(p.name).toLowerCase() === name.toLowerCase())){
        joinFailed = "taken";
        return undefined;
      }
      base.players.push({id:state.myId, name:state.myName, score:0});
      if(base.started) base.order = (base.order||[]).concat([state.myId]);
      return base;
    }, undefined, false).catch(e=>{ joinFailed = e; return null; });

    if(!joinRes || !joinRes.committed){
      if(joinFailed === "taken") showErr("Someone just took that name — try a different one.");
      else showErr("Couldn't join — " + describeDbError(joinFailed));
      setLandingBusy(false);
      return;
    }
    if(!sawServerData){
      // Committed without ever seeing server data, which means the path really was
      // empty: the room was deleted between our read and our write. Undo rather
      // than leaving a half-room built from a stale snapshot.
      await sRemove(coreKey());
      showErr("That room closed while you were joining it.");
      setLandingBusy(false);
      return;
    }

    state.isHost = (joinRes.snapshot.val().hostId === state.myId);
    markPresent(state.myId);
    attachRoomListeners();
  };
}
