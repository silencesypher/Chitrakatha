/* Markup contract + mobile regression guards.
   The JS reaches into the DOM by string id and class selector, so a renamed or
   dropped element fails silently at runtime. This walks every reference in src/
   and checks it against index.html and citrakatha.css.
   Run: node test/markup.mjs                                                    */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// fileURLToPath, not .pathname: on Windows the latter yields "/C:/..." and
// path.resolve turns that into "C:\C:\..." — the suite could not run at all.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const css  = fs.readFileSync(path.join(ROOT,'citrakatha.css'),'utf8');

function walk(dir){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
    const p = path.join(dir,e.name);
    return e.isDirectory() ? walk(p) : (p.endsWith('.js') ? [p] : []);
  });
}
const jsFiles = walk(path.join(ROOT,'src'));
const js = jsFiles.map(f=>({rel:path.relative(ROOT,f), src:fs.readFileSync(f,'utf8')}));

let fail = 0, pass = 0;
const ok = (c,l)=>{ if(c){ pass++; } else { fail++; console.log('  ✗', l); } };

/* ---------- 1. every $("id") exists in the HTML ---------- */
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
// ids the JS creates at runtime rather than finding in the markup
const RUNTIME_IDS = new Set([]);
let idRefs = 0;
for(const {rel,src} of js){
  for(const m of src.matchAll(/\$\("([^"]+)"\)/g)){
    idRefs++;
    const id = m[1];
    if(RUNTIME_IDS.has(id)) continue;
    ok(htmlIds.has(id), `${rel} references $("${id}") — no such id in index.html`);
  }
}
console.log(`1. element ids: ${idRefs} references checked against ${htmlIds.size} ids in the markup`);

/* ---------- 2. every querySelectorAll('.class') matches something ---------- */
const htmlClasses = new Set(
  [...html.matchAll(/\bclass="([^"]+)"/g)].flatMap(m=>m[1].split(/\s+/)).filter(Boolean)
);
let selRefs = 0;
for(const {rel,src} of js){
  for(const m of src.matchAll(/querySelectorAll\("\.([\w-]+)"\)/g)){
    selRefs++;
    ok(htmlClasses.has(m[1]), `${rel} queries .${m[1]} — no element carries that class`);
  }
}
console.log(`2. class selectors: ${selRefs} checked`);

/* ---------- 3. data-attributes the JS reads are present ---------- */
const DATASET = {c:'data-c', s:'data-s', tool:'data-tool'};
for(const [key,attr] of Object.entries(DATASET)){
  const usedInJs = js.some(({src})=>src.includes(`dataset.${key}`));
  if(!usedInJs) continue;
  ok(html.includes(attr), `JS reads dataset.${key} but no element has ${attr}`);
}
console.log('3. data attributes: present for every dataset read');

