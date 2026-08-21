/* ================= ONE SHARED CLOCK =================
   Every deadline in a room is stored as a server-clock millisecond value, and
   every comparison against it goes through srvNow(). Firebase reports the skew
   between this device and its servers on /.info/serverTimeOffset, so a player
   whose laptop clock is ten minutes fast sees the same countdown, and scores the
   same points, as everybody else.

   This removes *accidental* skew. It does not stop a determined cheat from lying
   about the clock — nothing client-side can.

   Note this module takes `db` as an argument rather than importing it, so the
   pure game logic that depends on srvNow() stays testable outside a browser. */

let serverOffset = 0;

export function srvNow(){ return Date.now() + serverOffset; }

export function attachClock(db){
  if(!db) return;
  db.ref("/.info/serverTimeOffset").on("value", s=>{ serverOffset = s.val() || 0; });
}

// Test seam: lets a suite simulate a skewed device without a database.
export function __setOffsetForTests(ms){ serverOffset = ms; }
