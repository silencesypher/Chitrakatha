/* Deployment config checks — Vercel (static site) + Firebase (database rules).

   Two platforms, two deploys: Vercel serves the files, Firebase owns the database.
   Switching hosts does NOT move the rules, so this checks both halves.

   The failure mode this guards against: a rules pattern that rejects a key the app
   actually writes. That breaks the game in production while working fine locally,
   because locally you were running with wide-open rules. So rather than eyeball the
   regex, generate real room codes with the real generator, build real paths with the
   real path builders, and check every one against the rule as written.

   Run: node test/rules.mjs                                                       */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
let fail = 0, pass = 0;
const ok = (c,l)=>{ if(c){ pass++; } else { fail++; console.log('  ✗', l); } };

/* ---------- 1. files parse ---------- */
const rulesRaw = fs.readFileSync(path.join(ROOT,'database.rules.json'),'utf8');
const hostRaw  = fs.readFileSync(path.join(ROOT,'firebase.json'),'utf8');
let rules, host;
try{ rules = JSON.parse(rulesRaw); ok(true,''); }catch(e){ ok(false,`database.rules.json is not valid JSON: ${e.message}`); }
try{ host  = JSON.parse(hostRaw);  ok(true,''); }catch(e){ ok(false,`firebase.json is not valid JSON: ${e.message}`); }
console.log('1. config files: both parse as JSON');

/* ---------- 2. the read/write pattern accepts every key the app can produce ---------- */
const { genRoomCode } = await import('../src/util.js');
const store = await import('../src/net/store.js');
const { state } = await import('../src/state.js');

const readRule = rules.rules.$room['.read'];
const m = readRule.match(/matches\(\/(.+)\/\)/);
ok(!!m, 'read rule should contain a matches(/.../) pattern');
const pattern = new RegExp(m[1]);

let keysChecked = 0, rejected = [];
for(let i=0;i<2000;i++){
  state.roomCode = genRoomCode();
  // chatListKey includes a child path; the rule applies to the top-level key only
  const topLevel = [store.coreKey(), store.drawKey(), store.chatKey(),
                    store.presenceKey(), store.chatListKey().split('/')[0]];
  for(const k of topLevel){
    keysChecked++;
    if(!pattern.test(k)) rejected.push(k);
  }
}
ok(rejected.length === 0, `${rejected.length} legitimate keys rejected by the rules, e.g. ${rejected[0]}`);
console.log(`2. key pattern: ${keysChecked} real keys from 2000 room codes, all accepted`);

/* ---------- 3. the pattern rejects what it should ---------- */
const shouldDeny = [
  ['', 'the database root'],
  ['users', 'an unrelated top-level key'],
  ['citrakatha:RK7X9', 'a room key with no section suffix'],
  ['citrakatha:RK7X9:secrets', 'an unknown section'],
  ['citrakatha:RK7X:core', 'a 4-character room code'],
  ['citrakatha:RK7X9A:core', 'a 6-character room code'],
  ['citrakatha:rk7x9:core', 'a lowercase room code'],
  ['citrakatha:RK 7X:core', 'a code containing a space'],
  ['evil:RK7X9:core', 'a different namespace'],
];
for(const [key,desc] of shouldDeny){
  ok(!pattern.test(key), `pattern should reject ${desc} ("${key}")`);
}
ok(!rules.rules['.read'] && !rules.rules['.write'],
   'the root must not be readable — otherwise every room in the project can be listed');
console.log(`3. pattern rejects: ${shouldDeny.length} bad key shapes + root enumeration blocked`);

/* ---------- 4. validation caps match the UI's own limits ---------- */
const html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const nameMax  = parseInt((html.match(/id="in-name"[^>]*maxlength="(\d+)"/)||[])[1] || 0, 10);
const guessMax = parseInt((html.match(/id="guess-input"[^>]*maxlength="(\d+)"/)||[])[1] || 0, 10);
const nameCap  = parseInt(rules.rules.$room.players.$index.name['.validate'].match(/<=\s*(\d+)/)[1],10);
const textCap  = parseInt(rules.rules.$room.messages.$msgId.text['.validate'].match(/<=\s*(\d+)/)[1],10);
ok(nameMax > 0 && guessMax > 0, 'both inputs should declare a maxlength');
ok(nameCap >= nameMax,  `name cap ${nameCap} must be >= the input's maxlength ${nameMax}, or valid names are rejected`);
ok(textCap >= guessMax, `chat cap ${textCap} must be >= the input's maxlength ${guessMax}, or valid guesses are rejected`);
console.log(`4. validation caps: name ${nameMax}->${nameCap}, guess ${guessMax}->${textCap} (rules are the looser bound)`);

