/* ================= ROUND PROGRESSION & MASKING =================
   Pure module: no DOM, no Firebase, no shared state. These functions run inside
   database transactions, so they must stay synchronous and side-effect free. */
import { CHOOSE_MS } from "../config.js";
import { uid } from "../util.js";
import { srvNow } from "../clock.js";
import { pickWords } from "./wordpool.js";

/* Hands the turn to the next player, hopping past anyone who isn't connected so
   the turn never goes to an empty chair. The hop budget guarantees termination
   even if the room has emptied entirely.

   Shared by the normal round-end path and the absent-drawer path, so the two
   can't drift apart. Mutates and returns `cur` (the transaction's working copy). */
export function advanceToNextTurn(cur, presentSet){
  const order = cur.order || [];
  if(!order.length){ cur.phase = "gameEnd"; return cur; }
  const here = id => !presentSet || presentSet.size === 0 || presentSet.has(id);

  let idx = cur.drawerIdx, round = cur.round;
  for(let hops = 0; hops <= order.length; hops++){
    idx += 1;
    if(idx >= order.length){ idx = 0; round += 1; }
    if(round > cur.settings.rounds){ cur.phase = "gameEnd"; return cur; }
    if(here(order[idx])) break;
  }

  cur.drawerIdx = idx;
  cur.drawerId  = order[idx];
  cur.round     = round;
  cur.roundId   = uid();
  cur.wordChoices = pickWords(cur.settings.difficulty, cur.usedWords||[], 3, cur.settings.language);
  cur.word = null; cur.wordKey = null; cur.wordDeva = null; cur.wordCat = null;
  cur.correctIds = [];
  cur.abandoned = false;
  cur.chooseDeadline = srvNow() + CHOOSE_MS;
  cur.phase = "choosing";
  return cur;
}

/* Records the chosen word on the room. Stores both scripts plus the category, so
   the round-end banner doesn't have to look the category back up by matching on
   the word string, and a guess can be checked against either script. */
export function applyWordChoice(cur, wc){
  cur.word     = wc.word;
  cur.wordKey  = wc.key;
  cur.wordDeva = wc.deva;
  cur.wordCat  = wc.cat;
  cur.usedWords = (cur.usedWords||[]).concat([wc.key]);
  cur.phase = "drawing";
  cur.roundEndAt = srvNow() + cur.settings.drawSeconds*1000;
  return cur;
}

/* Devanagari letters can be several codepoints (base + virama + consonant, base +
   matra, …); segmenting by grapheme cluster keeps each visual "letter" intact
   instead of masking mid-conjunct. */
export function splitGraphemes(word){
  if(typeof Intl !== "undefined" && Intl.Segmenter){
    try{
      const seg = new Intl.Segmenter(undefined, {granularity:"grapheme"});
      return Array.from(seg.segment(word), s=>s.segment);
    }catch(e){ /* fall through */ }
  }
  return Array.from(word);
}

/* Reveal order is derived from roundId, so every client independently agrees on
   which letters are showing without syncing anything. */
export function maskWord(word, elapsedFrac, roundId){
  const chars = splitGraphemes(String(word||""));
  let seed = 0;
  for(const c of String(roundId||"")) seed = (seed*31 + c.charCodeAt(0)) >>> 0;
  const idxs = chars.map((c,i)=>i).filter(i=>chars[i]!==" ");
  const order = idxs.slice().sort((a,b)=>{
    const ra = ((seed+a*97)%997), rb = ((seed+b*97)%997);
    return ra-rb;
  });
  let revealCount = 0;
  if(elapsedFrac > 0.75)      revealCount = Math.min(2, order.length-1);
  else if(elapsedFrac > 0.5)  revealCount = Math.min(1, order.length-1);
  const revealed = new Set(order.slice(0, Math.max(0,revealCount)));
  return chars.map((c,i)=> c===" " ? "  " : (revealed.has(i) ? c : "_")).join(" ");
}

/* Only connected non-drawers count towards "everyone has guessed". Using
   players.length - 1 meant one closed tab made the room wait out the full timer
   every single round. */
export function everyoneGuessed(core, isPresentFn){
  const eligible = (core.players||[]).filter(p => p.id !== core.drawerId && isPresentFn(p.id));
  const correct = new Set(core.correctIds||[]);
  return eligible.length > 0 && eligible.every(p => correct.has(p.id));
}
