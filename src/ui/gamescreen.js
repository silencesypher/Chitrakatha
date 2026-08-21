/* ================= GAME + END SCREEN RENDERING =================
   Everything that paints the playing surface's surroundings. No game rules here. */
import { $, escapeHtml, insertAtCursor } from "../util.js";
import { state } from "../state.js";
import { IAST_KEYS, DEVA_KEY_GROUPS } from "../data/keyboards.js";
import { isPresent, isPresenceLoaded } from "../net/presence.js";
import { showScreen } from "./screens.js";
import { setupCanvas, setupToolbar, hydrateBoard } from "./canvas.js";
import { coreTransaction, sRemove, sSet, chatKey, drawKey } from "../net/store.js";

export function enterGameScreenUI(){
  state.choiceMade = false;
  state.roundIdSeen = null;
  state.gameLanguage =
    (state.core && state.core.settings && state.core.settings.language === "deva") ? "deva" : "iast";
  showScreen("screen-game");
  $("game-rc").textContent = "ROOM " + state.roomCode;
  buildKeyboardBar();
  setupCanvas();
  setupToolbar();
  // Repaint whatever is already on the board for this round. Covers a refresh
  // mid-round and a fresh join into a game already in progress.
  hydrateBoard();
}

/* ---------- on-screen script keyboard ---------- */
/* On a phone the script keyboard is a bottom sheet rather than a permanent bar:
   62 Devanagari keys would otherwise eat most of the screen. Desktop is
   unaffected — the toggle button is display:none there and the bar stays inline. */
export function initMobileUI(){
  const btn = $("btn-script");
  const bar = $("iastbar");
  if(!btn || !bar) return;
  btn.onclick = ()=>{
    bar.classList.contains("open") ? closeScriptSheet() : openScriptSheet();
  };
  // Tapping anywhere outside the open sheet dismisses it, like a native
  // keyboard. On desktop the sheet is never "open", so this never fires.
  document.addEventListener("pointerdown", (e)=>{
    if(!bar.classList.contains("open")) return;
    if(bar.contains(e.target)) return;
    closeScriptSheet();
  });
  trackVisualViewport();
}

/* Neither iOS nor Android shrink the layout viewport when the native keyboard
   opens (by design, here — see the comment on the viewport meta tag in
   index.html for why we don't opt into resizes-content), so a
   `height:100dvh; overflow:hidden` game screen keeps its full height and the
   guess box — the last thing in the layout — ends up hidden behind the keyboard.
   visualViewport reports the actually-visible area, so publish it as a custom
   property and let the phone rules size the screen off that instead. */
let maxVVH = 0;
function trackVisualViewport(){
  const vv = window.visualViewport;
  if(!vv) return;
  const apply = ()=>{
    document.documentElement.style.setProperty("--app-h", vv.height + "px");
    // The first reading (and the tallest one seen since) is our best guess at
    // "keyboard closed" — there's no direct signal for that, so track a running
    // max instead. A real on-screen keyboard eats a third or more of the screen;
    // the browser chrome auto-hiding the address bar only costs ~40-60px, well
    // under 3/4 of the max, so that alone won't flip this on by mistake.
    maxVVH = Math.max(maxVVH, vv.height);
    const keyboardOpen = maxVVH > 0 && vv.height < maxVVH * 0.75;
    // Below: hides the scoreboard strip and chat log while it's open, so the
    // canvas gets to stay close to full size instead of shrinking to make room
    // for chrome that doesn't matter while you're actively typing a guess.
    document.body.classList.toggle("kb-open", keyboardOpen);
  };
  vv.addEventListener("resize", apply);
  apply();
}

function openScriptSheet(){
  const bar = $("iastbar"), btn = $("btn-script"), input = $("guess-input");
  if(!bar || !input) return;
  // Blur before flipping inputmode so the phone's native keyboard drops
  // first — otherwise it stacks underneath the script sheet instead of
  // being replaced by it, and re-focusing later would just bring it back.
  input.blur();
  input.setAttribute("inputmode", "none");
  // The fixed sheet would cover the guess box at the bottom of the chat, so
  // the form rides along into the sheet's header — you can see what you type.
  const head = bar.querySelector(".iastbar-head");
  const form = $("guessform");
  if(head && form) head.insertBefore(form, head.firstChild);
  bar.classList.add("open");
  if(btn){
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-label", "Hide the on-screen script keyboard");
  }
  input.focus({preventScroll:true});
}

export function closeScriptSheet(){
  const bar = $("iastbar"), btn = $("btn-script"), input = $("guess-input");
  // Guarded: phase handlers call this on every tick, so the DOM moves and the
  // blur must only happen on a real open→closed transition.
  if(bar && bar.classList.contains("open")){
    bar.classList.remove("open");
    // Give the guess form back to the chat box.
    const form = $("guessform");
    const chatbox = document.querySelector(".chatbox");
    if(form && chatbox && form.parentElement !== chatbox) chatbox.appendChild(form);
    if(input){
      // Drop the native keyboard too, and let it come back normally next time
      // the player taps the field directly.
      input.removeAttribute("inputmode");
      input.blur();
    }
  }
  if(btn){
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Show the on-screen script keyboard");
  }
}

/* Drives CSS that hides the tools from guessers and the script keyboard from the
   drawer. A body class rather than per-element display juggling, so the phone and
   desktop rules can differ without any JS branching on viewport width. */
export function setDrawerMode(isDrawer){
  document.body.classList.toggle("is-drawer", !!isDrawer);
  if(isDrawer) closeScriptSheet();
}

