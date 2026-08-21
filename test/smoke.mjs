/* Loads the real module graph, entry point included, against a stubbed browser.
   Catches anything that throws at import time or during boot(), plus verifies the
   startup sequence actually wires the DOM handlers. */

const made = new Map();
const calls = [];
function fakeEl(id){
  const el = {
    id, style:{}, dataset:{}, value:'', textContent:'', innerHTML:'', placeholder:'',
    disabled:false, type:'', width:800, height:500, children:[],
    classList:{add(){},remove(){},toggle(){},contains(){return false}},
    appendChild(c){ this.children.push(c); }, setAttribute(){}, addEventListener(){},
    setSelectionRange(){}, focus(){},
    getBoundingClientRect(){ return {left:0,top:0,width:800,height:500}; },
    getContext(){ return {
      fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(){},
      rect(){},ellipse(){},putImageData(){},
      getImageData(){ return {data:new Uint8ClampedArray(800*500*4)}; }
    }; }
  };
  let _onclick = null, _onsubmit = null;
  Object.defineProperty(el,'onclick',{get:()=>_onclick,set:v=>{_onclick=v; calls.push(`onclick:${id}`);}});
  Object.defineProperty(el,'onsubmit',{get:()=>_onsubmit,set:v=>{_onsubmit=v; calls.push(`onsubmit:${id}`);}});
  return el;
}
globalThis.document = {
  getElementById(id){ if(!made.has(id)) made.set(id, fakeEl(id)); return made.get(id); },
  querySelectorAll(){ return []; },
  createElement(){ return fakeEl('created'); },
  addEventListener(){}
};
globalThis.window = { addEventListener(){} };
// Deliberately NO sessionStorage stub: refresh-resume was removed, so nothing in
// src/ may touch it. If a session-persistence call ever creeps back in, boot()
// will throw on the missing global here rather than the behaviour returning quietly.
globalThis.alert = ()=>{};

const refPaths = [];
globalThis.firebase = {
  initializeApp(){ calls.push('firebase.initializeApp'); },
  database(){
    return { ref(p){ refPaths.push(p); return {
      on(){ calls.push(`on:${p}`); },
      once(){ return Promise.resolve({val:()=>null}); },
      set(){ return Promise.resolve(); },
      remove(){ return Promise.resolve(); },
      push(){ return Promise.resolve(); },
      transaction(){ return Promise.resolve({committed:false, snapshot:{val:()=>null}}); },
      onDisconnect(){ return {remove(){}}; },
      limitToLast(){ return this; }
    }; } };
  }
};

let failed = 0;
const ok = (c,l)=>{ if(!c){ console.log('  ✗', l); failed++; } };

try{
  await import('../src/main.js');
  console.log('1. module graph imported and boot() ran without throwing');
}catch(e){
  console.log('1. IMPORT/BOOT FAILED:', e.message);
  console.log(e.stack);
  process.exit(1);
}

// give the async boot() a tick to settle
await new Promise(r=>setTimeout(r,50));

ok(calls.includes('firebase.initializeApp'), 'firebase initialised');
ok(refPaths.includes('/.info/serverTimeOffset'), 'server clock listener attached');
console.log('2. firebase + clock wired');

for(const h of ['onclick:how-toggle','onclick:btn-create','onclick:btn-join',
                'onclick:btn-copy','onclick:btn-start','onclick:btn-again',
                'onsubmit:guessform']){
  ok(calls.includes(h), `handler wired: ${h}`);
}
console.log('3. all 7 DOM handlers wired by the init functions');

// the setup note must NOT have replaced the landing card, since config is present
ok(!/setup-note/.test(made.get('landing-card')?.innerHTML || ''), 'landing card left intact with valid config');
console.log('4. config gate passed through');

/* ===== 5. board hydration fires on entering the game screen =====
   Regression guard: hydration used to hang off a 400ms timer in main.js that only
   ran on refresh-resume, so a fresh join into a game in progress never repainted
   the board. It now hangs off enterGameScreenUI, which covers both paths. */
{
  const { state } = await import('../src/state.js');
  const { enterGameScreenUI } = await import('../src/ui/gamescreen.js');
  state.roomCode = 'TEST1';
  state.myId = 'p1';
  state.core = {
    phase:'drawing', roundId:'r7', drawerId:'p2', round:1, correctIds:[],
    settings:{rounds:3, drawSeconds:80, language:'iast'},
    players:[{id:'p1',name:'me',score:0},{id:'p2',name:'them',score:0}]
  };
  const before = refPaths.length;
  enterGameScreenUI();
  await new Promise(r=>setTimeout(r,30));
  const touched = refPaths.slice(before);
  ok(touched.some(p=>p.endsWith(':draw')), 'entering the game screen reads the board once');
  console.log('5. board hydration wired to game-screen entry');
}

console.log(failed===0 ? '\n=== SMOKE TEST CLEAN ===' : `\n=== ${failed} FAILURE(S) ===`);
process.exit(failed===0?0:1);
