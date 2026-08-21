/* ================= ROOM LIFETIME =================
   Pure module: no DOM, no Firebase, no shared state.

   Rooms used to live forever. Nothing deleted one, ever — so every game ever
   played stayed in the database and kept its five-letter code spoken for.

   Expiry is driven off a timestamp carried on the room rather than a scheduled
   job, because this game has no server to run one: it is a static page talking
   straight to Realtime Database. So the rule is "whoever next touches a stale
   room is the one who clears it up" — checked on join (the room is reported
   closed and deleted) and on create (a stale code is fair game to reuse). That
   makes cleanup lazy: a dead room lingers until someone happens to reach for it
   or its code, which is fine for reuse but does mean storage is only bounded by
   the code space, not by time. See the note in config.js on what keeps a room
   marked alive. */
import { ROOM_IDLE_MS } from "../config.js";

/* How long the room has gone untouched.

   Rooms created before lastActiveAt existed fall back to createdAt, which ages
   them out on first contact — correct, since they predate the heartbeat and
   nothing is keeping them alive. A room carrying neither timestamp is reported
   as fresh rather than guessed about: refusing to date it is safer than deleting
   data we cannot reason about. */
export function roomIdleMs(core, now){
  if(!core) return 0;
  const last = Number(core.lastActiveAt != null ? core.lastActiveAt : core.createdAt);
  if(!Number.isFinite(last)) return 0;
  return Math.max(0, now - last);
}

/* A missing room is "no such room", which the caller already reports properly —
   it is not the same thing as one that has closed, so it answers false here. */
export function isRoomClosed(core, now, idleMs = ROOM_IDLE_MS){
  if(!core) return false;
  return roomIdleMs(core, now) >= idleMs;
}
