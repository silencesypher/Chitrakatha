/* ================= CANVAS =================
   Owns all local drawing state. Nothing outside this module touches the stroke
   array, the current tool, or the redo stack — they cross the boundary through
   the exported functions below. */
import { BG_COLOR } from "../config.js";
import { $ } from "../util.js";
import { state, amIDrawerNow, currentPhase } from "../state.js";
import { sSet, sGet, drawKey } from "../net/store.js";

let ctx = null;
let strokes = [];              // was localStrokes
let redoStack = [];
let dirty = false;             // was drawDirty
let isDrawingStroke = false;
let shapeStart = null;         // [x,y] while dragging a line/rect/circle
let curTool = "brush";         // brush | eraser | line | rect | circle | fill
let curColor = "#2e2418";
let curSize = 7;
let bound = false;             // pointer handlers attached exactly once

/* ---------- lifecycle ---------- */

/* Runs on every entry to the game screen. The per-entry work (context state,
   clearing the surface) repeats; only the event binding is guarded.

   The bug this guard fixes: enterGameScreenUI runs again after every "Play again",
   so the previous version re-registered pointerdown/pointermove each time and
   game two recorded every pointer event twice, game three three times. */
export function setupCanvas(){
  const canvas = $("board");
  if(!canvas) return;
  ctx = canvas.getContext("2d");
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  clearCanvasPixels();

  if(bound) return;
  bound = true;

  function pos(e){
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width/rect.width, sy = canvas.height/rect.height;
    return [(e.clientX - rect.left)*sx, (e.clientY - rect.top)*sy];
  }
  function commitStroke(stroke){
    strokes.push(stroke);
    redoStack = [];
    dirty = true;
  }
  function down(e){
    if(!amIDrawerNow() || currentPhase() !== "drawing") return;
    e.preventDefault();
    const [x,y] = pos(e);

    if(curTool === "fill"){
      floodFillAt(x, y, curColor);
      commitStroke({type:"fill", x, y, color:curColor});
      flushStrokesIfDirty();
      return;
    }
    if(curTool === "line" || curTool === "rect" || curTool === "circle"){
      shapeStart = [x,y];
      isDrawingStroke = true;
      return;
    }
    // brush / eraser (freehand)
    isDrawingStroke = true;
    // Starting any new stroke invalidates the redo history. The freehand path
    // pushes straight into `strokes` rather than going through commitStroke, so
    // it used to skip this and "redo" could resurrect a stroke from before the undo.
    redoStack = [];
    const strokeColor = curTool === "eraser" ? BG_COLOR : curColor;
    strokes.push({type:"freehand", color:strokeColor, size:curSize, points:[[x,y]]});
    dirty = true;
  }
  function move(e){
    if(!isDrawingStroke) return;
    e.preventDefault();
    const [x,y] = pos(e);

    if(shapeStart){
      // live preview: repaint committed strokes, then the shape-in-progress on top
      redrawAllStrokes(strokes);
      const strokeColor = curTool === "eraser" ? BG_COLOR : curColor;
      drawShape(curTool, shapeStart[0], shapeStart[1], x, y, strokeColor, curSize);
      return;
    }
    const stroke = strokes[strokes.length-1];
    if(!stroke || !stroke.points) return;
    const [px,py] = stroke.points[stroke.points.length-1];
    stroke.points.push([x,y]);
    ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.size;
    ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(x,y); ctx.stroke();
    dirty = true;
  }
  function up(e){
    if(!isDrawingStroke) return;
    isDrawingStroke = false;
    if(shapeStart){
      const [x,y] = pos(e);
      const strokeColor = curTool === "eraser" ? BG_COLOR : curColor;
      commitStroke({type:curTool, x1:shapeStart[0], y1:shapeStart[1], x2:x, y2:y, color:strokeColor, size:curSize});
      shapeStart = null;
      redrawAllStrokes(strokes);
    }
    flushStrokesIfDirty();
  }

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  // Pointer Events already unify mouse/touch/pen on all modern browsers, so no
  // separate touchstart/touchmove listeners (those would fire twice per touch).
}