/* ---------- 5. Vercel config: the gotchas that break native ES modules ---------- */
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT,'vercel.json'),'utf8'));
const vrw = vercel.rewrites || [];

// A catch-all rewrite to the HTML is the classic module killer: /src/main.js would
// return the page instead of the script, and every import dies on MIME type.
const CATCH_ALL = [/^\/\(\.\*\)$/, /^\/:path\*$/, /^\/\(\.\+\)$/];
const badRw = vrw.find(r=>CATCH_ALL.some(re=>re.test(r.source)) && /\.html$/.test(r.destination||''));
ok(!badRw, `a catch-all rewrite to ${badRw && badRw.destination} would break every module import`);

// Entry point: either an index.html exists, or "/" is rewritten to the real file.
const hasIndex = fs.existsSync(path.join(ROOT,'index.html'));
const rootRw = vrw.find(r=>r.source === '/');
ok(hasIndex || rootRw, 'need index.html at the root, or a rewrite for "/"');
if(rootRw){
  ok(fs.existsSync(path.join(ROOT, rootRw.destination.replace(/^\//,''))),
     `the "/" rewrite points at ${rootRw.destination}, which must exist`);
}

// No build step: Vercel must not try to detect a framework and run one.
ok(vercel.framework === null || vercel.framework === undefined,
   'framework should be null — this is a plain static site with no build');
ok(vercel.buildCommand === null || vercel.buildCommand === undefined,
   'buildCommand should be null so Vercel does not invent a build step');
ok(!fs.existsSync(path.join(ROOT,'package.json')),
   'no package.json — its presence makes Vercel attempt an npm build');

// cleanUrls would serve /index for index.html and rewrite the .html form.
ok(vercel.cleanUrls !== true, 'cleanUrls should stay off with an explicit "/" rewrite');

// Stale-module guard: with native ES modules each file is fetched separately, so a
// redeploy under long caching serves a mix of old and new modules.
const vh = (vercel.headers||[]).find(h=>/\(\.\*\)|js/.test(h.source));
ok(vh && /no-cache/.test(JSON.stringify(vh.headers)),
   'js should be sent no-cache while iterating, or redeploys serve stale modules');

// The rules file must never be reachable over HTTP, and tests need not ship.
const vIgnore = fs.readFileSync(path.join(ROOT,'.vercelignore'),'utf8')
  .split('\n').map(l=>l.trim()).filter(l=>l && !l.startsWith('#'));
ok(vIgnore.includes('test'), 'tests should not be deployed');
ok(vIgnore.includes('database.rules.json'), 'the rules file should not be served publicly');
console.log('5. vercel.json: no catch-all rewrite, no build step, entry mapped, no-cache set');

/* ---------- 5b. firebase.json is database-only ----------
   With Vercel hosting the site, a `hosting` block here would mean a bare
   `firebase deploy` quietly publishes a second copy at *.web.app that then drifts
   out of sync with production. */
ok(!host.hosting, 'firebase.json should not configure hosting while Vercel serves the site');
ok(host.database && host.database.rules === 'database.rules.json',
   'firebase.json must still point at the rules file');
console.log('5b. firebase.json: database rules only, no competing hosting config');

/* ---------- 6. every file the browser needs is actually deployable ---------- */
const needed = ['index.html','citrakatha.css'];
const srcFiles = [];
(function walk(d){
  for(const e of fs.readdirSync(d,{withFileTypes:true})){
    const p = path.join(d,e.name);
    if(e.isDirectory()) walk(p); else if(p.endsWith('.js')) srcFiles.push(path.relative(ROOT,p));
  }
})(path.join(ROOT,'src'));
for(const f of needed.concat(srcFiles)){
  ok(fs.existsSync(path.join(ROOT,f)), `${f} must exist`);
  const blocked = vIgnore.some(pat=>f === pat || f.startsWith(pat.replace(/\/?\*\*$/,'') + '/'));
  ok(!blocked, `${f} is in the ignore list but the browser needs it`);
}
console.log(`6. deployable set: ${needed.length + srcFiles.length} files present and not ignored`);

console.log(`\n${pass} assertions passed, ${fail} failed`);
console.log(fail === 0 ? '=== DEPLOY CONFIG OK ===' : '=== DEPLOY CONFIG BROKEN ===');
process.exit(fail === 0 ? 0 : 1);
