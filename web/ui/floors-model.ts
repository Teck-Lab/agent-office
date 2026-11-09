import type {Host,OfficeEvent,Snapshot,WorkerState} from '../../src/shared/events.ts';
import {OfficeModel} from './state.ts';

export interface Floor {
  key:string;kind:'all'|'project'|'run';project:string;hostKind:string;hostId:string;
  runId:string;label:string;group:string;sessions:number;helpers:number;
}
export const ALL_FLOORS:Floor={key:'all',kind:'all',project:'',hostKind:'',hostId:'',runId:'',label:'All floors',group:'',sessions:0,helpers:0};
const projectKey=(w:Pick<WorkerState,'project'|'host'>)=>JSON.stringify(['project',w.host?.kind??'local',w.host?.id??'',w.project,'']);
const runKey=(w:Pick<WorkerState,'project'|'host'|'orchestration'>)=>w.orchestration?.runId?JSON.stringify(['run',w.host?.kind??'local',w.host?.id??'',w.project,w.orchestration.runId]):null;

export function restoreFloor(key:unknown):Floor {
  if(key==='all')return {...ALL_FLOORS};
  try{
    if(typeof key!=='string'||key.length>1200)throw Error();
    const a:unknown=JSON.parse(key);
    if(!Array.isArray(a)||a.length!==5||a.some(v=>typeof v!=='string'||v.length>256)||!['project','run'].includes(a[0])||(a[0]==='run'&&!a[4]))throw Error();
    const [kind,hostKind,hostId,project,runId]=a as string[];
    return {key,kind:kind as 'project'|'run',project:project!,hostKind:hostKind!,hostId:hostId!,runId:runId!,label:kind==='run'?'Run '+runId:project||'Untitled project',group:project||'Untitled project',sessions:0,helpers:0};
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
function scope(w:Pick<WorkerState,'project'|'host'|'orchestration'>){return {project:projectKey(w),run:runKey(w)};}
type Scope=ReturnType<typeof scope>;
const belongs=(floor:Floor,s:Scope)=>floor.kind==='all'||floor.key===(floor.kind==='project'?s.project:s.run);

export class FloorModel {
  readonly model=new OfficeModel();
  selected:Floor;
  private base:Snapshot={version:1,startedAt:'',demo:false,workers:[],recent:[]};
  private history:{event:OfficeEvent;scope:Scope}[]=[];
  private highestSeq=0;
  constructor(key:unknown='all'){this.selected=restoreFloor(key);}
  private owner(w:WorkerState){return floorOwner(w,this.model.workers);}
  ids():Set<string>{return new Set([...this.model.workers.values()].filter(w=>belongs(this.selected,scope(this.owner(w)))).map(w=>w.workerId));}
  floors():Floor[]{
    const floors=new Map<string,Floor>(),all={...ALL_FLOORS};
    const workers=[...this.model.workers.values()];
    // Prefer coordinator titles when a Run includes several independent roots.
    const roots=workers.filter(w=>!w.parentId).sort((a,b)=>Number(b.orchestration?.role==='coordinator')-Number(a.orchestration?.role==='coordinator'));
    for(const w of [...roots,...workers]){
      const root=this.owner(w),group=(root.project||'Untitled project')+' · '+(root.host?.name??'Local');
      for(const key of [projectKey(root),runKey(root)])if(key&&!floors.has(key)){
        const f=restoreFloor(key);f.group=group;
        const title=(root.plan?.goal?.objective??'').replace(/\s+/g,' ').slice(0,52);
        f.label=f.kind==='project'?group:title?title+' · '+f.runId:f.label;
        floors.set(key,f);
      }
    }
    for(const w of workers){const root=this.owner(w);for(const key of [projectKey(root),runKey(root)]){const f=key?floors.get(key):null;if(f){if(w.parentId)f.helpers++;else f.sessions++;}}if(w.parentId)all.helpers++;else all.sessions++;}
    const live=floors.get(this.selected.key);if(live)this.selected={...live};
    else if(this.selected.kind!=='all')floors.set(this.selected.key,{...this.selected,sessions:0,helpers:0});
    const rest=[...floors.values()].sort((a,b)=>a.group.localeCompare(b.group)||a.hostId.localeCompare(b.hostId)||(a.kind===b.kind?a.runId.localeCompare(b.runId):a.kind==='project'?-1:1));
    return [all,...rest];
  }
  choose(key:unknown){this.selected=restoreFloor(key);this.floors();}
  load(s:Snapshot){
    this.base=s;this.model.load(s);this.highestSeq=Math.max(0,...s.recent.map(e=>e.seq||0));
    this.history=s.recent.slice(-200).map(event=>({event,scope:this.eventScope(event)}));this.floors();
  }
  private eventScope(e:OfficeEvent):Scope {
    const w=this.model.workers.get(e.workerId)??(e.parentId?this.model.workers.get(e.parentId):undefined);
    return scope(w?this.owner(w):e);
  }
  private hostAllowed(host?:Host){return !!host&&(this.selected.kind==='all'||host.id===this.selected.hostId&&host.kind===this.selected.hostKind);}
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
