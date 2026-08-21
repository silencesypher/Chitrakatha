/* Behavioural regression suite.
   Imports the real modules directly — no browser stub, no bundler, no Firebase.
   That is only possible because matching / wordpool / rounds / util / clock are
   free of DOM and database dependencies. Run with: node test/run.mjs           */

import { WORDS } from '../src/data/words.js';
import { IAST_KEYS, DEVA_KEY_GROUPS } from '../src/data/keyboards.js';
import { matchesWord, isCorrectGuess, foldGuess, skeletonOf } from '../src/game/matching.js';
import { pickWords } from '../src/game/wordpool.js';
import { advanceToNextTurn, applyWordChoice, maskWord, everyoneGuessed, splitGraphemes } from '../src/game/rounds.js';
import { isRoomClosed, roomIdleMs } from '../src/game/rooms.js';
import { ROOM_IDLE_MS } from '../src/config.js';
import { escapeHtml, genRoomCode, shuffle, uid } from '../src/util.js';
import { srvNow, __setOffsetForTests } from '../src/clock.js';

let fail = 0, pass = 0;
const ok = (cond, label)=>{ if(cond){ pass++; } else { fail++; console.log('  ✗', label); } };

/* ===== 1. matcher: no two bank words accept each other, either script ===== */
{
  let cross = 0;
  for(let i=0;i<WORDS.length;i++) for(let j=0;j<WORDS.length;j++){
    if(i===j) continue;
    if(matchesWord(WORDS[i][0], WORDS[j][0])){ cross++; console.log('   IAST cross:', WORDS[i][0], '<=', WORDS[j][0]); }
    if(matchesWord(WORDS[i][3], WORDS[j][3])){ cross++; console.log('   DEVA cross:', WORDS[i][3], '<=', WORDS[j][3]); }
  }
  ok(cross === 0, `matcher cross-accepts should be 0, got ${cross}`);
  ok(WORDS.every(w=>matchesWord(w[0],w[0]) && matchesWord(w[3],w[3])), 'every word matches itself');
  console.log(`1. matcher sweep: ${cross} cross-accepts over ${WORDS.length**2*2} pairs`);
}

/* ===== 2. spelling/script variants accepted (same word, different rendering) ===== */
{
  const POS = [
    ['Rāma','Rama'],['Rāma','Ram'],['Sītā','Sita'],['Lakṣmaṇa','Lakshman'],['Lakṣmaṇa','Lakshmana'],
    ['Hanumān','Hanuman'],['Rāvaṇa','Ravan'],['Daśaratha','Dasharatha'],
    ['Kṛṣṇa','Krishna'],['Kṛṣṇa','Krsna'],['Kṛṣṇa','Krushna'],['Śiva','Shiva'],['Śiva','Shiv'],
    ['Gaṇeśa','Ganesh'],['Gaṇeśa','Ganesha'],['Bhīma','Bhim'],['Yudhiṣṭhira','Yudhishthir'],
    ['Draupadī','Draupadi'],['Bhīṣma','Bhishma'],['Vibhīṣaṇa','Vibhishan'],
    ['Śūrpaṇakhā','Surpanakha'],['Ayodhyā','Ayodhya'],['Laṅkā','Lanka'],
    ['Kurukṣetra','Kurukshetra'],['Cakravyūha','Chakravyuh'],
    ['Bhagavad Gītā','Bhagavad Gita'],['Hiraṇyakaśipu','Hiranyakashipu'],
    ['Mahiṣāsura','Mahishasura'],['Sañjīvanī','Sanjivani'],['Triśūla','Trishul'],
    ['Garuḍa','Garud'],['Kārtikeya','Kartikeya'],['Prahlāda','Prahlad'],
    ['Aśvatthāmā','Ashwatthama'],['Ghaṭotkaca','Ghatotkach'],
    ['Agni Parīkṣā','Agni Pariksha'],['Samudra Manthan','samudra  manthan'],
    ['संजीवनी','सञ्जीवनी'],['गरुड़','गरुड'],['राम','राम '],['कृष्ण','क्रिष्ण'],['सीता','सिता'],
    ['शिव','षिव'],['कुम्भकर्ण','कुंभकर्ण'],['त्रिशूल','त्रिशुल'],['हनुमान','हनुमान'],
  ];
  const miss = POS.filter(([t,g])=>!matchesWord(t,g));
  miss.forEach(([t,g])=>console.log(`   MISS ${t} <- "${g}" (${foldGuess(t)} / ${foldGuess(g)}; skel ${skeletonOf(foldGuess(t))} / ${skeletonOf(foldGuess(g))})`));
  ok(miss.length === 0, `${miss.length} spelling variants rejected`);
  console.log(`2. spelling variants: ${POS.length-miss.length}/${POS.length} accepted`);
}

