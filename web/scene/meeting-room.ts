import type {Rect} from './room.ts';
import type {OfficeMeeting} from '../../src/shared/meetings.ts';
import {drawText,fit,MICRO} from './font.ts';
export function meetingRoom(board:Rect):Rect{return {x:board.x-8,y:board.y-6,w:156,h:206};}
export function meetingSeats(board:Rect){return Array.from({length:8},(_,i)=>({x:board.x+25+(i%4)*29,y:i<4?111:180,dir:i<4?'down' as const:'up' as const}));}
export function drawMeetingRoom(g:CanvasRenderingContext2D,board:Rect,m:OfficeMeeting|null,ascii=false){
 const r=meetingRoom(board),box=(x:number,y:number,w:number,h:number,c:string)=>{g.fillStyle=c;g.fillRect(x,y,w,h);};
 // Glass partition, doorway at bottom, conference carpet and oak table.
 box(r.x,r.y+69,r.w,126,ascii?'#111322':'#3e545b');box(r.x+5,r.y+74,r.w-10,116,ascii?'#171827':'#527079');
 box(r.x,r.y,2,r.h,'#88acaf');box(r.x+r.w-2,r.y,2,r.h,'#88acaf');
 box(r.x,r.y+r.h,r.w/2-18,2,'#88acaf');box(r.x+r.w/2+18,r.y+r.h,r.w/2-18,2,'#88acaf');
 for(const p of meetingSeats(board)){box(p.x-8,p.y-5,16,8,'#263b4b');box(p.x-7,p.y-6,14,4,'#749b9c');}
 const x=r.x+20,y=125;box(x+3,y+8,116,43,'#243b41');box(x,y,116,39,'#795540');box(x+2,y+2,112,34,'#b78b62');box(x+5,y+4,106,1,'#d6ad7b');
 drawText(g,MICRO(),fit(MICRO(),m?.title??'MEETING ROOM',126),r.x+10,63,ascii?'#ffffff':'#dce9df');
 drawText(g,MICRO(),m?m.participants.length+'/8 IN MEETING':'MAIN SESSIONS ONLY',r.x+10,74,'#dce9df');
 // Notebook and mugs are intentionally modest, leaving sprites readable.
 box(x+48,y+10,18,13,'#e6e6d7');box(x+56,y+10,1,13,'#879e9d');box(x+13,y+12,4,4,'#e6e6d7');box(x+95,y+20,4,4,'#e6e6d7');
}
