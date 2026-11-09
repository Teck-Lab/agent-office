import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'office-view-')),file=join(dir,'test.mjs');after(()=>rmSync(dir,{recursive:true,force:true}));
await build({stdin:{contents:'export * from "./web/scene/office-details.ts";export * from "./web/ui/state.ts";export * from "./web/scene/presentation.ts";export * from "./web/scene/sky.ts";export * from "./web/scene/workers.ts";export * from "./web/scene/meeting-room.ts";export * from "./web/ui/appearance.ts";',resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:file,logLevel:'error',loader:{'.svg':'text'}});
const {Sky,drawPersonalDesk,Handoffs,seasonAt,drawSeason,deskIdentity,OfficeModel,Crew,DEFAULT_VIEW,cleanView,viewHour,skyAt,visualState,meetingRoom,meetingSeats,meetingTable,createAppearance}=await import(pathToFileURL(file));
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
 const form=ui.el.children[2],theme=form.children.map(row=>row.children[1]).find(input=>input.attrs['aria-label']==='Room colours');theme.value='forest';theme.fire('change');assert.equal(latest.theme,'forest');assert.equal(JSON.parse(saved).theme,'forest');
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


test('calendar seasons cover both hemispheres and manual choices ignore date',()=>{
 const northern=['winter','winter','spring','spring','spring','summer','summer','summer','autumn','autumn','autumn','winter'];
 northern.forEach((s,month)=>assert.equal(seasonAt('north',new Date(2026,month,15)),s));
 assert.equal(seasonAt('south',new Date(2026,0,1)),'summer');assert.equal(seasonAt('south',new Date(2026,6,1)),'winter');
 assert.equal(seasonAt('spring',new Date(2026,11,31)),'spring');
 assert.equal(cleanView({season:'bad'}).season,'north');assert.equal(cleanView({season:'south'}).season,'south');
});
test('seasonal scenery retains distinct still details and restores canvas state',()=>{
 const samples=new Set();
 for(const season of ['spring','summer','autumn','winter']){
  const ops=[],g={save(){ops.push('save')},restore(){ops.push('restore')},fillRect(...rect){assert.ok(rect.every(Number.isFinite));ops.push([this.fillStyle,...rect])}};
  drawSeason(g,{x:0,w:300},12,60,season,0,.5);assert.equal(ops[0],'save');assert.equal(ops.at(-1),'restore');samples.add(JSON.stringify(ops));
  const n=ops.length;drawSeason(g,{x:0,w:300},12,60,season,1000,.5);assert.equal(ops.length>n*2,season!=='summer','only non-summer motion adds falling particles');
 }
 assert.equal(samples.size,4);
});
test('personal desk identity survives reconnect and rehoming without exposing file paths',()=>{
 const {crew}=load([worker('main',{orchestration:coord('coordinator')})]),w=crew.workers.get('main'),before=deskIdentity(w);
 crew.apply({kind:'status',workerId:'main',agent:'omp',project:'Repo',ts,placement:'office',cwd:'/private/path',orchestration:coord('coordinator')});
 assert.deepEqual(deskIdentity(w),before);
 const again=load([worker('main',{orchestration:coord('coordinator')})]);assert.deepEqual(deskIdentity(again.crew.workers.get('main')),before);
 assert.notEqual(deskIdentity({...w,id:'other-session'}).seed,before.seed);assert.ok(!JSON.stringify(before).includes('/private'));
});
test('handoffs are event driven, exact scoped, replay safe, and never change native state',()=>{
 const {crew}=load([worker('owner',{placement:'office',orchestration:coord('coordinator')}),worker('other-owner',{orchestration:coord('coordinator','run_other')})]);
 const assignment={seq:1,ts,kind:'session_start',workerId:'exec',agent:'omp',project:'Repo',host,orchestration:coord('executor')};
 crew.apply(assignment);assert.deepEqual(crew.handoffs.pending.map(h=>[h.from,h.to,h.kind]),[['owner','exec','assignment']]);
 crew.apply(assignment);assert.equal(crew.handoffs.pending.length,1);
 crew.apply({...assignment,seq:2,kind:'subagent_start',workerId:'helper',parentId:'exec'});
 assert.equal(crew.handoffs.pending.at(-1).kind,'helper-start');assert.equal(crew.handoffs.pending.at(-1).from,'exec');
 crew.apply({...assignment,seq:3,kind:'subagent_end',workerId:'helper',parentId:'exec'});assert.equal(crew.handoffs.pending.at(-1).kind,'helper-end');
 crew.apply({...assignment,seq:4,kind:'plan',plan:plan()});crew.apply({...assignment,seq:5,kind:'plan',plan:plan('complete','completed')});
 assert.equal(crew.handoffs.pending.at(-1).kind,'goal-complete');assert.equal(crew.handoffs.pending.at(-1).to,'owner');
 const count=crew.handoffs.pending.length;crew.apply({...assignment,seq:6,kind:'reply'});assert.equal(crew.handoffs.pending.length,count,'a human-directed reply is not a parent report');
 const snap={version:1,startedAt:ts,demo:false,recent:[{...assignment,seq:6}],workers:[worker('owner',{orchestration:coord('coordinator')}),worker('exec',{orchestration:coord('executor'),plan:plan('complete','completed')})]};
 crew.load(snap);crew.apply({...assignment,seq:7,kind:'plan',plan:plan('complete','completed')});assert.equal(crew.handoffs.pending.length,0,'snapshot does not replay dispatch or completion');
});
test('ambiguous coordinators and cross-sandbox helpers never get guessed handoffs',()=>{
 const {crew}=load([worker('one',{orchestration:coord('coordinator')}),worker('two',{orchestration:coord('coordinator')})]);
 crew.apply({seq:1,kind:'session_start',workerId:'exec',agent:'omp',project:'Repo',host,ts,orchestration:coord('executor')});assert.equal(crew.handoffs.pending.length,0);
 crew.apply({seq:2,kind:'subagent_start',workerId:'foreign',parentId:'one',agent:'omp',project:'Repo',host:{...host,id:'elsewhere'},ts});assert.equal(crew.handoffs.pending.length,0);
});
test('handoff buffers are bounded, expire, and obey motion preferences',()=>{
 const {crew}=load([worker('owner',{orchestration:coord('coordinator')})]);
 for(let i=1;i<=40;i++)crew.apply({seq:i,ts,kind:'subagent_start',workerId:'h'+i,parentId:'owner',agent:'omp',project:'Repo',host});
 assert.equal(crew.handoffs.pending.length,24);
 crew.handoffs.draw({},crew.workers,20000,true,()=>false);assert.equal(crew.handoffs.pending.length,0);
 crew.setAppearance({...DEFAULT_VIEW,motion:false});crew.apply({seq:41,ts,kind:'subagent_start',workerId:'still',parentId:'owner',agent:'omp',project:'Repo',host});assert.equal(crew.handoffs.pending.length,0);
});
test('browser loss freezes stale work; live notification alone waits for a fresh snapshot',()=>{
 const {crew,tick,now}=load([worker('main',{status:'tool_start',category:'edit',plan:plan()})]),w=crew.workers.get('main');
 const before={x:w.x,y:w.y,act:w.act,plan:w.plan};crew.setConnection('retrying');tick(20);
 assert.equal(crew.activityState(w).kind,'disconnected');assert.equal(crew.screenOf(w,now()),'off');assert.ok(['sit','stand'].includes(crew.pose(w,now()).pose));
 assert.deepEqual({x:w.x,y:w.y,act:w.act,plan:w.plan},before);crew.setConnection('live');assert.equal(crew.liveFeed,false);
 crew.load({version:1,startedAt:ts,demo:false,workers:[worker('main')],recent:[]});assert.equal(crew.liveFeed,true);
});
test('host notices never create agents or inflate counters and expiry preserves offline warning',()=>{
 const s={version:1,startedAt:ts,demo:false,workers:[worker('main',{status:'thinking'})],recent:[]},model=new OfficeModel(),crew=new Crew(()=>10000);model.load(s);crew.load(s);
 const event={seq:1,kind:'host_status',workerId:'host:sandbox',agent:'omp',project:'Repo',host,ts,hostStatus:{host,online:false,status:'offline'}};
 model.apply(event);crew.apply(event);assert.equal(model.workers.size,1);assert.equal(crew.workers.size,1);assert.equal(model.toolCalls,0);assert.equal(crew.activityState(crew.workers.get('main')).label,'Observer disconnected');
 const end={seq:2,kind:'session_end',workerId:'main',agent:'omp',project:'Repo',host,ts};model.apply(end);crew.apply(end);assert.ok(model.offline.has(host.id));assert.ok(crew.offline.has(host.id));
 const restored={...s,hosts:[event.hostStatus]};model.load(restored);crew.load(restored);assert.ok(model.offline.has(host.id));assert.ok(crew.offline.has(host.id));
 const online={...event,seq:3,hostStatus:{host,online:true,status:'online'}};model.apply(online);crew.apply(online);assert.equal(model.offline.size,0);assert.equal(crew.offline.size,0);
});


test('desk details fit the desk width and stay clear of the keyboard',()=>{
 const previous=globalThis.document,rects=[],noop=()=>{};
 globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>({fillRect:noop,drawImage:noop})})};
 const g={fillRect:(x,y,w,h)=>rects.push({x,y,w,h}),drawImage:(c,x,y)=>rects.push({x,y,w:c.width,h:c.height})};
 try{drawPersonalDesk(g,{id:'main',orchestration:coord('coordinator')},100,100);
 assert.ok(rects.every(r=>r.x>=100&&r.x+r.w<=136));assert.ok(rects.every(r=>r.y+r.h<=105||r.y>=111),'accessories do not cover the keyboard');
 }finally{globalThis.document=previous;}
});
test('seasonal scenery is painted under the actual window clip, not across the office',()=>{
 const previous=globalThis.document,noop=()=>{},atlas={fillRect:noop,drawImage:noop};
 globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>atlas})};
 let clipped=false,seasonPixels=0;const states=[],windows=[];
 const g={save(){states.push(clipped)},restore(){clipped=states.pop()},beginPath:noop,rect(...r){windows.push(r)},clip(){clipped=true},arc:noop,fill:noop,drawImage:noop,
 fillRect(){if(this.fillStyle==='#edb9ca'){seasonPixels++;assert.equal(clipped,true);}}};
 try{new Sky(7).draw(g,[{x:12,y:12,w:45,h:60},{x:80,y:12,w:45,h:60}],{x:0,w:150},12,60,skyAt(12),0,0,false,'spring');
 assert.ok(seasonPixels>0);assert.deepEqual(windows,[[12,12,45,60],[80,12,45,60]]);assert.equal(clipped,false);
 }finally{globalThis.document=previous;}
});