function buildKeyboardBar(){
  const bar = $("iastbar");
  if(!bar) return;
  // Rescue the guess form before the wipe below — an open sheet is holding it.
  closeScriptSheet();
  bar.innerHTML = "";
  const groups = state.gameLanguage === "deva"
    ? DEVA_KEY_GROUPS
    : [{ label:"diacritics & special characters", keys: IAST_KEYS }];

  const btn = $("btn-script");
  if(btn) btn.textContent = state.gameLanguage === "deva" ? "अ" : "ā";

  // Only meaningful on the phone bottom-sheet layout — on desktop the bar is
  // always visible inline and .btn-script (the only other way to reopen it)
  // stays hidden, so a close button here would strand the bar shut.
  const head = document.createElement("div");
  head.className = "iastbar-head";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "iastbar-close";
  closeBtn.textContent = "Done";
  closeBtn.setAttribute("aria-label", "Close the on-screen script keyboard");
  closeBtn.onclick = closeScriptSheet;
  head.appendChild(closeBtn);
  bar.appendChild(head);

  groups.forEach(group=>{
    const wrap = document.createElement("div");
    wrap.className = "keygroup";
    if(group.label){
      const lbl = document.createElement("div");
      lbl.className = "keygroup-label";
      lbl.textContent = group.label;
      wrap.appendChild(lbl);
    }
    const row = document.createElement("div");
    row.className = "keyrow";
    group.keys.forEach(([ch,cap])=>{
      // A real button, so the bar is reachable by keyboard and announced by
      // screen readers. These were <div onclick> originally.
      const k = document.createElement("button");
      k.type = "button";
      k.className = "key" + (ch===" " ? " wide" : "") + (state.gameLanguage === "deva" ? " deva" : "");
      k.setAttribute("aria-label", cap);
      k.innerHTML = `<span>${ch===" " ? "␣" : escapeHtml(ch)}</span><span class="cap">${escapeHtml(cap)}</span>`;
      // Keep focus (and the caret) in the input while tapping keys — without
      // this every tap blurs the field for a frame and the caret jumps.
      k.onpointerdown = (e)=>e.preventDefault();
      k.onclick = ()=>insertAtCursor($("guess-input"), ch);
      row.appendChild(k);
    });
    wrap.appendChild(row);
    bar.appendChild(wrap);
  });
}

/* ---------- topbar / scoreboard / chat ---------- */
export function renderTopbar(core){
  $("game-roundinfo").textContent = `Round ${core.round} / ${core.settings.rounds}`;
}

export function renderScoreboard(core){
  const box = $("scorelist");
  if(!box) return;
  box.innerHTML = "";
  const sorted = (core.players||[]).slice().sort((a,b)=>b.score-a.score);
  sorted.forEach(p=>{
    const row = document.createElement("div");
    row.className = "score-row";
    const isDrawer = p.id === core.drawerId;
    const away = isPresenceLoaded() && !isPresent(p.id);
    // The name sits in its own span so it can be ellipsised when the scoreboard is
    // the narrow right-hand column on a phone — without a block to clip, a long
    // name would shove the score out of the column instead of truncating.
    row.innerHTML = `<span class="who"><span class="pip${isDrawer?' drawing':''}"></span>`
      + `<span class="who-name">`
      + escapeHtml(p.name)
      + (p.id === state.myId ? ' (you)' : '')
      + (away ? ' <span style="opacity:.5">· away</span>' : '')
      + `</span></span><span class="pts">${Number(p.score)||0}</span>`;
    box.appendChild(row);
  });
}

export function renderChat(messages){
  const log = $("chatlog");
  if(!log) return;
  log.innerHTML = "";
  (messages||[]).forEach(m=>{
    if(!m) return;
    const div = document.createElement("div");
    div.className = "msg " + (m.type || "guess");
    if(m.type === "guess"){
      div.innerHTML = `<span class="nm">${escapeHtml(m.name)}:</span> ${escapeHtml(m.text)}`;
    } else {
      div.textContent = String(m.text ?? "");
    }
    log.appendChild(div);
  });
  log.scrollTop = log.scrollHeight;
}

/* ---------- end screen ---------- */
export function handleGameEnd(core){
  if(!state.gameEndHandled){
    state.gameEndHandled = true;
    showScreen("screen-end");
    const list = $("final-list");
    list.innerHTML = "";
    const sorted = (core.players||[]).slice().sort((a,b)=>b.score-a.score);
    sorted.forEach((p,i)=>{
      const li = document.createElement("li");
      if(i===0) li.className = "first";
      li.innerHTML = `<span class="rank">#${i+1}</span><span>${escapeHtml(p.name)}`
        + `${p.id === state.myId ? ' (you)' : ''}</span>`
        + `<span class="pts mono">${Number(p.score)||0}</span>`;
      list.appendChild(li);
    });
  }
  // Refreshed on every tick rather than once: if the host leaves while this screen
  // is up, host migration hands the role on and the new host needs "Play again".
  $("btn-again").style.display = state.isHost ? "inline-flex" : "none";
}

export function initEndScreen(){
  const btn = $("btn-again");
  if(!btn) return;
  btn.onclick = async ()=>{
    if(btn.disabled) return;
    btn.disabled = true;
    const res = await coreTransaction(cur=>{
      if(cur.phase !== "gameEnd") return undefined;
      (cur.players||[]).forEach(p=>{ p.score = 0; });
      cur.started = false;
      cur.phase = "lobby";
      cur.word = null; cur.wordKey = null; cur.wordDeva = null; cur.wordCat = null;
      cur.correctIds = [];
      cur.abandoned = false;
      return cur;
    });
    if(res.committed){
      await sRemove(chatKey());
      await sSet(drawKey(), {roundId:null, strokes:[]});
    }
    btn.disabled = false;
  };
}
