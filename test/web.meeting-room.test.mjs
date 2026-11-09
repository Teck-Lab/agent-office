import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'office-meetings-')),file=join(dir,'test.mjs');after(()=>rmSync(dir,{recursive:true,force:true}));
await build({stdin:{contents:'export * from "./src/shared/meetings.ts";export * from "./web/scene/meeting-room.ts";export * from "./web/scene/whiteboard.ts";export {tvScreen} from "./web/scene/room.ts";export * from "./web/scene/workers.ts";',resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:file,logLevel:'error',loader:{'.svg':'text'}});
const {Meetings,cleanMeeting,meetingRoom,meetingSeats,meetingTable,drawMeetingWalls,drawWhiteboard,tvScreen,Crew}=await import(pathToFileURL(file));
test('horizontal meeting table and eight inward-facing seats fit the smallest office floor',()=>{
 for(const w of [240,330,1000]){const room=meetingRoom({x:0,y:0,w,h:198}),seats=meetingSeats(room),table=meetingTable(room);
   assert.ok(room.x+room.w<12);assert.ok(room.y+room.h<=198);assert.ok(table.w>table.h*2);
   assert.ok(table.x>room.x&&table.x+table.w<room.x+room.w&&table.y>=78&&table.y+table.h<room.y+room.h);
   assert.equal(new Set(seats.map(p=>p.x+':'+p.y)).size,8);assert.equal(new Set(seats.map(p=>p.y)).size,2);
   assert.ok(seats.every((p,i)=>p.y>78&&p.y+8<room.y+room.h&&(i<4?p.y<table.y&&p.dir==='down':p.y>table.y+table.h&&p.dir==='up')));
 }
});
test('meeting walls stay within the floor and leave a clear office-facing doorway',()=>{
 const room=meetingRoom({x:0,y:0,w:240,h:198}),rects=[];
 drawMeetingWalls({fillRect:(x,y,w,h)=>rects.push({x,y,w,h})},room);
 assert.ok(rects.length>10);
 assert.ok(rects.every(r=>r.x>=room.x&&r.y>=0&&r.x+r.w<=room.x+room.w&&r.y+r.h<=198));
 const doorway={x:room.x+room.w-12,y:128,w:12,h:32};
 assert.ok(rects.every(r=>r.x+r.w<=doorway.x||r.x>=doorway.x+doorway.w||r.y+r.h<=doorway.y||r.y>=doorway.y+doorway.h));
 const table=meetingTable(room);
 assert.ok(rects.every(r=>r.x+r.w<=table.x||r.x>=table.x+table.w+3||r.y+r.h<=table.y||r.y>=table.y+table.h+4));
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
 const main=crew.workers.get('main'),helper=crew.workers.get('helper'),seat=main.seat,helperSeat=helper.seat,block=main.seat.block,room=meetingRoom(crew.layout.main);
 crew.setMeeting({id:'m',sourceId:'sandbox',ownerId:'main',title:'Handoff',participants:['main','helper'],updatedAt:ts},meetingSeats(room));crew.update(16);
 assert.equal(main.x,meetingSeats(room)[0].x);assert.equal(main.y,meetingSeats(room)[0].y);assert.equal(main.host.id,'sandbox');assert.equal(main.seat,seat);assert.equal(main.seat.block,block);
 assert.equal(helper.seat,helperSeat);assert.notEqual(helper.x,meetingSeats(room)[1].x);assert.equal(crew.pose(main,now).pose,'sit');
 crew.setMeeting(null,meetingSeats(room));crew.update(16);assert.equal(main.seat,seat);assert.equal(main.x,seat.x);assert.equal(main.y,seat.y);
});

// Exercise the actual bitmap renderer with an instrumented canvas: all plan
// pixels must stay inside both native TV sizes, including long/blocked labels.
test('native TV plan fits its existing frame and announcements retain the screen',()=>{
 const old=globalThis.document,rects=[],images=[];
 const noop=()=>{},atlasContext={fillRect:noop,drawImage:noop};
 globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>atlasContext})};
 const g={save:noop,restore:noop,beginPath:noop,rect:noop,clip:noop,fillRect:(x,y,w,h)=>rects.push({x,y,w,h}),drawImage:(...a)=>{if(a.length===9)images.push({x:a[5],y:a[6],w:a[7],h:a[8]});}};
 const summary={title:'A very long native goal that must fit the screen',current:'A long current task with blockers',completed:12,total:60,blocked:4,state:'active'};
 try{for(const [w,h]of [[100,40],[132,44]]){
   const tv={x:30,y:10,w,h};rects.length=0;images.length=0;
   drawWhiteboard(g,tv,summary,{workers:123,tools:999999});
   assert.ok(images.length>0);assert.ok([...rects,...images].every(r=>r.x>=tv.x&&r.y>=tv.y&&r.x+r.w<=tv.x+tv.w&&r.y+r.h<=tv.y+tv.h));
   const b={workers:2,tools:40,flips:0,byAgent:{omp:2},spark:[],waiting:0,live:true,shouts:[]};
   rects.length=0;images.length=0;tvScreen(g,tv,10000,b,summary);const planPixels=images.length;
   b.shouts=[{agent:'omp',text:'Verified handoff',t0:10000}];rects.length=0;images.length=0;tvScreen(g,tv,10100,b,summary);
   assert.ok(rects.filter(r=>r.x===tv.x&&r.y===tv.y&&r.w===tv.w&&r.h===tv.h).length>=2,'new shout still takes over the TV');assert.ok(images.length>planPixels);
 }}finally{globalThis.document=old;}
});
