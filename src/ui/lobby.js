import { $, escapeHtml, shuffle, uid } from "../util.js";
import { CHOOSE_MS } from "../config.js";
import { srvNow } from "../clock.js";
import { state } from "../state.js";
import { isPresent, isPresenceLoaded } from "../net/presence.js";
import { coreTransaction, sSet, sRemove, drawKey, chatKey } from "../net/store.js";
import { pickWords } from "../game/wordpool.js";
import { pushChat } from "../game/chat.js";
import { showScreen } from "./screens.js";

export function renderLobbyScreen(core){
  showScreen("screen-lobby");
  $("lobby-seal").textContent = state.roomCode;
  $("panel-settings").style.display = state.isHost ? "block" : "none";
  $("lobby-wait").style.display = state.isHost ? "none" : "block";

  const ul = $("lobby-players");
  ul.innerHTML = "";
  (core.players||[]).forEach(p=>{
    const away = isPresenceLoaded() && !isPresent(p.id);
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(p.name)}`
      + (p.id === core.hostId ? '<span class="tag">HOST</span>' : '')
      + (p.id === state.myId ? ' (you)' : '')
      + (away ? ' <span style="opacity:.5">· away</span>' : '')
      + `</span>`;
    ul.appendChild(li);
  });
}

/* Seeds the settings form from stored values exactly once per lobby visit.
   After that, further snapshots (the 500ms tick, other players joining) must NOT
   touch these fields, or they'd stomp on whatever the host is actively picking
   before hitting "Start game". */
export function syncSettingsForm(core){
  const s = core.settings || {};
  $("set-rounds").value = s.rounds || 3;
  $("set-time").value   = s.drawSeconds || 80;
  $("set-diff").value   = s.difficulty || "mixed";
  $("set-lang").value   = s.language || "iast";
}

export function initLobby(){
  const copy = $("btn-copy");
  if(copy) copy.onclick = async ()=>{
    try{
      await navigator.clipboard.writeText(state.roomCode);
      const old = copy.textContent;
      copy.textContent = "copied!";
      setTimeout(()=>{ copy.textContent = old; }, 1200);
    }catch(e){}
  };

  const start = $("btn-start");
  if(start) start.onclick = async ()=>{
    if(start.disabled) return;
    start.disabled = true;

    const rounds      = parseInt($("set-rounds").value,10);
    const drawSeconds = parseInt($("set-time").value,10);
    const difficulty  = $("set-diff").value;
    const language    = $("set-lang").value;

    let reason = null;
    const res = await coreTransaction(cur=>{
      reason = null;
      if((cur.players||[]).length < 2){ reason = "players"; return undefined; }
      if(cur.phase !== "lobby"){ reason = "started"; return undefined; }
      cur.settings = {rounds, drawSeconds, difficulty, language};
      cur.started = true;
      // Only seat players who are actually here, so the turn order doesn't include
      // someone who closed their tab while sitting in the lobby.
      const seated = (cur.players||[]).filter(p=>isPresent(p.id)).map(p=>p.id);
      cur.order = shuffle(seated.length >= 2 ? seated : (cur.players||[]).map(p=>p.id));
      cur.round = 1;
      cur.drawerIdx = 0;
      cur.drawerId = cur.order[0];
      cur.roundId = uid();
      cur.usedWords = [];
      cur.wordChoices = pickWords(difficulty, [], 3, language);
      cur.word = null; cur.wordKey = null; cur.wordDeva = null; cur.wordCat = null;
      cur.correctIds = [];
      cur.abandoned = false;
      cur.chooseDeadline = srvNow() + CHOOSE_MS;
      cur.phase = "choosing";
      return cur;
    });

    if(!res.committed){
      if(reason === "players")      alert("Need at least 2 players to start.");
      else if(reason === "started") alert("The game has already started.");
      else                          alert("Couldn't start the game — check your connection and try again.");
      start.disabled = false;
      return;
    }

    await sSet(drawKey(), {roundId: res.value.roundId, strokes:[]});
    await sRemove(chatKey());
    await pushChat({id:uid(), type:"system", text:`Game started — ${rounds} rounds, ${drawSeconds}s each.`, ts:srvNow()});
    start.disabled = false;   // ready again for the next "Play again" cycle
  };
}
