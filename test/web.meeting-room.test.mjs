import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'office-meetings-')),file=join(dir,'test.mjs');after(()=>rmSync(dir,{recursive:true,force:true}));
await build({stdin:{contents:'export * from "./src/shared/meetings.ts";export * from "./web/scene/meeting-room.ts";export * from "./web/scene/whiteboard.ts";export * from "./web/scene/workers.ts";',resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:file,logLevel:'error',loader:{'.svg':'text'}});
const {Meetings,cleanMeeting,meetingRoom,meetingSeats,whiteboardRect,Crew}=await import(pathToFileURL(file));
test('meeting room contains the whiteboard left of the elevator with eight distinct seats',()=>{
 for(const w of [240,330,1000]){const board=whiteboardRect({x:0,y:0,w,h:400}),room=meetingRoom(board),seats=meetingSeats(board);
 assert.ok(board.x>=room.x&&board.x+board.w<=room.x+room.w);assert.ok(board.y>=room.y&&board.y+board.h<room.y+room.h);assert.ok(room.x+room.w<12);assert.ok(room.y+room.h<=198,'partitions must stay within the smallest office floor');
 assert.equal(new Set(seats.map(p=>p.x+':'+p.y)).size,8);assert.ok(seats.every(p=>p.x>room.x&&p.x<room.x+room.w&&p.y>board.y+board.h&&p.y<room.y+room.h));}
});
test('meeting limits, host rights and source boundaries are enforced',()=>{
 const m=new Meetings(),ts=new Date().toISOString(),start={action:'start',id:'handoff',title:'Handoff'};
 assert.equal(m.apply('s1','owner',start,ts),true);assert.equal(m.apply('s2','intruder',{action:'join',id:'handoff'},ts),false);
 for(let i=0;i<7;i++)assert.equal(m.apply('s1','guest'+i,{action:'join',id:'handoff'},ts),true);
 assert.equal(m.apply('s1','overflow',{action:'join',id:'handoff'},ts),false);
 assert.equal(m.apply('s1','guest0',{action:'end',id:'handoff'},ts),false);
 const snap=m.snapshot();snap[0].participants.length=0;assert.equal(m.snapshot()[0].participants.length,8);
 m.remove('guest0');assert.equal(m.snapshot()[0].participants.length,7);m.remove('owner');assert.deepEqual(m.snapshot(),[]);
 assert.equal(cleanMeeting({action:'start',id:'../bad',title:'Oops'}),null);assert.equal(cleanMeeting({action:'start',id:'good'}),null);
});
test('main characters attend without moving their helpers or changing execution host, then return to the same desks',()=>{
 let now=10000;const crew=new Crew(()=>now),ts=new Date().toISOString(),host={kind:'docker-sandbox',id:'sandbox',name:'Sandbox'};
 const w=(workerId,parentId)=>({workerId,parentId,agent:'omp',project:'Test',host,placement:'cloud',nativeKind:parentId?'sub':'main',status:'thinking',lastTs:ts,toolCalls:0,tokens:0,filesTouched:0});
 crew.load({version:1,startedAt:ts,demo:false,workers:[w('main'),w('helper','main')],recent:[]});crew.update(16);
 const main=crew.workers.get('main'),helper=crew.workers.get('helper'),seat=main.seat,helperSeat=helper.seat,block=main.seat.block,board=whiteboardRect(crew.layout.main);
 crew.setMeeting({id:'m',sourceId:'sandbox',ownerId:'main',title:'Handoff',participants:['main','helper'],updatedAt:ts},meetingSeats(board));crew.update(16);
 assert.equal(main.x,meetingSeats(board)[0].x);assert.equal(main.y,meetingSeats(board)[0].y);assert.equal(main.host.id,'sandbox');assert.equal(main.seat,seat);assert.equal(main.seat.block,block);
 assert.equal(helper.seat,helperSeat);assert.notEqual(helper.x,meetingSeats(board)[1].x);assert.equal(crew.pose(main,now).pose,'sit');
 crew.setMeeting(null,meetingSeats(board));crew.update(16);assert.equal(main.seat,seat);assert.equal(main.x,seat.x);assert.equal(main.y,seat.y);
});
