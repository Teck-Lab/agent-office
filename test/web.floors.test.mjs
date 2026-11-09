import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'office-floors-')),file=join(dir,'test.mjs');after(()=>rmSync(dir,{recursive:true,force:true}));
await build({stdin:{contents:'export * from "./web/ui/floors-model.ts";export * from "./web/ui/floors.ts";',resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:file,logLevel:'error',loader:{'.svg':'text'}});
const {FloorModel,floorOwner,restoreFloor,createFloorPicker,mountFloors}=await import(pathToFileURL(file));
const ts=new Date().toISOString(),host={kind:'docker-sandbox',id:'box',name:'Sandbox'};
const role=(role='coordinator',runId='run_a')=>({role,runId,...(role==='coordinator'?{}:{taskId:'task',dispatchId:'dispatch'})});
const worker=(workerId,extra={})=>({workerId,agent:'omp',project:'Monorepo',host,status:'idle',lastTs:ts,toolCalls:0,tokens:0,filesTouched:0,orchestration:role(),...extra});
const key=(runId='',source=host,project=runId==='run_b'?'Other':'Monorepo')=>JSON.stringify(['project',project]);
const legacy=(kind='run',source=host)=>JSON.stringify([kind,source.kind,source.id,'Monorepo',kind==='run'?'run_a':'']);
const snapshot=(workers,extra={})=>({version:1,startedAt:ts,demo:false,workers,recent:[],...extra});
const event=(workerId,kind,extra={})=>({workerId,kind,seq:1,agent:'omp',project:workerId==='other'?'Other':'Monorepo',host,ts,...extra});
const ids=m=>m.snapshot().workers.map(w=>w.workerId).sort();
const team=()=>[worker('coordinator'),worker('executor',{orchestration:role('executor')}),worker('helper',{parentId:'executor',orchestration:undefined}),worker('nested',{parentId:'helper',orchestration:role('executor','wrong')}),worker('other',{project:'Other',orchestration:role('coordinator','run_b')})];

test('one project floor combines hosts and Runs while native families stay together',()=>{
 const m=new FloorModel();const otherHost={...host,id:'elsewhere'};
 m.load(snapshot([...team(),worker('foreign',{host:otherHost}),worker('second-run',{orchestration:role('coordinator','run_b')})]));
 m.choose(key());assert.deepEqual(ids(m),['coordinator','executor','foreign','helper','nested','second-run']);
 const f=m.floors().find(f=>f.key===key());assert.equal(f.sessions,4);assert.equal(f.helpers,2);
 assert.deepEqual(m.floors().map(f=>f.kind),['all','project','project']);assert.equal(m.floors()[0].label,'Overview');
 assert.deepEqual(m.snapshot().hosts.map(h=>h.host.id).sort(),['box','elsewhere']);
 m.choose(key('run_b'));assert.deepEqual(ids(m),['other']);
 m.choose('all');assert.equal(ids(m).length,7);assert.equal(m.floors()[0].sessions,5);
});
test('legacy Run and host-specific selections migrate to the same project floor',()=>{
 for(const kind of ['project','run'])for(const source of [host,{...host,id:'another'}])assert.equal(restoreFloor(legacy(kind,source)).key,key());
 assert.equal(restoreFloor(key()).key,key());
});
test('hidden floor updates are retained without forwarding activity or contaminating visible counters',()=>{
 const m=new FloorModel(key('run_a'));m.load(snapshot(team()));
 assert.deepEqual(m.apply(event('other','tool_start',{category:'edit',tokens:42})),{reload:false});
 assert.equal(m.snapshot().workers.reduce((n,w)=>n+w.tokens,0),0);assert.equal(m.snapshot().recent.length,0);
 m.choose(key('run_b'));assert.equal(m.snapshot().workers[0].tokens,42);assert.equal(m.snapshot().workers[0].toolCalls,1);assert.equal(m.snapshot().workers[0].status,'tool_start');
 m.apply(event('other','tool_start',{category:'edit',tokens:42}));assert.equal(m.snapshot().workers[0].tokens,42,'SSE replay is deduplicated');
});
test('ordinary live events and new helpers are incremental, not full scene reloads',()=>{
 const m=new FloorModel(key('run_a'));m.load(snapshot(team()));
 let r=m.apply(event('executor','thinking'));assert.equal(r.reload,false);assert.equal(r.event.workerId,'executor');
 r=m.apply(event('new-helper','subagent_start',{seq:2,parentId:'executor',orchestration:undefined}));assert.equal(r.reload,false);assert.equal(r.event.workerId,'new-helper');assert.ok(ids(m).includes('new-helper'));
});
test('late parent discovery moves helpers into their root project',()=>{
 const m=new FloorModel(key());m.load(snapshot([worker('helper',{project:'Other',parentId:'late-parent'})]));assert.deepEqual(ids(m),[]);
 const r=m.apply(event('late-parent','session_start',{orchestration:role('executor')}));assert.equal(r.reload,true);assert.deepEqual(ids(m),['helper','late-parent']);
});
test('changing or clearing a Run keeps the complete family on the same project floor',()=>{
 const m=new FloorModel(key());m.load(snapshot(team()));const before=ids(m);
 let r=m.apply(event('executor','status',{orchestration:role('executor','run_b')}));assert.equal(r.reload,false);assert.equal(r.event.workerId,'executor');assert.deepEqual(ids(m),before);
 r=m.apply(event('executor','status',{seq:2,orchestration:null}));assert.equal(r.reload,false);assert.deepEqual(ids(m),before);assert.equal(m.floors().length,3);
});
test('worker rename retains its floor and keeps helpers with the renamed parent',()=>{
 const m=new FloorModel(key('run_a'));m.load(snapshot(team()));
 const r=m.apply(event('renamed','session_start',{replaces:'executor'}));assert.equal(r.reload,false);assert.equal(r.event.replaces,'executor');
 assert.deepEqual(ids(m),['coordinator','helper','nested','renamed']);assert.equal(m.snapshot().workers.find(w=>w.workerId==='helper').parentId,'renamed');
});
test('meetings cannot introduce an invisible worker or expose another floor meeting',()=>{
 const m=new FloorModel(key('run_a'));m.load(snapshot(team()));
 const hidden={id:'m',sourceId:'box',ownerId:'other',title:'Private meeting',participants:['other'],updatedAt:ts};
 let r=m.apply(event('other','meeting',{meetings:[hidden]}));assert.deepEqual(r,{reload:false});assert.deepEqual(m.snapshot().meetings,[]);
 const visible={...hidden,id:'own',ownerId:'coordinator',participants:['coordinator','other']};
 r=m.apply(event('coordinator','meeting',{seq:2,meetings:[hidden,visible]}));assert.equal(r.event.meetings.length,1);assert.deepEqual(r.event.meetings[0].participants,['coordinator']);
 r=m.apply(event('other','meeting',{seq:3,meetings:[hidden,{...visible,title:'Changed'}]}));assert.equal(r.reload,true);assert.equal(r.event,undefined);assert.equal(m.snapshot().meetings[0].title,'Changed');
});
test('host health is filtered without losing the selected source warning on an empty floor',()=>{
 const m=new FloorModel(key('run_a'));m.load(snapshot(team()));
 const foreign={...host,id:'foreign'};
 assert.deepEqual(m.apply(event('host:foreign','host_status',{host:foreign,hostStatus:{host:foreign,online:false,status:'offline'}})),{reload:false});
 const r=m.apply(event('host:box','host_status',{seq:2,hostStatus:{host,online:false,status:'offline'}}));assert.equal(r.event.kind,'host_status');
 assert.deepEqual(m.snapshot().hosts.map(h=>[h.host.id,h.online]),[['box',false]]);assert.ok(!ids(m).some(id=>id.startsWith('host:')));
 m.load(snapshot([],{hosts:[{host,online:false,status:'offline'}]}));assert.deepEqual(m.snapshot().hosts.map(h=>[h.host.id,h.online]),[['box',false]]);
});
test('reconnect restores a remembered floor without replaying recent hidden events',()=>{
 const m=new FloorModel(key('run_a'));m.load(snapshot(team(),{recent:[event('other','shout',{summary:'Hidden'}),event('executor','thinking',{seq:2})]}));
 assert.equal(m.selected.key,key('run_a'));assert.deepEqual(m.snapshot().recent.map(e=>e.workerId),['executor']);assert.equal(m.apply(event('executor','thinking',{seq:2})).event,undefined);
 m.load(snapshot([],{}));assert.equal(m.selected.key,key('run_a'));assert.equal(m.floors().length,2);
 assert.equal(restoreFloor('invalid').key,'all');assert.equal(restoreFloor('{"__proto__":{}}').key,'all');
});
test('cycles in parent metadata terminate and use a consistent owner for descendants',()=>{
 const a=worker('a',{parentId:'b'}),b=worker('b',{parentId:'a'}),c=worker('c',{parentId:'b'}),workers=new Map([a,b,c].map(w=>[w.workerId,w]));
 assert.equal(floorOwner(a,workers).workerId,'a');assert.equal(floorOwner(b,workers).workerId,'a');assert.equal(floorOwner(c,workers).workerId,'a');
});

class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.attrs={};this.listeners={};}
 append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}addEventListener(k,f){this.listeners[k]=f;}fire(k){this.listeners[k]?.({});}
}
test('floor selector uses safe text, accessible controls and no network requests',()=>{
 const old={document:globalThis.document,fetch:globalThis.fetch};globalThis.document={createElement:t=>new Element(t)};globalThis.fetch=()=>{throw Error('No control/network calls permitted');};
 try{let chosen;const picker=createFloorPicker(key=>chosen=key),m=new FloorModel();m.load(snapshot([worker('x',{project:'<img src=x onerror=alert(1)>'})]));
 const list=m.floors();picker.update(list,'all');const [previous,select,next]=picker.el.children[1].children;
 assert.equal(select.attrs['aria-label'],'Office floor');assert.equal(previous.disabled,true);assert.ok(select.children.some(o=>o.textContent.includes('<img')));assert.ok(select.children.every(o=>o.innerHTML===undefined));
 next.fire('click');assert.equal(chosen,list[1].key);picker.update(list,chosen);select.value='invalid';select.fire('change');assert.equal(chosen,list[1].key);
 }finally{Object.assign(globalThis,old);}
});
test('floor UI persists selection, keeps inactive agents current and cannot fake a live connection',()=>{
 const old={document:globalThis.document,localStorage:globalThis.localStorage,fetch:globalThis.fetch};let saved=legacy();
 globalThis.document={createElement:t=>new Element(t)};globalThis.localStorage={getItem:()=>saved,setItem:(_,v)=>saved=v};globalThis.fetch=()=>{throw Error('Floors are view only');};
 try{const calls=[],root=new Element('div'),scene={setFloor:(code,reset)=>calls.push(['floor',code,reset])};
 const chrome={load:s=>calls.push(['load',structuredClone(s)]),apply:e=>calls.push(['event',e]),connection:s=>calls.push(['connection',s]),control(){},prime(){},clearSelection:()=>calls.push(['clear']),setFloorContext(){}};
 const ui=mountFloors(root,scene,chrome);assert.equal(saved,key());ui.connection('live');ui.load(snapshot(team()));assert.deepEqual(calls.findLast(c=>c[0]==='load')[1].workers.map(w=>w.workerId).sort(),['coordinator','executor','helper','nested']);
 ui.apply(event('other','tool_start',{category:'edit',tokens:19}));assert.equal(calls.filter(c=>c[0]==='event').length,0);
 const select=root.children[0].children[1].children[1];ui.connection('retrying');select.value=key('run_b');select.fire('change');
 assert.equal(saved,key('run_b'));assert.equal(calls.at(-1)[0],'connection');assert.equal(calls.at(-1)[1],'retrying');assert.equal(calls.findLast(c=>c[0]==='load')[1].workers[0].tokens,19);assert.ok(calls.some(c=>c[0]==='clear'));
 ui.connection('live');ui.load(snapshot(team()));assert.equal(calls.findLast(c=>c[0]==='load')[1].workers[0].workerId,'other');
 }finally{Object.assign(globalThis,old);}
});