/* ===== 2b. actual misspellings rejected (off by a letter is not a match) =====
   Matching used to also accept anything within a small Levenshtein distance or
   sharing a consonant skeleton, so a guess with a genuinely wrong or missing
   letter — not just a different valid transliteration — could still score as
   correct. These pairs differ by exactly one letter from a real word/script
   variant and must now be rejected; they were the concrete case that motivated
   removing that leniency. */
{
  const NEARMISS = [
    ['Daśaratha','Dashrath'],['Karṇa','Karan'],['Kumbhakarṇa','Kumbhkaran'],
    ['Sudarśana Cakra','Sudarshan Chakra'],['Bhagavad Gītā','Bhagwad Geeta'],
    ['Narasiṃha','Narsimha'],['Rāsa Līlā','Raas Leela'],['Puṣpaka Vimāna','Pushpak Viman'],
    ['लक्ष्मण','लक्षमण'],
  ];
  const fp = NEARMISS.filter(([t,g])=>matchesWord(t,g));
  fp.forEach(([t,g])=>console.log(`   FALSE+ ${t} <- "${g}" (off by a letter, should reject)`));
  ok(fp.length === 0, `${fp.length} near-miss misspellings wrongly accepted`);
  console.log(`2b. near-miss misspellings: ${NEARMISS.length-fp.length}/${NEARMISS.length} correctly rejected`);
}

/* ===== 3. genuinely different words rejected ===== */
{
  const NEG = [
    ['Rāma','Bharata'],['Rāma','Rāvaṇa'],['Sītā','Satī'],['Vālī','Bali'],['Kālī','Kalki'],
    ['Kālī','Kāliya'],['Kaikeyī','Kalki'],['Bhīma','Bhīṣma'],['Kṛṣṇa','Kṛpa'],['Śumbha','Niśumbha'],
    ['Lava','Kuśa'],['Nakula','Sahadeva'],['Indra','Indrajit'],['Yama','Vāyu'],['Kubera','Kuntī'],
    ['Rāma','Bhīma'],['Matsya','Kūrma'],['Śeṣanāga','Śeṣaśāyī'],['Vāyu','Vālī'],['Rāma','Sītā'],
    ['Śiva','Viṣṇu'],['Arjuna','Karṇa'],['Kṛṣṇa','Kālī'],['राम','रावण'],['शिव','विष्णु'],
    ['काली','कल्कि'],['भीम','भीष्म'],['लक्ष्मण','लक्ष्मी'],['सरयू','सूर्य'],['राम','भरत'],['सीता','सती'],
  ];
  const fp = NEG.filter(([t,g])=>matchesWord(t,g));
  fp.forEach(([t,g])=>console.log(`   FALSE+ ${t} <- "${g}"`));
  ok(fp.length === 0, `${fp.length} false positives`);
  console.log(`3. distinct words: ${NEG.length-fp.length}/${NEG.length} rejected`);
}

/* ===== 4. guessing is locked to the room's chosen script (ACCEPT_EITHER_SCRIPT=false) =====
   core.word is already the round's script-specific spelling (see wordpool.js), so
   isCorrectGuess checks only against that — a guess in the other script folds to
   a disjoint character set (Devanagari codepoints vs a-z) and can never match,
   regardless of whether it's a correct spelling of the word in that script. A
   different transliteration of the SAME script (Krishna/Kṛṣṇa, both Latin) is
   still fine — that's script-locking, not spelling strictness. */
{
  const core = {word:'राम', wordKey:'Rāma', wordDeva:'राम'};
  ok(isCorrectGuess(core,'राम'),      'deva game accepts deva');
  ok(!isCorrectGuess(core,'Rama'),    'deva game rejects romanised (script-locked)');
  ok(!isCorrectGuess(core,'ram'),     'deva game rejects "ram" (script-locked)');
  ok(!isCorrectGuess(core,'Rāvaṇa'),  'deva game rejects a different word');
  const c2 = {word:'Kṛṣṇa', wordKey:'Kṛṣṇa', wordDeva:'कृष्ण'};
  ok(!isCorrectGuess(c2,'कृष्ण'),     'iast game rejects devanagari (script-locked)');
  ok(isCorrectGuess(c2,'Krishna'),    'iast game accepts popular romanisation (same script)');
  console.log('4. script-locked guessing: ok');
}