export function setupToolbar(){
  document.querySelectorAll(".swatch").forEach(sw=>{
    sw.onclick = ()=>{
      document.querySelectorAll(".swatch").forEach(s=>s.classList.remove("active"));
      sw.classList.add("active");
      curColor = sw.dataset.c;
    };
  });
  document.querySelectorAll(".sizebtn").forEach(sb=>{
    sb.onclick = ()=>{
      document.querySelectorAll(".sizebtn").forEach(s=>s.classList.remove("active"));
      sb.classList.add("active");
      curSize = parseInt(sb.dataset.s,10);
    };
  });
  document.querySelectorAll(".toolbtn").forEach(tb=>{
    tb.onclick = ()=>{
      document.querySelectorAll(".toolbtn").forEach(t=>t.classList.remove("active"));
      tb.classList.add("active");
      curTool = tb.dataset.tool;
      shapeStart = null;
      isDrawingStroke = false;
    };
  });
  const clear = $("btn-clear");
  if(clear) clear.onclick = async ()=>{
    if(!amIDrawerNow()) return;
    strokes = [];
    redoStack = [];
    clearCanvasPixels();
    await publishStrokes([]);
  };
  const undo = $("btn-undo");
  if(undo) undo.onclick = ()=>{
    if(!amIDrawerNow() || currentPhase() !== "drawing") return;
    if(strokes.length === 0) return;
    redoStack.push(strokes.pop());
    redrawAllStrokes(strokes);
    dirty = true;
    flushStrokesIfDirty();
  };
  const redo = $("btn-redo");
  if(redo) redo.onclick = ()=>{
    if(!amIDrawerNow() || currentPhase() !== "drawing") return;
    if(redoStack.length === 0) return;
    strokes.push(redoStack.pop());
    redrawAllStrokes(strokes);
    dirty = true;
    flushStrokesIfDirty();
  };
}

/* Called by the phase handlers at the start of a new round. */
export function resetLocalBoard({resetTool = false} = {}){
  strokes = [];
  redoStack = [];
  shapeStart = null;
  isDrawingStroke = false;
  dirty = false;
  clearCanvasPixels();
  if(resetTool){
    curTool = "brush";
    document.querySelectorAll(".toolbtn").forEach(t=>t.classList.toggle("active", t.dataset.tool === "brush"));
  }
}

/* ---------- painting ---------- */
function clearCanvasPixels(){
  const canvas = $("board");
  if(!canvas || !ctx) return;
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0,0,canvas.width,canvas.height);
}

function drawShape(type, x1, y1, x2, y2, color, size){
  ctx.strokeStyle = color; ctx.lineWidth = size;
  ctx.beginPath();
  if(type === "line"){
    ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
  } else if(type === "rect"){
    ctx.rect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
  } else if(type === "circle"){
    const cx=(x1+x2)/2, cy=(y1+y2)/2, rx=Math.abs(x2-x1)/2, ry=Math.abs(y2-y1)/2;
    ctx.ellipse(cx, cy, Math.max(rx,0.01), Math.max(ry,0.01), 0, 0, Math.PI*2);
  }
  ctx.stroke();
}

function hexToRgb(hex){
  const h = String(hex||"").replace("#","");
  return {
    r: parseInt(h.substring(0,2),16),
    g: parseInt(h.substring(2,4),16),
    b: parseInt(h.substring(4,6),16)
  };
}

/* Note: this is a full-canvas getImageData + scanline fill + putImageData, and
   redrawAllStrokes replays it for every fill stroke on every repaint. It is the
   most expensive thing in the render path — see the performance notes in README. */
