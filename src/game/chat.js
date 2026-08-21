import { $, uid } from "../util.js";
import { srvNow } from "../clock.js";
import { state } from "../state.js";
import { coreTransaction, sPush, chatListKey } from "../net/store.js";
import { isCorrectGuess } from "./matching.js";

/* push() appends under a server-generated key, so simultaneous messages land side
   by side. The original read the whole array, appended, and wrote it back — two
   people typing at once and one message disappeared. */
export async function pushChat(msg){
  return sPush(chatListKey(), msg);
}

export function initGuessForm(){
  const form = $("guessform");
  if(!form) return;
  form.onsubmit = async (e)=>{
    e.preventDefault();
    const input = $("guess-input");
    const text = input.value.trim();
    if(!text) return;
    input.value = "";

    const core = state.core;
    if(!core || core.phase !== "drawing") return;
    if(core.drawerId === state.myId) return;
    if((core.correctIds||[]).includes(state.myId)) return;

    const roundIdAtGuess = core.roundId;

    if(isCorrectGuess(core, text)){
      let awarded = 0;
      // Scoring is a single atomic read-modify-write. Two players who submit the
      // correct word in the same instant both keep their points, and neither one
      // drops the other from correctIds.
      const res = await coreTransaction(cur=>{
        if(cur.phase !== "drawing" || cur.roundId !== roundIdAtGuess) return undefined;
        if((cur.correctIds||[]).includes(state.myId)) return undefined;
        const total  = cur.settings.drawSeconds*1000;
        const remain = Math.max(0, cur.roundEndAt - srvNow());   // shared clock
        const pts    = Math.round(50 + 450*(remain/total));
        const drawerBonus = Math.round(pts*0.2);
        cur.correctIds = (cur.correctIds||[]).concat([state.myId]);
        const me     = (cur.players||[]).find(p=>p.id === state.myId);
        const drawer = (cur.players||[]).find(p=>p.id === cur.drawerId);
        if(me)     me.score     = (Number(me.score)||0) + pts;
        if(drawer) drawer.score = (Number(drawer.score)||0) + drawerBonus;
        awarded = pts;
        return cur;
      });
      if(res.committed){
        await pushChat({id:uid(), type:"correct", text:`${state.myName} guessed the word! (+${awarded})`, ts:srvNow()});
      }
    } else {
      await pushChat({id:uid(), type:"guess", name:state.myName, text, ts:srvNow()});
    }
  };
}
