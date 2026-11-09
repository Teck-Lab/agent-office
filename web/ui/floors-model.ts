import type {Host,OfficeEvent,Snapshot,WorkerState} from '../../src/shared/events.ts';
import {OfficeModel} from './state.ts';

export interface Floor {
  key:string;kind:'all'|'project';project:string;label:string;group:string;sessions:number;helpers:number;
}
export const ALL_FLOORS:Floor={key:'all',kind:'all',project:'',label:'Overview',group:'All projects',sessions:0,helpers:0};
const projectKey=(w:Pick<WorkerState,'project'>)=>JSON.stringify(['project',w.project]);

export function restoreFloor(key:unknown):Floor {
  if(key==='all')return {...ALL_FLOORS};
  try{
    if(typeof key!=='string'||key.length>1200)throw Error();
    const a:unknown=JSON.parse(key);
    if(!Array.isArray(a)||a.some(v=>typeof v!=='string'||v.length>256))throw Error();
    // Collapse previously saved host/project and Run selections into their project.
    let project:string;
    if(a.length===2&&a[0]==='project')project=a[1];
    else if(a.length===5&&['project','run'].includes(a[0])&&(a[0]!=='run'||a[4]))project=a[3];
    else throw Error();
    return {key:projectKey({project}),kind:'project',project,label:project||'Untitled project',group:project||'Untitled project',sessions:0,helpers:0};
  }catch{return {...ALL_FLOORS};}
}

/** Native descendants follow the root session, including late parent adoption. */
export function floorOwner(w:WorkerState,workers:ReadonlyMap<string,WorkerState>):WorkerState{
  const seen=new Map<string,number>(),chain:WorkerState[]=[];let owner=w;
  while(owner.parentId){
    if(seen.has(owner.workerId))return chain.slice(seen.get(owner.workerId)!).sort((a,b)=>a.workerId.localeCompare(b.workerId))[0]??w;
    seen.set(owner.workerId,chain.length);chain.push(owner);const parent=workers.get(owner.parentId);if(!parent)break;owner=parent;
  }
  return owner;
}
function scope(w:Pick<WorkerState,'project'|'host'|'orchestration'>){return {project:projectKey(w)};}
type Scope=ReturnType<typeof scope>;
const belongs=(floor:Floor,s:Scope)=>floor.kind==='all'||floor.key===s.project;

export class FloorModel {
  readonly model=new OfficeModel();
  selected:Floor;
  private base:Snapshot={version:1,startedAt:'',demo:false,workers:[],recent:[]};
  private history:{event:OfficeEvent;scope:Scope}[]=[];
  private highestSeq=0;
  private projectHosts=new Map<string,Set<string>>();
  private rememberHost(project:string,host?:Host){
    if(!host)return;
    let hosts=this.projectHosts.get(project);if(!hosts)this.projectHosts.set(project,hosts=new Set());
    hosts.add(JSON.stringify([host.kind,host.id]));
  }
  constructor(key:unknown='all'){this.selected=restoreFloor(key);}
  private owner(w:WorkerState){return floorOwner(w,this.model.workers);}
  ids():Set<string>{return new Set([...this.model.workers.values()].filter(w=>belongs(this.selected,scope(this.owner(w)))).map(w=>w.workerId));}
  floors():Floor[]{
    const floors=new Map<string,Floor>(),all={...ALL_FLOORS};
    const workers=[...this.model.workers.values()];
    for(const w of workers){
      const root=this.owner(w),key=projectKey(root);
      if(!floors.has(key))floors.set(key,restoreFloor(key));
      const f=floors.get(key)!;
      if(w.parentId){f.helpers++;all.helpers++;}else{f.sessions++;all.sessions++;}
      this.rememberHost(key,w.host);
    }
    const live=floors.get(this.selected.key);if(live)this.selected={...live};
    else if(this.selected.kind!=='all')floors.set(this.selected.key,{...this.selected,sessions:0,helpers:0});
    const rest=[...floors.values()].sort((a,b)=>a.label.localeCompare(b.label)||a.key.localeCompare(b.key));
    return [all,...rest];
  }
  choose(key:unknown){this.selected=restoreFloor(key);this.floors();}
  load(s:Snapshot){
    this.base=s;this.model.load(s);this.highestSeq=Math.max(0,...s.recent.map(e=>e.seq||0));
    this.history=s.recent.slice(-200).map(event=>({event,scope:this.eventScope(event)}));
    for(const h of this.history)if(h.event.kind!=='host_status')this.rememberHost(h.scope.project,h.event.host);
    this.floors();
  }
  private eventScope(e:OfficeEvent):Scope {
    const w=this.model.workers.get(e.workerId)??(e.parentId?this.model.workers.get(e.parentId):undefined);
    return scope(w?this.owner(w):e);
  }
  private hostAllowed(host?:Host){return !!host&&(this.selected.kind==='all'||this.projectHosts.get(this.selected.key)?.has(JSON.stringify([host.kind,host.id])));}
  private meetings(ids:Set<string>){return (this.base.meetings??[]).filter(m=>ids.has(m.ownerId)).map(m=>({...m,participants:m.participants.filter(id=>ids.has(id))}));}
  snapshot():Snapshot{
    const ids=this.ids();
    const workers=[...this.model.workers.values()].filter(w=>ids.has(w.workerId)).map(({history,edits,baseFiles,...w})=>w);
    const hosts=[...this.model.hostsSeen.values()].filter(h=>this.hostAllowed(h)).map(host=>({host,online:!this.model.offline.has(host.id),status:this.model.offline.has(host.id)?'offline' as const:'online' as const}));
    const recent=this.history.filter(h=>h.event.kind==='host_status'?this.hostAllowed(h.event.host):belongs(this.selected,this.model.workers.has(h.event.workerId)?this.eventScope(h.event):h.scope)).map(h=>({...h.event,...(h.event.meetings?{meetings:this.meetings(ids)}:{})}));
    return {...this.base,workers,hosts,recent,meetings:this.meetings(ids)};
  }
  /** Hidden floors stay current. A reload is only needed for ownership changes involving existing actors. */
  apply(e:OfficeEvent):{reload:boolean;event?:OfficeEvent}{
    if(e.seq&&e.seq<=this.highestSeq)return {reload:false};if(e.seq)this.highestSeq=e.seq;
    const before=this.ids(),known=new Set(this.model.workers.keys()),eventScope=this.eventScope(e);
    const oldMeetings=JSON.stringify(this.meetings(before));
    this.model.apply(e);if(e.meetings)this.base={...this.base,meetings:e.meetings};
    const after=this.ids();this.history.push({event:e,scope:this.model.workers.has(e.workerId)?this.eventScope(e):eventScope});if(this.history.length>200)this.history.shift();this.floors();
    const movedOut=[...before].some(id=>this.model.workers.has(id)&&!after.has(id));
    const movedIn=[...after].some(id=>!before.has(id)&&(known.has(id)||id!==e.workerId));
    if(movedOut||movedIn)return {reload:true};
    const visible=before.has(e.workerId)||after.has(e.workerId)||(!!e.replaces&&before.has(e.replaces))||
      ((e.kind==='host_status'||e.kind==='error'&&/^remote offline/i.test(e.summary??''))&&this.hostAllowed(e.host));
    if(!visible&&e.meetings&&oldMeetings!==JSON.stringify(this.meetings(after)))return {reload:true};
    return {reload:false,...(visible?{event:{...e,...(e.meetings?{meetings:this.meetings(after)}:{})}}:{})};
  }
}
