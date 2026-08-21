/* ================= PRESENCE =================
   Deliberately separate from the player roster: the roster (core.players) holds
   durable data (name, score) that must survive a refresh, while presence tracks
   whether a given player id currently has a live connection.

   Each browser tab gets its own random connId, written under
   presence/{playerId}/{connId} with an onDisconnect().remove(), so Firebase cleans
   it up the moment that specific tab goes away (closed, crashed, truly offline).
   A refresh opens a fresh connection before the old one's onDisconnect fires, so
   the two hand off cleanly instead of racing.

   absentSince records when we first noticed someone gone, which is what lets a
   plain refresh (a sub-second gap) pass without triggering a host handover or a
   skipped turn. */
import { db } from "../firebase.js";
import { state } from "../state.js";
import { uid } from "../util.js";
import { sGet, presenceKey } from "./store.js";

const connId = uid();
let presentIds = new Set();
let presenceLoaded = false;
const absentSince = new Map();

export function markPresent(playerId){
  if(!db || !state.roomCode || !playerId) return;
  const ref = db.ref(`${presenceKey()}/${playerId}/${connId}`);
  ref.set(true);
  ref.onDisconnect().remove();
}

export function isPresenceLoaded(){ return presenceLoaded; }

export function isPresent(playerId){
  // Before the first presence snapshot lands, assume everyone is here. Guessing
  // "absent" would migrate the host and skip the drawer the instant we connect.
  if(!presenceLoaded) return true;
  return presentIds.has(playerId);
}

export function absentFor(playerId, ms){
  const since = absentSince.get(playerId);
  return since != null && (Date.now() - since) >= ms;
}

/* A copy, so a transaction that retries can't see the set shift underneath it. */
export function presentSnapshot(){ return new Set(presentIds); }

export function onPresenceSnapshot(val){
  const map = val || {};
  const live = new Set();
  Object.keys(map).forEach(pid=>{
    const conns = map[pid];
    if(conns && typeof conns === "object" && Object.keys(conns).length > 0) live.add(pid);
  });
  presentIds = live;
  presenceLoaded = true;
  refreshAbsence();
}

/* Called from the presence listener AND from every core snapshot, because the two
   arrive in an unpredictable order — a presence event that lands before the first
   roster would otherwise leave absentSince empty and nobody would ever look absent. */
export function refreshAbsence(){
  if(!presenceLoaded) return;
  const now = Date.now();
  const players = (state.core && state.core.players) || [];
  players.forEach(p=>{
    if(presentIds.has(p.id)) absentSince.delete(p.id);
    else if(!absentSince.has(p.id)) absentSince.set(p.id, now);
  });
}

/* One-shot check used at join time, before any listener exists. */
export async function isPlayerPresentOnce(playerId){
  const p = await sGet(`${presenceKey()}/${playerId}`);
  return !!(p && Object.keys(p).length > 0);
}
