/* ================= DATABASE ACCESS =================
   All Realtime Database reads and writes funnel through here. */
import { db } from "../firebase.js";
import { state } from "../state.js";
import { srvNow } from "../clock.js";

/* ---------- room paths ----------
   These are flat top-level keys with colons in them, which is a known limitation:
   it makes per-room security rules impossible to express. Restructuring to
   rooms/{code}/… is on the list — when you do it, this is the only file that
   needs to change. */
export const coreKey     = (code)=>`citrakatha:${code || state.roomCode}:core`;
export const drawKey     = ()=>`citrakatha:${state.roomCode}:draw`;
export const chatKey     = ()=>`citrakatha:${state.roomCode}:chat`;
export const chatListKey = ()=>`citrakatha:${state.roomCode}:chat/messages`;
export const presenceKey = ()=>`citrakatha:${state.roomCode}:presence`;

/* ---------- reads and writes ----------
   Reads report *why* they failed. A single null return would collapse a
   permission error and a genuinely missing room into the same answer, which is
   how a locked-down database ends up telling people "No room found with that
   code". */
export async function sGetResult(key){
  try{
    const snap = await db.ref(key).once("value");
    const v = snap.val();
    return {ok:true, value: (v===undefined ? null : v)};
  }catch(e){
    console.error("read failed", key, e);
    return {ok:false, error:e};
  }
}

export async function sGet(key){
  const r = await sGetResult(key);
  return r.ok ? r.value : null;
}

export async function sSet(key, val){
  try{ await db.ref(key).set(val); return {ok:true}; }
  catch(e){ console.error("write failed", key, e); return {ok:false, error:e}; }
}

export async function sRemove(key){
  try{ await db.ref(key).remove(); return {ok:true}; }
  catch(e){ console.error("remove failed", key, e); return {ok:false, error:e}; }
}

export async function sPush(key, val){
  try{ await db.ref(key).push(val); return {ok:true}; }
  catch(e){ console.error("push failed", key, e); return {ok:false, error:e}; }
}

export function describeDbError(err){
  const code = String((err && (err.code || err.message)) || "").toLowerCase();
  if(code.includes("permission")) return "the database rules are blocking this. Open the Firebase console → Realtime Database → Rules and allow read/write, then reload.";
  if(code.includes("network") || code.includes("unavailable")) return "the database is unreachable. Check your connection and try again.";
  return (err && err.message) ? err.message : "an unknown database error occurred.";
}

/* ---------- atomic state changes ----------
   Every mutation of `core` goes through a transaction. RTDB re-runs the update
   function against fresh server data and only commits if nothing changed
   underneath, so two players who guess correctly in the same 200ms window both
   keep their points instead of one silently overwriting the other.

   The update function MUST be synchronous and free of side effects, because it
   can run several times before one attempt commits. */
export async function coreTransaction(mutate, _isRetry){
  if(!db || !state.roomCode) return {committed:false};
  let sawNull = false;
  try{
    const res = await db.ref(coreKey()).transaction(cur=>{
      // Every caller runs while a 'value' listener is attached, so this path is
      // synced and the first attempt normally holds real data. If it doesn't,
      // aborting is the safe choice — but we then retry once, because an abort is
      // final and silently dropping a score or a phase change is worse than a
      // 150ms delay. (ui/landing.js cannot use this helper for exactly this
      // reason: it runs before any listener exists. See the long note there.)
      if(cur === null || cur === undefined){ sawNull = true; return undefined; }
      const next = mutate(cur);
      // Stamped here rather than in each caller so no mutation can forget to mark
      // the room alive; game/rooms.js reads this to decide when a room has closed.
      // Skipped on abort (undefined), which by definition changed nothing.
      if(next) next.lastActiveAt = srvNow();
      return next;
    }, undefined, false);

    if(res && res.committed){
      const v = res.snapshot.val();
      if(v) state.core = v;
      return {committed:true, value:v};
    }
    if(sawNull && !_isRetry){
      await new Promise(r=>setTimeout(r, 150));
      return coreTransaction(mutate, true);
    }
    return {committed:false};
  }catch(e){
    console.error("core transaction failed:", e);
    return {committed:false, error:e};
  }
}

/* Claims a room code atomically: commits while the key is still empty, or while
   whatever sits there has gone stale. isStale is supplied by the caller so this
   layer never has to know what "closed" means — that rule lives in game/rooms.js.
   Recycling is the only way codes come back into circulation, since nothing else
   deletes a room. If another tab took the code a millisecond earlier, RTDB retries
   with the real data, we abort, and the caller rolls a new code. */
export async function claimIfFree(key, value, isStale){
  try{
    const res = await db.ref(key).transaction(cur=>{
      if(cur === null || cur === undefined) return value;
      if(isStale && isStale(cur)) return value;
      return undefined;
    }, undefined, false);
    return {ok: !!(res && res.committed)};
  }catch(e){
    return {ok:false, error:e};
  }
}