/* ===== 5. word pool never leaks a difficulty tier ===== */
{
  for(const diff of ['1','2','3','mixed']){
    let used = [], leaks = 0, undersized = 0;
    for(let t=0;t<36;t++){
      const ch = pickWords(diff, used, 3, 'iast');
      if(ch.length < 3) undersized++;
      ch.forEach(c=>{ if(diff !== 'mixed' && String(c.diff) !== diff) leaks++; });
      used.push(ch[0].key);
    }
    ok(leaks === 0, `difficulty ${diff} leaked ${leaks} wrong-tier words`);
    ok(undersized === 0, `difficulty ${diff} produced ${undersized} undersized offers`);
  }
  const dv = pickWords('1',[],3,'deva');
  ok(dv.every(w=>/[\u0900-\u097F]/.test(w.word)), 'deva mode displays devanagari');
  ok(dv.every(w=>!/[\u0900-\u097F]/.test(w.key)), 'canonical key stays IAST');
  ok(dv.every(w=>w.deva && w.cat), 'both scripts + category carried for matching');
  console.log('5. word pool: no difficulty leaks across all 4 settings');
}

/* ===== 6. turn advance ===== */
{
  const mk = (order,idx,round,rounds)=>({
    order, drawerIdx:idx, round,
    settings:{rounds, difficulty:'mixed', language:'iast'},
    usedWords:[], phase:'roundEnd'
  });
  let s = mk(['a','b','c','d'],0,1,2), seen = [];
  for(let i=0;i<10;i++){
    s = advanceToNextTurn(s, new Set(['a','c']));
    if(s.phase === 'gameEnd'){ seen.push('END'); break; }
    seen.push(`r${s.round}:${s.drawerId}`);
  }
  ok(!seen.some(x=>x.endsWith(':b') || x.endsWith(':d')), 'absent players never get the turn');
  ok(seen[seen.length-1] === 'END', 'advance terminates at gameEnd');

  const s2 = advanceToNextTurn(mk(['a','b'],0,1,3), new Set());
  ok(!!s2.drawerId && s2.phase === 'choosing', 'empty presence set does not hang');

  const s3 = advanceToNextTurn(mk(['a','b'],0,1,3), new Set(['a','b']));
  ok(!!s3.roundId && s3.word === null && Array.isArray(s3.correctIds) && s3.correctIds.length === 0,
     'advance resets word/correctIds and issues a fresh roundId');
  ok(s3.chooseDeadline > 0 && Array.isArray(s3.wordChoices) && s3.wordChoices.length === 3,
     'advance sets a deadline and three fresh choices');
  console.log(`6. turn advance: ${seen.join(' ')}`);
}

/* ===== 7. applyWordChoice records both scripts ===== */
{
  const cur = {phase:'choosing', settings:{drawSeconds:80}, usedWords:['Rāma']};
  const wc  = {key:'Kṛṣṇa', word:'कृष्ण', deva:'कृष्ण', cat:'Mahābhārata', diff:1};
  applyWordChoice(cur, wc);
  ok(cur.word === 'कृष्ण' && cur.wordKey === 'Kṛṣṇa' && cur.wordDeva === 'कृष्ण', 'both scripts stored');
  ok(cur.wordCat === 'Mahābhārata', 'category stored (no lookup-by-string needed)');
  ok(cur.usedWords.length === 2 && cur.usedWords[1] === 'Kṛṣṇa', 'canonical key appended to usedWords');
  ok(cur.phase === 'drawing' && cur.roundEndAt > 0, 'phase advanced with a deadline');
  console.log('7. word choice: recorded correctly');
}

/* ===== 8. everyoneGuessed ignores absent players ===== */
{
  const core = {
    drawerId:'d', correctIds:['p1'],
    players:[{id:'d'},{id:'p1'},{id:'p2'}]
  };
  ok(!everyoneGuessed(core, ()=>true), 'not done while a present player has not guessed');
  ok(everyoneGuessed(core, id=>id!=='p2'), 'done once the only holdout is absent');
  ok(!everyoneGuessed({drawerId:'d', correctIds:[], players:[{id:'d'}]}, ()=>true),
     'a solo drawer never satisfies it');
  console.log('8. round-end condition: presence aware');
}

