import type {Rect} from './room.ts';
import type {OfficeMeeting} from '../../src/shared/meetings.ts';
import {drawText,fit,MICRO,measure} from './font.ts';
import {glassPartition,glassRail} from './partitions.ts';
import {chair,chairFront} from './props.ts';
import {C} from './palette.ts';
import {WALL_H} from './layout.ts';
export const MEETING_BAY=164;
export function withMeetingBay(main:Rect):Rect{return {...main,x:main.x-MEETING_BAY,w:main.w+MEETING_BAY};}
/** An enclosed meeting bay with an office-facing doorway. */
export function meetingRoom(main:Rect):Rect{return {x:main.x-MEETING_BAY,y:4,w:MEETING_BAY,h:194};}
export function meetingTable(room:Rect):Rect{return {x:room.x+32,y:WALL_H+34,w:100,h:40};}
export function meetingSeats(room:Rect){return Array.from({length:8},(_,i)=>({x:room.x+46+(i%4)*24,y:WALL_H+(i<4?20:88),dir:i<4?'down' as const:'up' as const}));}
export function drawMeetingWalls(g:CanvasRenderingContext2D,room:Rect){
 const bottom=room.y+room.h,right=room.x+room.w-12;
 glassPartition(g,room.x,0,bottom);
 // A 32-pixel opening faces the office, beside the table.
 glassPartition(g,right,0,128);glassPartition(g,right,160,bottom-160);
 glassRail(g,room.x,bottom-6,room.w,6);
}
export function drawMeetingRoom(g:CanvasRenderingContext2D,room:Rect,m:OfficeMeeting|null,ascii=false){
 const box=(x:number,y:number,w:number,h:number,c:string)=>{g.fillStyle=c;g.fillRect(x,y,w,h);};
 // The native cloud curtain windows are drawn by the room's static layer.
 // Furniture stays inside the cloud-style side walls and foreground rail.
 box(room.x+5,WALL_H,room.w-10,room.y+room.h-WALL_H-4,ascii?'#171827':'#566257');
 box(room.x+9,WALL_H+4,room.w-18,room.y+room.h-WALL_H-12,ascii?'#111322':'#637162');
 for(const [i,p]of meetingSeats(room).entries()){
   const drawChair=p.dir==='down'?chairFront:chair;
   drawChair(g,p.x,p.y,'omp',!m||i>=m.participants.length);
 }
 const t=meetingTable(room),{x,y,w,h}=t;
 box(x+3,y+4,w,h,C.wood1);box(x,y,w,h,C.wood3);box(x+2,y+2,w-4,h-4,C.wood5);
 box(x+4,y+4,1,h-8,C.wood6);box(x+w-3,y+3,1,h-6,C.wood2);
 const f=MICRO(),title=fit(f,m?.title??'MEETING ROOM',room.w-20),width=measure(f,title)+8;
 box(room.x+8,2,width,10,C.sv0);drawText(g,f,title,room.x+12,4,ascii?C.white:C.cyan4);
 const count=m?m.participants.length+'/8':'8 SEATS';
 drawText(g,f,count,x+Math.floor((w-measure(f,count))/2),WALL_H+2,C.white);
 box(x+42,y+12,19,15,C.white);box(x+51,y+12,1,15,C.slate3);
 box(x+15,y+7,4,4,C.white);box(x+78,y+29,4,4,C.white);
 drawMeetingWalls(g,room);
}
