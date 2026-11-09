import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'office-view-')),file=join(dir,'test.mjs');after(()=>rmSync(dir,{recursive:true,force:true}));
await build({stdin:{contents:'export * from "./web/scene/presentation.ts";export * from "./web/scene/sky.ts";export * from "./web/scene/workers.ts";export * from "./web/scene/meeting-room.ts";export * from "./web/ui/appearance.ts";',resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:file,logLevel:'error',loader:{'.svg':'text'}});
const {Crew,DEFAULT_VIEW,cleanView,viewHour,skyAt,visualState,meetingRoom,meetingSeats,meetingTable,createAppearance}=await import(pathToFileURL(file));
const host={kind:'docker-sandbox',id:'sandbox',name:'Sandbox'},ts=new Date().toISOString();
const coord=(role,runId='run_1')=>({role,runId,...(role==='coordinator'?{}:{taskId:'task_1',dispatchId:'ctx_1'})});
const worker=(id,extra={})=>({workerId:id,agent:'omp',project:'Repo',host,placement:'cloud',status:'idle',lastTs:ts,toolCalls:0,tokens:0,filesTouched:0,...extra});
const plan=(status='active',taskStatus='in_progress')=>({goal:{id:'goal1',objective:'Implement feature',status},phases:[{name:'Implement',tasks:[{content:'Add endpoint',status:taskStatus}]}]});
const load=(workers)=>{let now=10000;const crew=new Crew(()=>now);crew.load({version:1,startedAt:ts,demo:false,workers,recent:[]});crew.update(16);return {crew,tick:(count=1)=>{for(let i=0;i<count;i++){now+=16;crew.update(16);}},now:()=>now};};
test('activity uses reported execution first, and idle plan states never imply success',()=>{
 const w={id:'main',act:'idle',project:'Repo',host,summary:'',needsHuman:false,leaving:false,orchestration:coord('coordinator'),plan:plan('active','blocked')};
 assert.equal(visualState(w,[]).kind,'blocked');
 assert.equal(visualState({...w,act:'edit'},[]).kind,'coding');
 assert.equal(visualState({...w,needsHuman:true},[]).kind,'waiting-human');
 assert.equal(visualState({...w,plan:plan('paused')},[]).kind,'paused');
 assert.equal(visualState({...w,plan:plan('complete','completed')},[]).kind,'finished');
 const idle={...w,plan:null},child={...w,id:'executor',act:'edit',orchestration:coord('executor')};
 assert.equal(visualState(idle,[child]).label,'Team present');
 assert.equal(visualState(idle,[{...child,host:{...host,id:'different'}}]).kind,'idle');
 assert.equal(visualState(idle,[{...child,project:'Other'}]).kind,'idle');
 assert.equal(visualState(idle,[{...child,leaving:true}]).kind,'idle');
});
test('separate Runs get separate cloud pods; helpers keep their actual parent and host',()=>{
 const {crew}=load([worker('a',{orchestration:coord('executor','run_a')}),worker('b',{orchestration:coord('executor','run_b')}),worker('helper',{parentId:'a'})]);
 assert.notEqual(crew.workers.get('a').seat.block,crew.workers.get('b').seat.block);
 assert.equal(crew.workers.get('a').seat.block,crew.workers.get('helper').seat.block);
 assert.equal(crew.workers.get('helper').host.id,'sandbox');
 assert.equal(crew.sameTeam('a','b'),false);assert.equal(crew.sameTeam('a','helper'),true);
 crew.apply({kind:'status',workerId:'a',agent:'omp',project:'Repo',ts,orchestration:coord('executor','run_b')});
 assert.equal(crew.workers.get('a').seat.block,crew.workers.get('b').seat.block);
 assert.equal(crew.workers.get('a').seat.block,crew.workers.get('helper').seat.block);
});
test('native goal completion celebrates once; snapshots and metadata preserve real activity',()=>{
 const {crew,tick}=load([worker('main',{plan:plan(),status:'thinking'})]);const w=crew.workers.get('main');
 const done={kind:'plan',workerId:'main',agent:'omp',project:'Repo',ts,plan:plan('complete','completed')};
 crew.apply(done);assert.equal(w.show.kind,'cheer');assert.equal(w.act,'thinking');
 tick(200);assert.equal(w.show,null);crew.apply(done);assert.equal(w.show,null);
 crew.load({version:1,startedAt:ts,demo:false,workers:[worker('main',{plan:done.plan})],recent:[]});crew.apply(done);assert.equal(crew.workers.get('main').show,null);
});
test('meeting traversal reaches a seat, handles activity in transit, and returns without moving helpers',()=>{
 const {crew,tick}=load([worker('main'),worker('helper',{parentId:'main'})]);const w=crew.workers.get('main'),helper=crew.workers.get('helper'),desk=w.seat,helperDesk=helper.seat,room=meetingRoom(crew.layout.main),seats=meetingSeats(room);
 crew.setMeeting({participants:['main','helper']},seats);assert.equal(w.walking,true);assert.notEqual(w.x,seats[0].x);
 crew.apply({kind:'tool_start',workerId:'main',agent:'omp',project:'Repo',ts,category:'read',summary:'Read contract'});
 tick(1500);assert.equal(w.walking,false);assert.equal(w.x,seats[0].x);assert.equal(w.y,seats[0].y);assert.equal(w.act,'read');assert.equal(w.host.id,'sandbox');assert.equal(w.seat,desk);assert.equal(helper.seat,helperDesk);
 crew.setMeeting(null,seats);assert.equal(w.walking,true);tick(1500);assert.equal(w.x,desk.x);assert.equal(w.y,desk.y);assert.equal(w.seated,true);
});
test('reduced motion and switching meeting layout settle positions without losing session identity',()=>{
 const {crew,tick}=load([worker('main')]);const w=crew.workers.get('main'),room=meetingRoom(crew.layout.main);
 crew.setMeeting({participants:['main']},meetingSeats(room));tick(10);crew.setAppearance({...DEFAULT_VIEW,motion:false});tick();
 assert.equal(w.walking,false);assert.equal(w.x,meetingSeats(room)[0].x);
 crew.setMeeting({participants:['main']},meetingSeats(room,'vertical'));tick();assert.equal(w.x,meetingSeats(room,'vertical')[0].x);
 crew.setMeeting(null,[]);tick();assert.equal(w.x,w.seat.x);assert.equal(w.host.id,'sandbox');
 for(const layout of ['horizontal','vertical']){const table=meetingTable(room,layout);assert.ok(table.x>room.x&&table.x+table.w<room.x+room.w-12&&table.y+table.h+4<=192);}
});
test('local clock drives sunrise/night while invalid stored settings fall back safely',()=>{
 assert.equal(viewHour(DEFAULT_VIEW,new Date(2026,0,1,6,30,0)),6.5);
 assert.equal(viewHour({...DEFAULT_VIEW,time:'day'},new Date(2026,0,1,23)),12);
 assert.ok(skyAt(23).stars>skyAt(12).stars);assert.ok(skyAt(23).dark>skyAt(12).dark);assert.notEqual(skyAt(6.5).top,skyAt(18).top);
 const safe=cleanView({time:'script',motion:'false',links:false,characters:'caps',unknown:'x'});assert.equal(safe.time,'local');assert.equal(safe.motion,true);assert.equal(safe.links,false);assert.equal(safe.characters,'caps');assert.equal(safe.unknown,undefined);
});
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.attrs={};this.open=false;}
 append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}addEventListener(k,f){this.listeners[k]=f;}showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}focus(){}fire(k){this.listeners[k]?.({});}
}
test('appearance settings work without network, persist in this browser, and reset independently of agent state',()=>{
 const old={document:globalThis.document,localStorage:globalThis.localStorage,matchMedia:globalThis.matchMedia,fetch:globalThis.fetch};let saved=null,latest;
 globalThis.document={createElement:t=>new Element(t)};globalThis.localStorage={getItem:()=>saved,setItem:(_,v)=>saved=v};globalThis.matchMedia=()=>({matches:false});globalThis.fetch=()=>{throw Error('Appearance must not contact control APIs');};
 try{const ui=createAppearance(p=>latest=p);ui.tab.fire('click');assert.equal(ui.el.open,true);
 const form=ui.el.children[2],theme=form.children[2].children[1];theme.value='forest';theme.fire('change');assert.equal(latest.theme,'forest');assert.equal(JSON.parse(saved).theme,'forest');
 const other=createAppearance(p=>latest=p);assert.equal(latest.theme,'forest');other.tab.fire('click');const buttons=other.el.children.at(-1);buttons.children[0].fire('click');assert.equal(latest.theme,'original');buttons.children[1].fire('click');assert.equal(other.el.open,false);
 }finally{Object.assign(globalThis,old);}
});

