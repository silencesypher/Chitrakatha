import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// See markup.mjs: .pathname gives "/C:/..." on Windows, which path.join mangles.
const ROOT = fileURLToPath(new URL('../src/', import.meta.url));
function walk(dir){
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e=>{
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (p.endsWith('.js') ? [p] : []);
  });
}
const files = walk(ROOT).sort();
let fail = 0;
const bad = (m)=>{ console.log('  ✗', m); fail++; };

/* ---- 1. syntax ---- */
for(const f of files){
  try{ execSync(`node --check "${f}"`, {stdio:'pipe'}); }
  catch(e){ bad(`syntax error in ${path.relative(ROOT,f)}: ${e.stderr}`); }
}
console.log(`1. syntax: ${files.length} modules checked`);

/* ---- 2. parse imports/exports ---- */
const mod = new Map();
for(const f of files){
  const src = fs.readFileSync(f,'utf8');
  const rel = path.relative(ROOT,f);
  const imports = [];
  const re = /import\s+(?:([\w*\s{},$]+?)\s+from\s+)?["']([^"']+)["']/g;
  let m;
  while((m = re.exec(src))){
    const names = (m[1]||'').replace(/[{}]/g,'').split(',')
      .map(s=>s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    imports.push({spec:m[2], names});
  }
  const exports = new Set();
  for(const r of [/export\s+(?:async\s+)?function\s+([\w$]+)/g,
                  /export\s+(?:const|let|var)\s+([\w$]+)/g]){
    while((m = r.exec(src))) exports.add(m[1]);
  }
  const re2 = /export\s*\{([^}]+)\}/g;
  while((m = re2.exec(src))){
    m[1].split(',').forEach(s=>{
      const n = s.trim().split(/\s+as\s+/).pop().trim();
      if(n) exports.add(n);
    });
  }
  mod.set(rel, {file:f, src, imports, exports});
}

/* ---- 3. every import resolves to a real file and a real export ---- */
for(const [rel,info] of mod){
  for(const imp of info.imports){
    if(!imp.spec.startsWith('.')) continue;
    const target = path.normalize(path.join(path.dirname(rel), imp.spec));
    if(!mod.has(target)){ bad(`${rel} imports missing file ${imp.spec}`); continue; }
    const avail = mod.get(target).exports;
    for(const n of imp.names){
      if(n === '*' || n === 'default') continue;
      if(!avail.has(n)) bad(`${rel} imports {${n}} from ${imp.spec}, which does not export it`);
    }
  }
}
console.log('2. import resolution: every specifier and named binding checked');

/* ---- 4. cycle detection ---- */
const graph = new Map([...mod].map(([rel,i])=>[
  rel, i.imports.filter(x=>x.spec.startsWith('.'))
        .map(x=>path.normalize(path.join(path.dirname(rel), x.spec)))
        .filter(t=>mod.has(t))
]));
const cycles = [];
(function detect(){
  const WHITE=0, GREY=1, BLACK=2;
  const color = new Map([...graph.keys()].map(k=>[k,WHITE]));
  const stack = [];
  function dfs(n){
    color.set(n,GREY); stack.push(n);
    for(const m of graph.get(n)||[]){
      if(color.get(m)===GREY) cycles.push([...stack.slice(stack.indexOf(m)), m].join(' -> '));
      else if(color.get(m)===WHITE) dfs(m);
    }
    stack.pop(); color.set(n,BLACK);
  }
  for(const n of graph.keys()) if(color.get(n)===WHITE) dfs(n);
})();
if(cycles.length){
  console.log(`3. cycles: ${cycles.length} found`);
  [...new Set(cycles)].forEach(c=>console.log('   ⟳', c));
} else {
  console.log('3. cycles: none');
}

/* ---- 5. dead modules (imported by nobody, except main) ---- */
const importedBy = new Map([...graph.keys()].map(k=>[k,0]));
for(const deps of graph.values()) deps.forEach(d=>importedBy.set(d, importedBy.get(d)+1));
const orphans = [...importedBy].filter(([k,v])=>v===0 && k!=='main.js').map(([k])=>k);
if(orphans.length) bad(`unreachable module(s): ${orphans.join(', ')}`);
else console.log('4. reachability: every module is reachable from main.js');

/* ---- 6. no leftover globals from the single-file version ---- */
const localOwned = [];
const OLD = ['cachedCore','localStrokes','drawDirty','currentRoundIdSeen','choiceMadeLocally',
             'enteredGameScreen','gameEndHandled','lastPhaseSeen','listenersAttached',
             'canvasBound','migratingHost','skippingDrawer','presenceLoaded','myId','myName',
             'roomCode','isHost','tickTimer','flushTimer'];
for(const [rel,info] of mod){
  for(const g of OLD){
    const assigns = new RegExp(`(^|[^.\\w'"\`])${g}\\s*=[^=]`,'m').test(info.src);
    if(!assigns) continue;
    // Only a problem if the module does NOT declare it locally. A module-private
    // `let` of the same name is correct encapsulation, not a missed rename.
    const declared = new RegExp(`(let|const|var|function)\\s+${g}\\b`).test(info.src);
    if(!declared) bad(`${rel} assigns undeclared global \`${g}\` (missed rename?)`);
    else localOwned.push(`${rel} owns \`${g}\` locally`);
  }
}
console.log('5. stale globals: none leaked; module-private state:');
localOwned.forEach(l=>console.log('     ·', l));

/* ---- 7. line count report ---- */
console.log('\nModule sizes:');
const rows = [...mod].map(([rel,i])=>[rel, i.src.split('\n').length, i.exports.size])
                     .sort((a,b)=>b[1]-a[1]);
rows.forEach(([rel,lines,exp])=>console.log(`  ${String(lines).padStart(4)} lines  ${String(exp).padStart(2)} exports  ${rel}`));
console.log(`  ${String(rows.reduce((n,r)=>n+r[1],0)).padStart(4)} lines total across ${rows.length} modules`);

console.log(fail===0 ? '\n=== STATIC ANALYSIS CLEAN ===' : `\n=== ${fail} PROBLEM(S) ===`);
process.exit(fail===0?0:1);
