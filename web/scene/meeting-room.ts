import type {Rect} from './room.ts';
import type {OfficeMeeting} from '../../src/shared/meetings.ts';
import {drawText,fit,MICRO} from './font.ts';
import {chair} from './props.ts';
import {C} from './palette.ts';
import {WALL_H} from './layout.ts';
export function meetingRoom(board:Rect):Rect{return {x:board.x-8,y:board.y-6,w:156,h:188};}
export function meetingSeats(board:Rect){return Array.from({length:8},(_,i)=>({x:board.x+25+(i%4)*29,y:i<4?111:180,dir:i<4?'down' as const:'up' as const}));}
export function drawMeetingRoom(g:CanvasRenderingContext2D,board:Rect,m:OfficeMeeting|null,ascii=false){
 const r=meetingRoom(board),box=(x:number,y:number,w:number,h:number,c:string)=>{g.fillStyle=c;g.fillRect(x,y,w,h);};
 // Plaster and wood match the office. Keep every wall inside the minimum
 // 198px office floor; the previous 210px glass outline protruded below it.
 const bottom=r.y+r.h;
 box(r.x+5,WALL_H,r.w-10,bottom-WALL_H-5,ascii?'#171827':'#566257');
 box(r.x+9,WALL_H+4,r.w-18,bottom-WALL_H-13,ascii?'#111322':'#637162');
 const right=r.x+r.w-5;
 box(right,WALL_H-4,5,bottom-WALL_H+4,C.wall3);
 box(right,WALL_H-4,1,bottom-WALL_H+4,C.wall5);
 box(right+4,WALL_H-4,1,bottom-WALL_H+4,C.wood2);
 const doorLeft=r.x+r.w/2-18,doorRight=r.x+r.w/2+18;
 for(const [x,w]of [[r.x,doorLeft-r.x],[doorRight,r.x+r.w-doorRight]]){
   box(x,bottom-5,w,5,C.wall3);box(x,bottom-5,w,1,C.wall5);box(x,bottom-1,w,1,C.wood2);
 }
 for(const [i,p]of meetingSeats(board).entries())chair(g,p.x,p.y,'omp',!m||i>=m.participants.length);
 const x=r.x+20,y=125;box(x+3,y+8,116,43,'#243b41');box(x,y,116,39,'#795540');box(x+2,y+2,112,34,'#b78b62');box(x+5,y+4,106,1,'#d6ad7b');
 drawText(g,MICRO(),fit(MICRO(),m?.title??'MEETING ROOM',126),r.x+10,63,ascii?'#ffffff':'#dce9df');
 drawText(g,MICRO(),m?m.participants.length+'/8 IN MEETING':'MAIN SESSIONS ONLY',r.x+10,74,'#dce9df');
 // Notebook and mugs are intentionally modest, leaving sprites readable.
 box(x+48,y+10,18,13,'#e6e6d7');box(x+56,y+10,1,13,'#879e9d');box(x+13,y+12,4,4,'#e6e6d7');box(x+95,y+20,4,4,'#e6e6d7');
}
