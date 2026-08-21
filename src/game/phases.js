/* ================= PHASE HANDLERS =================
   Each of these runs on every core snapshot AND on the local tick, so they must be
   idempotent: rendering is a plain function of the snapshot, and every state
   transition is guarded by a transaction that re-checks phase and roundId. */
import { DRAWER_GRACE_MS, ROUND_END_MS } from "../config.js";
import { $, escapeHtml, uid } from "../util.js";
import { srvNow } from "../clock.js";
import { state, amIDrawerNow } from "../state.js";
import { coreTransaction, sSet, drawKey } from "../net/store.js";
import { isPresent, absentFor, presentSnapshot } from "../net/presence.js";
import { advanceToNextTurn, applyWordChoice, maskWord, everyoneGuessed } from "./rounds.js";
import { pushChat } from "./chat.js";
import { resetLocalBoard } from "../ui/canvas.js";
import { setDrawerMode, closeScriptSheet } from "../ui/gamescreen.js";

async function resetBoardForRound(roundId){
  if(roundId) await sSet(drawKey(), {roundId, strokes:[]});
}

function playerNameIn(core, id, fallback){
  const p = (core.players||[]).find(x=>x.id === id);
  return (p && p.name) || fallback;
}

/* ---------- choosing ---------- */
export async function handleChoosing(core){
  $("choose-overlay").style.display = "none";
  $("wait-overlay").style.display = "none";
  $("roundend-banner").style.display = "none";
  $("drawer-toolbar").style.display = "none";
  $("guessform").classList.add("disabled");
  $("game-maskword").style.display = "none";
  $("game-timer").textContent = "--";

  if(core.roundId !== state.roundIdSeen){
    state.roundIdSeen = core.roundId;
    state.choiceMade = false;
    resetLocalBoard({resetTool:true});
  }

  setDrawerMode(amIDrawerNow());

  if(amIDrawerNow()){
    if(!state.choiceMade){
      $("choose-overlay").style.display = "flex";
      const btnBox = $("choose-btns");
      btnBox.innerHTML = "";
      (core.wordChoices||[]).forEach(wc=>{
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = wc.word;
        b.onclick = ()=>chooseWord(wc);
        btnBox.appendChild(b);
      });
    }
  } else {
    const drawerName = playerNameIn(core, core.drawerId, "someone");
    $("wait-overlay").style.display = "flex";
    // textContent, not innerHTML — escaping here would print literal &amp; entities.
    $("wait-title").textContent = isPresent(core.drawerId)
      ? `${drawerName} is choosing a word…`
      : `Waiting for ${drawerName} to reconnect…`;
  }

  // The drawer left before picking anything: hand the turn on rather than making
  // everyone sit out the full choose window.
  if(!state.skippingDrawer && !isPresent(core.drawerId) && absentFor(core.drawerId, DRAWER_GRACE_MS)){
    state.skippingDrawer = true;
    const goneName = playerNameIn(core, core.drawerId, "the drawer");
    const snapshot = presentSnapshot();
    const res = await coreTransaction(cur=>{
      if(cur.phase !== "choosing" || cur.roundId !== core.roundId) return undefined;
      return advanceToNextTurn(cur, snapshot);
    });
    state.skippingDrawer = false;
    if(res.committed){
      await resetBoardForRound(res.value.roundId);
      await pushChat({id:uid(), type:"system", text:`${goneName} left — skipping their turn.`, ts:srvNow()});
    }
    return;
  }

  if(srvNow() > core.chooseDeadline){
    await coreTransaction(cur=>{
      if(cur.phase !== "choosing" || cur.roundId !== core.roundId) return undefined;
      const wc = (cur.wordChoices||[])[0];
      if(!wc) return undefined;
      return applyWordChoice(cur, wc);
    });
  }
}

async function chooseWord(wc){
  state.choiceMade = true;
  resetLocalBoard();
  const roundIdAtChoice = state.core ? state.core.roundId : null;
  const res = await coreTransaction(cur=>{
    if(cur.phase !== "choosing" || cur.roundId !== roundIdAtChoice) return undefined;
    return applyWordChoice(cur, wc);
  });
  if(!res.committed){
    state.choiceMade = false;    // let them try again if the write didn't land
    return;
  }
  await resetBoardForRound(res.value.roundId);
}

