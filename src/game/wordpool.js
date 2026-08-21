/* ================= WORD SELECTION =================
   Pure module: no DOM, no Firebase, no shared state. */
import { WORDS } from "../data/words.js";
import { shuffle } from "../util.js";

/* Offers unseen words from the chosen difficulty tier first, and when that tier is
   genuinely used up, recycles inside the same tier.

   The bug this replaced: the old fallback was
       if(pool.length < n) pool = WORDS.filter(w=>true)
   which on exhaustion threw away *both* the used-word filter and the difficulty
   filter, so an Easy game quietly started handing out Hard words. Easy now stays
   Easy; repeats only happen when the tier has nothing left to offer. */
export function pickWords(difficulty, used, n, language){
  const usedSet = new Set(used || []);
  const tier = WORDS.filter(w => difficulty === "mixed" ? true : String(w[1]) === String(difficulty));
  const base = tier.length ? tier : WORDS;          // guard a malformed difficulty value
  const fresh = shuffle(base.filter(w => !usedSet.has(w[0])));
  const stale = shuffle(base.filter(w =>  usedSet.has(w[0])));
  const take  = Math.max(1, Math.min(n, base.length));
  const deva  = language === "deva";
  // w[0] (the English/IAST form) is always the canonical key used to track
  // "already used" words, regardless of which script is being displayed.
  return fresh.concat(stale).slice(0, take).map(w=>({
    key: w[0],
    word: deva ? w[3] : w[0],
    deva: w[3],
    diff: w[1],
    cat: w[2]
  }));
}
