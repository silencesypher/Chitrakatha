/* Pure helpers. No imports, no DOM state, no Firebase — safe to unit test. */

export const $ = (id)=>document.getElementById(id);

export function uid(){
  return Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);
}

export function genRoomCode(){
  // No I, O, 0 or 1 — they get misread when someone reads a code out loud.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for(let i=0;i<5;i++) c += chars[Math.floor(Math.random()*chars.length)];
  return c;
}

export function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

// Coerce first: anything on the roster arrived over the wire, and a non-string
// name would otherwise throw inside .replace and take the whole render down.
export function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c=>({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

export function insertAtCursor(input, text){
  const start = input.selectionStart ?? input.value.length;
  const end   = input.selectionEnd   ?? input.value.length;
  input.value = input.value.slice(0,start) + text + input.value.slice(end);
  input.focus({preventScroll:true});   // no viewport jolt per keypress on phones
  const pos = start + text.length;
  input.setSelectionRange(pos,pos);
}
