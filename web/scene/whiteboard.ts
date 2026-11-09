import { FONT, MICRO, drawText, fit, measure } from './font.ts';
import type { Rect } from './room.ts';
export interface WhiteboardSummary { title:string; current?:string; completed:number; total:number; blocked:number; state:string; }
export const WHITEBOARD_BAY = 164;
/** Expand the rendered room to the left without moving any worker or its pod. */
export function withWhiteboardBay(r:Rect):Rect {return {...r,x:r.x-WHITEBOARD_BAY,w:r.w+WHITEBOARD_BAY};}
export function whiteboardRect(main:Rect):Rect {
  return {x:main.x-WHITEBOARD_BAY+12,y:10,w:140,h:44};
}
export function drawWhiteboard(g:CanvasRenderingContext2D,r:Rect,s:WhiteboardSummary|null,ascii=false){
  const box=(x:number,y:number,w:number,h:number,c:string)=>{g.fillStyle=c;g.fillRect(x,y,w,h);};
  box(r.x+2,r.y+3,r.w,r.h,'#18232a');box(r.x,r.y,r.w,r.h,'#8a7361');
  box(r.x+2,r.y+2,r.w-4,r.h-4,ascii?'#ffffff':'#ecebdc');
  const f=MICRO(),ink=ascii?'#000000':'#244442';
  drawText(g,f,'PLAN',r.x+6,r.y+6,ink);
  box(r.x+6,r.y+15,r.w-12,1,'#b0b8a9');
  drawText(g,FONT(),fit(FONT(),s?.title??'NO GOAL',r.w-12),r.x+6,r.y+20,ink);
  drawText(g,f,fit(f,s?.current??s?.state??'CLICK TO OPEN',r.w-12),r.x+6,r.y+31,ink);
  const label=s?s.completed+'/'+s.total+(s.blocked?' !'+s.blocked:''):'OMP TASKS';
  drawText(g,f,label,r.x+r.w-6-measure(f,label),r.y+6,s?.blocked?'#a24c32':ink);
  box(r.x+6,r.y+r.h-4,12,2,'#5a9277');box(r.x+20,r.y+r.h-4,8,2,'#647b9a');
}