/* ===== 9. masking + escaping ===== */
{
  ok(maskWord('राम',0,'seed1').includes('_'), 'devanagari masked');
  ok(maskWord('Rāma',0,'seed1').split(' ').length === 4, 'IAST masked per grapheme');
  ok(splitGraphemes('कृष्ण').length < Array.from('कृष्ण').length, 'grapheme clusters kept intact');
  const early = maskWord('Kurukṣetra',0,'s'), late = maskWord('Kurukṣetra',0.9,'s');
  ok(late.replace(/[^_]/g,'').length < early.replace(/[^_]/g,'').length, 'reveals letters late in the round');
  ok(maskWord('Kurukṣetra',0.9,'s') === maskWord('Kurukṣetra',0.9,'s'), 'reveal is deterministic per roundId');
  ok(maskWord('Rāma',0.9,'aaa') !== maskWord('Rāma',0.9,'bbb') ||
     maskWord('Kurukṣetra',0.9,'aaa') !== maskWord('Kurukṣetra',0.9,'bbb'), 'reveal varies by roundId');
  ok(escapeHtml('<img onerror=x>') === '&lt;img onerror=x&gt;', 'html escaped');
  ok(escapeHtml(null) === '' && escapeHtml(42) === '42', 'non-string names do not throw');
  console.log('9. masking + escaping: ok');
}

/* ===== 10. utils and clock ===== */
{
  const codes = new Set(Array.from({length:2000}, genRoomCode));
  ok(codes.size > 1990, 'room codes are well distributed');
  ok([...codes].every(c=>/^[A-HJ-NP-Z2-9]{5}$/.test(c)), 'room codes avoid I/O/0/1 ambiguity');
  ok(new Set(Array.from({length:2000}, uid)).size === 2000, 'uid does not collide over 2000 draws');
  const src = [1,2,3,4,5];
  ok(shuffle(src) !== src && shuffle(src).slice().sort().join() === '1,2,3,4,5', 'shuffle is pure');
  const before = srvNow();
  __setOffsetForTests(60000);
  ok(srvNow() - before >= 59000, 'clock offset applies to srvNow');
  __setOffsetForTests(0);
  console.log('10. utils + clock: ok');
}

/* ===== 11. data integrity ===== */
{
  ok(WORDS.length === 151, `word bank has ${WORDS.length} entries`);
  ok(WORDS.every(w=>w.length === 4), 'every entry is [iast, difficulty, category, devanagari]');
  ok(WORDS.every(w=>[1,2,3].includes(w[1])), 'every difficulty is 1, 2 or 3');
  ok(WORDS.every(w=>/[\u0900-\u097F]/.test(w[3])), 'every entry has a devanagari form');
  ok(new Set(WORDS.map(w=>w[0])).size === WORDS.length, 'no duplicate IAST keys');
  ok(IAST_KEYS.length === 17, 'IAST keyboard intact');
  ok(DEVA_KEY_GROUPS.reduce((n,g)=>n+g.keys.length,0) === 62, 'Devanagari keyboard intact');
  console.log('11. data integrity: ok');
}

/* ===== 12. room lifetime =====
   Rooms used to be permanent. These pin the expiry rules, and especially the two
   "leave it alone" cases — a wrong answer here deletes somebody's live game. */
{
  const T = 1_000_000_000_000;
  const HOUR = 60*60*1000;
  const fresh   = {lastActiveAt: T};
  const idle    = {lastActiveAt: T - 3*HOUR};

  ok(!isRoomClosed(fresh, T),                 'a room touched just now is open');
  ok(!isRoomClosed(fresh, T + ROOM_IDLE_MS-1), 'still open one ms before the limit');
  ok(isRoomClosed(fresh, T + ROOM_IDLE_MS),   'closed exactly at the limit');
  ok(isRoomClosed(idle, T),                   'a room idle past the limit is closed');

  // A room mid-game is kept alive by the host heartbeat, so "in progress" is not
  // itself a reason to keep it — only recent activity is.
  ok(isRoomClosed({phase:'drawing', lastActiveAt: T - 3*HOUR}, T), 'an abandoned mid-game room still closes');

  // Rooms predating lastActiveAt fall back to createdAt rather than living forever.
  ok(isRoomClosed({createdAt: T - 3*HOUR}, T),  'legacy room ages out on createdAt');
  ok(!isRoomClosed({createdAt: T}, T),          'freshly created legacy room is open');

  // The two cases where deleting would be the worse mistake.
  ok(!isRoomClosed(null, T),                    'a missing room is "no such room", not closed');
  ok(!isRoomClosed({phase:'lobby'}, T),         'an undateable room is left alone, not swept');

  ok(isRoomClosed(fresh, T + HOUR, HOUR),       'custom idle window is honoured');
  ok(roomIdleMs(fresh, T - 5000) === 0,         'a clock skewed backwards never reports negative idle');
  console.log('12. room lifetime: expiry, legacy fallback and the leave-alone cases');
}

console.log(`\n${pass} assertions passed, ${fail} failed`);
console.log(fail === 0 ? '=== ALL BEHAVIOUR PRESERVED ===' : '=== REGRESSION ===');
process.exit(fail === 0 ? 0 : 1);
