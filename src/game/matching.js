/* ================= GUESS MATCHING =================
   The naive check was `guess.toLowerCase() === word.toLowerCase()`, so "Rama"
   lost to "Rāma" and "Krishna" lost to "Kṛṣṇa". Real players type what they hear,
   in whichever of the two scripts the round is using, with or without diacritics.

   Each side is folded to a comparison key (case, diacritics, script quirks and
   popular-romanisation digraphs all normalised away — ś/sh/s all become the same
   letter, for instance) and then compared for exact equality. That's deliberately
   the ONLY check: this used to also accept anything within a small Levenshtein
   distance or sharing a consonant skeleton, so an actual misspelling — a dropped
   or wrong letter, not just a different valid transliteration — could still score
   as correct. A guess now has to fold to the exact same key as the word in either
   script; nothing "close enough" counts.

   Tuned against the whole 151-word bank: no two different words in either script
   accept each other, and 46 hand-written spelling/script variants all pass. Every
   knob in foldLatin/foldDeva was set by measurement, not taste — see test/run.mjs
   before changing one.

   Pure module: no DOM, no Firebase, no shared state. */
import { ACCEPT_EITHER_SCRIPT } from "../config.js";

export /* The folding internals below are exported as tuning seams, not as API. Every
   threshold here was set by measurement (test/run.mjs sweeps all 151 words in both
   scripts); when a match goes wrong you want to print the intermediate folds and
   skeletons to see why. Nothing outside this module should call them in anger. */
const DEVA_RE = /[\u0900-\u097F]/;
export const isDevaText = s => DEVA_RE.test(String(s || ""));

export function foldLatin(s){
  // NFD + strip combining marks turns ā→a, ṣ→s, ṛ→r, ñ→n … in one step.
  let t = String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  t = t.replace(/[^a-z]/g, "");
  // Digraphs of popular romanisation collapse onto the IAST single letter.
  t = t.replace(/chh/g,"c").replace(/sh/g,"s").replace(/ch/g,"c");
  t = t.replace(/th/g,"t").replace(/dh/g,"d").replace(/ph/g,"f")
       .replace(/bh/g,"b").replace(/gh/g,"g").replace(/kh/g,"k").replace(/jh/g,"j");
  t = t.replace(/ck/g,"k").replace(/q/g,"k").replace(/x/g,"ks")
       .replace(/z/g,"j").replace(/w/g,"v").replace(/f/g,"p");
  t = t.replace(/ri/g,"r").replace(/ru/g,"r");          // Krishna / Krushna → kṛ
  t = t.replace(/e/g,"i").replace(/o/g,"u").replace(/y/g,"i");
  t = t.replace(/(.)\1+/g,"$1");                        // Geeta → gita, Raas → ras
  // The inherent final schwa is optional in speech (Śiva/Shiv), but only after a
  // consonant — stripping it after a vowel would merge Kālī with Kāliya.
  t = t.replace(/([^aiu])a$/,"$1");
  return t;
}

export function foldDeva(s){
  let t = String(s || "").normalize("NFC").replace(/[\u200c\u200d\s]/g, "");
  t = t.normalize("NFD").replace(/\u093C/g,"").normalize("NFC");   // गरुड़ ≡ गरुड
  t = t.replace(/\u0901/g,"\u0902");                               // candrabindu → anusvāra
  // संजीवनी ≡ सञ्जीवनी : anusvāra and a homorganic nasal + virāma are both correct.
  t = t.replace(/([\u0919\u091E\u0923\u0928\u092E])\u094D(?=[\u0915-\u0939])/g,"\u0902");
  t = t.replace(/\u094D\u0930\u093F/g,"\u093F");                   // क्रिष्ण ≡ कृष्ण
  t = t.replace(/[शष]/g,"स");
  t = t.replace(/ट/g,"त").replace(/ठ/g,"थ").replace(/ड/g,"द").replace(/ढ/g,"ध").replace(/ण/g,"न");
  t = t.replace(/ऱ/g,"र").replace(/ळ/g,"ल");
  t = t.replace(/आ/g,"अ").replace(/ई/g,"इ").replace(/ऊ/g,"उ").replace(/ऐ/g,"ए").replace(/औ/g,"ओ");
  t = t.replace(/\u093E/g,"")                     // ā-mātrā
       .replace(/\u0940/g,"\u093F")               // ī → i
       .replace(/\u0942/g,"\u0941")               // ū → u
       .replace(/\u0948/g,"\u0947")               // ai → e
       .replace(/\u094C/g,"\u094B")               // au → o
       .replace(/\u0943/g,"\u093F");              // ṛ-mātrā → i
  t = t.replace(/ऋ/g,"रि");
  return t;
}

export const foldGuess = s => isDevaText(s) ? foldDeva(s) : foldLatin(s);

// Consonant frame only. Drops exactly the marks people misplace: Latin vowels,
// and in Devanagari the mātrās, virāma, anusvāra and visarga. No longer used by
// matchesWord (see module header) — kept because test/run.mjs's diagnostic
// output still prints it when a variant unexpectedly fails to match.
export const DEVA_MARKS = /[\u093F\u0941\u0947\u094B\u094D\u0902\u0903]/g;
export const skeletonOf = f => isDevaText(f) ? f.replace(DEVA_MARKS,"") : f.replace(/[aiu]/g,"");

export function matchesWord(target, guess){
  const ft = foldGuess(target), fg = foldGuess(guess);
  if(!ft || !fg) return false;
  return ft === fg;
}

// core carries both scripts for the chosen word, so a guess can be checked
// against whichever one the player reached for.
export function isCorrectGuess(core, text){
  const forms = [core.word];
  if(ACCEPT_EITHER_SCRIPT){ forms.push(core.wordKey, core.wordDeva); }
  return forms.filter(Boolean).some(f => matchesWord(f, text));
}