test('reconnected meeting participants with unplaced desks do not stall on a non-finite route',()=>{
 let now=10000;const crew=new Crew(()=>now);crew.load({version:1,startedAt:ts,demo:false,workers:[worker('main')],recent:[]});
 const room=meetingRoom(crew.layout.main),seats=meetingSeats(room);crew.setMeeting({participants:['main']},seats);
 for(let i=0;i<1800;i++){now+=16;crew.update(16);}
 const w=crew.workers.get('main');assert.equal(w.walking,false);assert.equal(w.x,seats[0].x);assert.equal(w.y,seats[0].y);
});
test('leaving a meeting mid-walk returns to the desk and completed goals celebrate after arrival',()=>{
 const {crew,tick}=load([worker('main',{plan:plan()})]),w=crew.workers.get('main'),room=meetingRoom(crew.layout.main),seats=meetingSeats(room);
 crew.setMeeting({participants:['main']},seats);tick(20);crew.setMeeting(null,seats);tick(1500);assert.equal(w.walking,false);assert.equal(w.x,w.seat.x);
 crew.setMeeting({participants:['main']},seats);crew.apply({kind:'plan',workerId:'main',agent:'omp',project:'Repo',ts,plan:plan('complete','completed')});
 for(let i=0;i<1500&&w.walking;i++)tick();tick();assert.equal(w.show?.kind,'cheer');
});