/* ---------- drawing ---------- */
export async function handleDrawing(core){
  $("choose-overlay").style.display = "none";
  $("wait-overlay").style.display = "none";
  $("roundend-banner").style.display = "none";

  if(core.roundId !== state.roundIdSeen) state.roundIdSeen = core.roundId;

  const amDrawer = amIDrawerNow();
  setDrawerMode(amDrawer);
  $("drawer-toolbar").style.display = amDrawer ? "flex" : "none";
  $("guessform").classList.toggle("disabled", amDrawer || (core.correctIds||[]).includes(state.myId));

  const total  = core.settings.drawSeconds*1000;
  const remain = Math.max(0, core.roundEndAt - srvNow());        // shared clock
  const elapsedFrac = 1 - (remain/total);
  $("game-timer").textContent = Math.ceil(remain/1000) + "s";
  $("game-timer").classList.toggle("low", remain < 12000);

  $("game-maskword").style.display = "block";
  if(amDrawer){
    // core.wordCat is stored when the word is chosen, instead of looking the
    // category back up by matching on the word string.
    $("game-maskword").innerHTML =
      `${escapeHtml(core.word)}<span class="cat">drawing · ${escapeHtml(core.wordCat||"")}</span>`;
  } else {
    $("game-maskword").innerHTML = maskWord(core.word, elapsedFrac, core.roundId);
  }

  if(!amDrawer){
    $("guess-input").placeholder =
      (core.correctIds||[]).includes(state.myId) ? "you guessed it! ✅" : "type your guess…";
  }

  // The drawer vanished mid-drawing. End the round now and reveal the word, rather
  // than leaving everyone staring at a frozen canvas for the full timer.
  if(!state.skippingDrawer && !isPresent(core.drawerId) && absentFor(core.drawerId, DRAWER_GRACE_MS)){
    state.skippingDrawer = true;
    const res = await coreTransaction(cur=>{
      if(cur.phase !== "drawing" || cur.roundId !== core.roundId) return undefined;
      cur.phase = "roundEnd";
      cur.abandoned = true;
      cur.roundEndReveal = srvNow() + ROUND_END_MS;
      return cur;
    });
    state.skippingDrawer = false;
    if(res.committed) return;
  }

  if(remain <= 0 || everyoneGuessed(core, isPresent)){
    // Any client may notice this first; the transaction's phase/roundId guard means
    // only the first one to commit wins. The round-end banner (not a chat message)
    // is what reveals the word — avoids duplicate announcements.
    await coreTransaction(cur=>{
      if(cur.phase !== "drawing" || cur.roundId !== core.roundId) return undefined;
      cur.phase = "roundEnd";
      cur.roundEndReveal = srvNow() + ROUND_END_MS;
      return cur;
    });
  }
}

/* ---------- round end ---------- */
export async function handleRoundEnd(core){
  closeScriptSheet();
  $("drawer-toolbar").style.display = "none";
  $("choose-overlay").style.display = "none";
  $("wait-overlay").style.display = "none";
  $("guessform").classList.add("disabled");
  $("game-maskword").style.display = "none";
  $("game-timer").textContent = "--";
  $("game-timer").classList.remove("low");
  $("roundend-banner").style.display = "flex";
  $("re-cat").textContent = core.wordCat || "";
  $("re-word").textContent = core.word || "";

  const ul = $("re-scorers");
  ul.innerHTML = "";
  const names = (core.correctIds||[])
    .map(id=>playerNameIn(core, id, null))
    .filter(Boolean);
  const li = document.createElement("li");
  if(core.abandoned)      li.textContent = "The drawer left before the round finished.";
  else if(names.length)   li.textContent = "Guessed correctly: " + names.join(", ");
  else                    li.textContent = "No one guessed it this round.";
  ul.appendChild(li);

  if(srvNow() > (core.roundEndReveal||0)){
    const snapshot = presentSnapshot();
    const res = await coreTransaction(cur=>{
      if(cur.phase !== "roundEnd" || cur.roundId !== core.roundId) return undefined;
      return advanceToNextTurn(cur, snapshot);
    });
    if(res.committed && res.value.phase === "choosing"){
      await resetBoardForRound(res.value.roundId);
    }
  }
}
