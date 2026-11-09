import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'office-whiteboard-test-')),file=join(dir,'mod.mjs');
after(()=>rmSync(dir,{recursive:true,force:true}));
await build({stdin:{contents:'export * from "./web/ui/whiteboard-model.ts";export * from "./web/ui/whiteboard.ts";export * from "./web/ui/state.ts";export * from "./web/scene/whiteboard.ts";export {plan as roomPlan} from "./web/scene/room.ts";export {FLOOR_TOP,WALL_H} from "./web/scene/layout.ts";',resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:file,logLevel:'error',loader:{'.svg':'text'}});
const {boardViews,createWhiteboard,OfficeModel,whiteboardRect,roomPlan,WALL_H,FLOOR_TOP}=await import(pathToFileURL(file).href);
const goal=(objective,status='active')=>({id:'goal-'+objective,objective,status});
const plan={goal:goal('Delivery'),phases:[{name:'Acceptance',tasks:[{content:'Tests',status:'completed'},{content:'Review',status:'in_progress'},{content:'Restore',status:'blocked',blocker:'Needs backup'}]}]};
const worker=(workerId,runId,role='coordinator',extra={})=>({workerId,agent:'omp',project:'Teck.Monorepo',status:'waiting',toolCalls:0,tokens:0,filesTouched:0,lastTs:new Date().toISOString(),host:{kind:'docker-sandbox',id:'host-a',name:'sandbox'},orchestration:{role,runId,...(role!=='coordinator'?{taskId:'task-'+workerId,dispatchId:'dispatch-'+workerId}:{})},...extra});
test('boards isolate two coordinators by exact Run and host, excluding native helpers',()=>{
  const a=worker('a','run-a','coordinator',{plan}),b=worker('b','run-b');
  const views=boardViews([b,a,worker('ea','run-a','executor'),worker('eb','run-b','executor'),worker('other-host','run-a','executor',{host:{id:'host-b'}}),worker('helper','run-a','coordinator',{parentId:'a'})]);
  assert.equal(views.length,2);assert.equal(views[0].owner.workerId,'a');assert.deepEqual(views[0].workers.map(w=>w.workerId),['ea']);assert.deepEqual(views[1].workers.map(w=>w.workerId),['eb']);
  assert.equal(views[0].completed,1);assert.equal(views[0].total,3);assert.equal(views[0].blocked,1);assert.equal(views[0].current,'Review');
  assert.equal(boardViews([worker('unbound',undefined,'coordinator'),worker('worker',undefined,'executor')])[0].workers.length,0);
});
test('live plan updates and reconnect preserve plans without claiming a turn or task completed',()=>{
  const m=new OfficeModel(),a=worker('a','run-a','coordinator',{plan,status:'tool_start',tool:'orca',summary:'Checking worker'});
  m.load({version:1,startedAt:new Date().toISOString(),demo:false,workers:[a],recent:[]});
  const updated={...plan,goal:goal('Delivery','paused')};
  m.apply({seq:1,ts:new Date().toISOString(),kind:'plan',workerId:'a',agent:'omp',project:a.project,plan:updated});
  assert.deepEqual(m.get('a').plan,updated);assert.equal(m.get('a').status,'tool_start');assert.equal(m.get('a').tool,'orca');assert.equal(m.get('a').toolCalls,0);assert.equal(m.get('a').lastTs,a.lastTs);
  assert.equal(boardViews(m.workers.values())[0].completed,1,'paused goal does not complete native tasks');
});
test('the board has its own bay left of the elevator, aligned with the TV, without moving pods',()=>{
  for(const w of [240,330,500,1000]){
    const main={x:0,y:0,w,h:400},r=whiteboardRect(main),p=roomPlan(main,null,main);
    assert.ok(r.x>=p.main.x&&r.x+r.w<p.elevator.x);assert.equal(r.y,p.tv.y);assert.ok(r.y+r.h<WALL_H);assert.ok(r.y+r.h<FLOOR_TOP);
    assert.equal(p.elevator.x,main.x+12);assert.equal(p.main.x+p.main.w,main.x+main.w);assert.equal(p.room.x,p.main.x);
  }
});
// Exercise the real modal with a small DOM stand-in; no browser or computer control.
class Node {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.dataset={};this.handlers={};this.open=false;this.hidden=false;this.textContent='';}
  append(...v){this.children.push(...v);} replaceChildren(...v){this.children=[...v];}
  setAttribute(k,v){this.attrs[k]=String(v);}removeAttribute(k){delete this.attrs[k];}
  addEventListener(k,f){(this.handlers[k]??=[]).push(f);}focus(){document.activeElement=this;}
  showModal(){this.open=true;}close(){this.open=false;for(const f of this.handlers.close??[])f({});}
}
function text(n){return typeof n==='object'?n.textContent+' '+n.children.map(text).join(' '):String(n);}
test('whiteboard opens, switches coordinators, renders safe text and retains selection through live updates',()=>{
  globalThis.HTMLElement=Node;globalThis.document={createElement:tag=>new Node(tag),activeElement:null};
  let chosen;const ui=createWhiteboard({onChoose:id=>chosen=id});
  const a=worker('a','run-a','coordinator',{plan}),b=worker('b','run-b','coordinator',{plan:{goal:goal('Second'),phases:[]}});
  ui.update([a,b]);ui.show();assert.equal(ui.isOpen(),true);assert.match(text(ui.el),/Delivery/);assert.match(text(ui.el),/Needs backup/);
  const select=ui.el.children.find(n=>n.tagName==='SELECT');select.value='b';select.handlers.change[0]();assert.equal(chosen,'b');assert.match(text(ui.el),/Second/);
  assert.equal(ui.update([a,b]).owner.workerId,'b');
  ui.update([a]);assert.equal(select.value,'a');assert.match(text(ui.el),/Delivery/);
  ui.update([]);assert.match(text(ui.el),/No connected orchestrator/);ui.hide();assert.equal(ui.isOpen(),false);
  const malicious=worker('unsafe','run-x','coordinator',{plan:{goal:goal('<img src=x onerror=alert(1)>'),phases:[]}});
  ui.update([malicious]);ui.show();assert.match(text(ui.el),/<img src=x onerror=alert\(1\)>/,'displayed as a text node, never markup');
});