function floodFillAt(x, y, fillColorHex){
  const canvas = $("board");
  if(!canvas || !ctx) return;
  const w = canvas.width, h = canvas.height;
  x = Math.round(x); y = Math.round(y);
  if(x<0||y<0||x>=w||y>=h) return;
  const imgData = ctx.getImageData(0,0,w,h);
  const data = imgData.data;
  const startI = (y*w+x)*4;
  const tR=data[startI], tG=data[startI+1], tB=data[startI+2], tA=data[startI+3];
  const fc = hexToRgb(fillColorHex);
  if(fc.r===tR && fc.g===tG && fc.b===tB && tA===255) return;   // already this colour
  const tol = 48, tolSq = tol*tol;
  const visited = new Uint8Array(w*h);
  const stack = [y*w+x];
  while(stack.length){
    const p = stack.pop();
    if(visited[p]) continue;
    const i = p*4;
    const dr=data[i]-tR, dg=data[i+1]-tG, db=data[i+2]-tB, da=data[i+3]-tA;
    if((dr*dr+dg*dg+db*db+da*da) > tolSq) continue;
    visited[p] = 1;
    data[i]=fc.r; data[i+1]=fc.g; data[i+2]=fc.b; data[i+3]=255;
    const px = p % w;
    if(px>0)     stack.push(p-1);
    if(px<w-1)   stack.push(p+1);
    if(p>=w)     stack.push(p-w);
    if(p<w*(h-1))stack.push(p+w);
  }
  ctx.putImageData(imgData, 0, 0);
}

export function redrawAllStrokes(list){
  if(!ctx) return;
  clearCanvasPixels();
  (list||[]).forEach(stroke=>{
    if(!stroke) return;
    if(stroke.type === "fill"){
      floodFillAt(stroke.x, stroke.y, stroke.color);
      return;
    }
    if(stroke.type === "line" || stroke.type === "rect" || stroke.type === "circle"){
      drawShape(stroke.type, stroke.x1, stroke.y1, stroke.x2, stroke.y2, stroke.color, stroke.size);
      return;
    }
    // freehand (also the default for legacy strokes with no type field)
    if(!stroke.points || stroke.points.length < 2){
      if(stroke.points && stroke.points.length === 1){
        ctx.fillStyle = stroke.color;
        ctx.beginPath();
        ctx.arc(stroke.points[0][0], stroke.points[0][1], stroke.size/2, 0, Math.PI*2);
        ctx.fill();
      }
      return;
    }
    ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.size;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0][0], stroke.points[0][1]);
    for(let i=1;i<stroke.points.length;i++) ctx.lineTo(stroke.points[i][0], stroke.points[i][1]);
    ctx.stroke();
  });
}

/* ---------- publishing ----------
   Still the naive whole-array upload every FLUSH_MS. Replacing it with an
   append-only log (push + child_added) is the biggest remaining perf win, and
   this function plus the draw listener in net/listeners.js are the only two
   places that would need to change. */
async function publishStrokes(list){
  const roundId = state.core ? state.core.roundId : state.roundIdSeen;
  return sSet(drawKey(), {roundId, strokes:list});
}

export async function flushStrokesIfDirty(){
  if(!dirty) return;
  if(!amIDrawerNow()) return;
  dirty = false;
  const res = await publishStrokes(strokes);
  // Put the flag back on failure, or these strokes are lost unless the drawer
  // happens to keep drawing.
  if(res && res.ok === false) dirty = true;
}

/* ---------- board hydration on entering the game screen ----------
   The live draw listener in net/listeners.js has two escape hatches that both
   trigger when someone arrives mid-round, and neither fires again until the
   drawer moves:

     · the drawer is skipped entirely, so their local stroke array stays empty and
       their next stroke would publish an array of one, wiping everyone's view;
     · a guesser's first draw callback can arrive before the core listener has set
       state.core, hitting the stale-round guard — and then setupCanvas() clears
       the surface, leaving a blank board for the rest of the round.

   So the board is read once, explicitly. This is called from enterGameScreenUI,
   which covers BOTH arrival paths (refresh-resume and a fresh join into a game
   already in progress) and is guaranteed to run after state.core exists — unlike
   the timer-based hook this replaces, which raced the core listener and silently
   did nothing if the snapshot took longer than 400ms to land. */
export async function hydrateBoard(){
  if(!state.core || !state.core.roundId) return;
  const d = await sGet(drawKey());
  if(!d || d.roundId !== state.core.roundId) return;
  const list = d.strokes || [];
  // The drawer adopts them as their own, so subsequent flushes append rather
  // than replace. Everyone else just repaints.
  if(amIDrawerNow()){
    strokes = Array.isArray(list) ? list.slice() : [];
    redoStack = [];
    dirty = false;
  }
  redrawAllStrokes(strokes.length ? strokes : list);
}