/* ---------- 4. classes the JS toggles have CSS behind them ---------- */
const toggled = new Set();
for(const {src} of js){
  for(const m of src.matchAll(/classList\.(?:add|toggle|remove)\("([\w-]+)"/g)) toggled.add(m[1]);
}
for(const c of toggled){
  ok(css.includes(`.${c}`), `JS toggles .${c} but no CSS rule targets it`);
}
console.log(`4. toggled classes: ${toggled.size} checked (${[...toggled].sort().join(', ')})`);

/* ---------- 5. iOS auto-zoom guard ----------
   Mobile Safari zooms the page whenever a focused input's font-size is below 16px.
   That bug made the guess box unusable mid-round, so it must not creep back. */
// Comments stripped for THIS check only (the other checks below want raw css): a
// /* ... */ comment that happens to mention "input" would otherwise merge with
// whatever rule follows it, since the selector match is comment-blind.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const inputRules = [...cssNoComments.matchAll(/([^{}]*\b(?:input|select|textarea)\b[^{}]*)\{([^}]*)\}/g)];
let checkedInputs = 0;
for(const [,selector,body] of inputRules){
  const fs_ = body.match(/font-size:\s*([\d.]+)px/);
  if(!fs_) continue;
  checkedInputs++;
  ok(parseFloat(fs_[1]) >= 16,
     `input font-size ${fs_[1]}px in "${selector.trim()}" — iOS will zoom on focus (need >= 16px)`);
}
ok(checkedInputs >= 2, `expected at least 2 sized input rules, found ${checkedInputs}`);
console.log(`5. iOS zoom guard: ${checkedInputs} input font-size rules, all >= 16px`);

/* ---------- 6. touch target sizes in the phone breakpoint ----------
   These floors used to be 44/40/36 (the iOS thumb-target guideline). They were
   lowered deliberately: at 44px the drawing toolbar needed 453px of row in a
   359px viewport, so Undo and Redo sat off the right edge behind a scroll with
   nothing indicating they were there — controls you cannot find are worse than
   controls that are slightly small. The floors below are the sizes that let
   every tool fit on screen at once; they still guard against drifting smaller. */
const phoneBlock = css.slice(css.indexOf('@media (max-width:720px)'));
for(const [sel,min] of [['.toolbtn',36],['.sizebtn',30],['.swatch',26],['.key',40]]){
  const m = phoneBlock.match(new RegExp(`\\${sel}\\{[^}]*width:(\\d+)px`));
  ok(m && parseInt(m[1],10) >= min,
     `${sel} should be >= ${min}px wide on phones, got ${m ? m[1]+'px' : 'no rule'}`);
}
console.log('6. touch targets: tools/sizes/swatches/keys sized to fit on one screen');

/* ---------- 6b. the tool rows must never scroll horizontally ----------
   The regression this locks out: .tool-row was flex-wrap:nowrap + overflow-x:auto,
   which silently parked Undo/Redo/Clear past the right edge. Wrapping is the only
   acceptable overflow behaviour here — a control pushed to a second line is still
   reachable, one pushed into a hidden scroll area effectively is not. */
{
  const m = phoneBlock.match(/\.tool-row\{([^}]*)\}/);
  ok(m, '.tool-row should have a phone rule');
  if(m){
    ok(!/overflow-x:\s*auto/.test(m[1]), '.tool-row must not scroll horizontally on phones');
    ok(/flex-wrap:\s*wrap/.test(m[1]),   '.tool-row must wrap rather than clip on phones');
  }
  console.log('6b. tool rows: wrap, never scroll');
}

/* ---------- 7. mobile viewport + safe-area plumbing ---------- */
ok(/viewport-fit=cover/.test(html), 'viewport meta needs viewport-fit=cover for safe-area insets');
ok(!/user-scalable\s*=\s*no/.test(html), 'must not disable pinch-zoom (accessibility)');
ok(/maximum-scale/.test(html) === false, 'must not cap maximum-scale (accessibility)');
ok(/env\(safe-area-inset-bottom\)/.test(css), 'bottom UI needs safe-area-inset-bottom padding');
ok(/100dvh/.test(css), 'full-height layout should use dvh, not just vh');
ok(/overscroll-behavior-y:\s*contain/.test(css), 'body needs overscroll containment (pull-to-refresh)');
ok(/prefers-reduced-motion/.test(css), 'animations need a reduced-motion escape hatch');
ok(/:focus-visible/.test(css), 'keyboard focus must be visible');
console.log('7. viewport, safe areas, motion + focus: all present');

/* ---------- 8. interactive elements are real buttons ---------- */
for(const cls of ['swatch','sizebtn','key','toolbtn']){
  const asDiv = new RegExp(`<div[^>]*class="${cls}`).test(html);
  ok(!asDiv, `.${cls} is still a <div> — not focusable or announced; use <button>`);
}
const emojiTools = [...html.matchAll(/<button class="toolbtn[^>]*>/g)];
ok(emojiTools.every(m=>m[0].includes('aria-label')), 'every emoji tool button needs an aria-label');
ok(/role="log"/.test(html) && /aria-live/.test(html), 'chat log should announce new messages');
console.log(`8. semantics: ${emojiTools.length} tool buttons labelled, no interactive divs left`);

/* ---------- 9. CSS structural sanity ---------- */
ok(css.split('{').length === css.split('}').length, 'CSS braces balanced');
ok(!/[^:]\/\/[^*\n]*$/m.test(css.replace(/https?:\/\//g,'')), 'no // comments in CSS (invalid)');
console.log('9. CSS structure: balanced, no invalid comments');

console.log(`\n${pass} assertions passed, ${fail} failed`);
console.log(fail === 0 ? '=== MARKUP CONTRACT INTACT ===' : '=== CONTRACT BROKEN ===');
process.exit(fail === 0 ? 0 : 1);
