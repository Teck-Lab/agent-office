import type {Rect} from './room.ts';
import type {OfficeMeeting} from '../../src/shared/meetings.ts';
import {drawText,fit,MICRO,measure} from './font.ts';
import {chair} from './props.ts';
import {C} from './palette.ts';
import {WALL_H} from './layout.ts';
export const MEETING_BAY=164;
export function withMeetingBay(main:Rect):Rect{return {...main,x:main.x-MEETING_BAY,w:main.w+MEETING_BAY};}
/** A separate floor area, without additional side/front partitions. */
export function meetingRoom(main:Rect):Rect{return {x:main.x-MEETING_BAY+4,y:4,w:156,h:188};}
export function meetingTable(room:Rect):Rect{return {x:room.x+58,y:WALL_H+10,w:40,h:100};}
export function meetingSeats(room:Rect){return Array.from({length:8},(_,i)=>({x:room.x+(i<4?37:119),y:WALL_H+20+(i%4)*24,dir:i<4?'right' as const:'left' as const}));}
export function drawMeetingRoom(g:CanvasRenderingContext2D,room:Rect,m:OfficeMeeting|null,ascii=false){
 const box=(x:number,y:number,w:number,h:number,c:string)=>{g.fillStyle=c;g.fillRect(x,y,w,h);};
 // The native cloud curtain windows are drawn by the room's static layer.
 // A rug defines this area; no custom walls or glass-outline partitions.
 box(room.x+5,WALL_H,room.w-10,room.y+room.h-WALL_H-4,ascii?'#171827':'#566257');
 box(room.x+9,WALL_H+4,room.w-18,room.y+room.h-WALL_H-12,ascii?'#111322':'#637162');
 for(const [i,p]of meetingSeats(room).entries()){
   g.save();g.translate(p.x,p.y);g.rotate(p.dir==='right'?Math.PI/2:-Math.PI/2);
   chair(g,0,0,'omp',!m||i>=m.participants.length);g.restore();
 }
 const t=meetingTable(room),{x,y,w,h}=t;
 box(x+3,y+4,w,h,C.wood1);box(x,y,w,h,C.wood3);box(x+2,y+2,w-4,h-4,C.wood5);
 box(x+4,y+4,1,h-8,C.wood6);box(x+w-3,y+3,1,h-6,C.wood2);
 const f=MICRO(),title=fit(f,m?.title??'MEETING ROOM',room.w-20),width=measure(f,title)+8;
 box(room.x+8,2,width,10,C.sv0);drawText(g,f,title,room.x+12,4,ascii?C.white:C.cyan4);
 const count=m?m.participants.length+'/8':'8 SEATS';
 drawText(g,f,count,x+Math.floor((w-measure(f,count))/2),WALL_H+2,C.white);
 box(x+12,y+42,15,19,C.white);box(x+12,y+51,15,1,C.slate3);
 box(x+7,y+15,4,4,C.white);box(x+29,y+78,4,4,C.white);
}
