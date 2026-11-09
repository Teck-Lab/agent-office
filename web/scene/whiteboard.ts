import {FONT,MICRO,drawText,fit,measure} from './font.ts';
import {C} from './palette.ts';
import type {Rect} from './room.ts';
export interface WhiteboardSummary {title:string;current?:string;completed:number;total:number;blocked:number;state:string;}
/** Native plan content fitted to the existing TV; the TV owns its frame/ticker. */
export function drawWhiteboard(g:CanvasRenderingContext2D,tv:Rect,s:WhiteboardSummary,stats:{workers:number;tools:number}){
 const f=FONT(),m=MICRO(),x=tv.x+4,width=tv.w-8;
 const box=(x:number,y:number,w:number,h:number,c:string)=>{g.fillStyle=c;g.fillRect(x,y,w,h);};
 const count=s.completed+'/'+s.total+(s.blocked?' !'+s.blocked:'');
 drawText(g,m,'PLAN',x,tv.y+2,C.gold3);
 drawText(g,m,fit(m,count,Math.max(0,width-22)),tv.x+tv.w-4-Math.min(measure(m,count),width-22),tv.y+2,s.blocked?C.terra4:C.slate5);
 drawText(g,f,fit(f,s.title,width),x,tv.y+11,C.white);
 drawText(g,m,fit(m,s.current??s.state,width),x,tv.y+21,s.blocked?C.terra4:C.blue5);
 box(x,tv.y+28,width,2,C.slate1);
 const ratio=s.total?Math.min(1,Math.max(0,s.completed/s.total)):0;
 if(ratio)box(x,tv.y+28,Math.round(width*ratio),2,C.green4);
 const footer=stats.workers+' CREW '+stats.tools+' TOOLS';
 drawText(g,m,fit(m,footer,width),x,tv.y+tv.h-7,C.slate4);
}
