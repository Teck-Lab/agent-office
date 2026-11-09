/** Cosmetic only: consumes observed events; never sends work or completes tasks. */
import type {OfficeEvent,Snapshot} from '../../src/shared/events.ts';
import type {Worker} from './workers.ts';
import {teamKey,completesGoal,type ViewPreferences} from './presentation.ts';
import {hash} from './util.ts';
import {MICRO,fit,textBitmap} from './font.ts';

export type Season='spring'|'summer'|'autumn'|'winter';
export function seasonAt(choice:ViewPreferences['season'],date=new Date()):Season{
 if(choice!=='north'&&choice!=='south')return choice;
 const quarter=Math.floor(((date.getMonth()+1)%12)/3);
 return (['winter','spring','summer','autumn'] as const)[(quarter+(choice==='south'?2:0))%4]!;
}
/** Drawn inside Sky's window clip. Still scenery remains when motion is disabled. */
export function drawSeason(g:CanvasRenderingContext2D,room:{x:number;w:number},top:number,height:number,season:Season,time:number,dark:number){
 const base=top+height,colors={spring:'#a7c67a',summer:'#418b6c',autumn:'#c98a50',winter:'#adbacd'};
 g.save();g.globalAlpha=1-dark*.45;
 for(let i=0;i<Math.ceil(room.w/57);i++){
  const x=Math.floor(room.x+i*57+19),y=base-5-(i%3)*3;
  g.fillStyle='#584b54';g.fillRect(x,y-17,2,base-(y-17));
  g.fillStyle=colors[season];g.fillRect(x-7,y-19,16,10);g.fillRect(x-4,y-23,10,5);g.fillRect(x-10,y-15,22,7);
  if(season==='spring'){g.fillStyle='#edb9ca';for(const [dx,dy]of [[-5,-18],[4,-19],[-2,-13],[7,-12]])g.fillRect(x+dx!,y+dy!,2,2);}
  if(season==='winter'){g.fillStyle='#e4edf5';g.fillRect(x-4,y-24,10,2);g.fillRect(x-7,y-20,16,2);g.fillRect(x-10,y-16,5,2);}
  if(season==='autumn'){g.fillStyle='#e6ac63';g.fillRect(x-5,y-20,5,3);g.fillRect(x+2,y-13,6,3);}
 }
 g.fillStyle=season==='winter'?'#c5d5e2':season==='autumn'?'#6c6550':'#426454';g.fillRect(room.x,base-2,room.w,2);
 // A few leaves/blossoms/snowflakes, not an actual weather report.
 if(time>0&&season!=='summer')for(let i=0;i<Math.ceil(room.w/46);i++){
  const x=Math.floor(room.x+((i*47+Math.sin(time/2500+i)*7+room.w)%room.w));
  const y=Math.floor(top+(time*(season==='winter'?.006:.004)+i*23)%height);
  g.fillStyle=season==='winter'?'#e4edf5':season==='spring'?'#edb9ca':'#d99b55';g.fillRect(x,y,season==='winter'?1:2,1);
 }
 g.restore();
}

export function deskIdentity(w:Pick<Worker,'id'|'role'|'orchestration'>){
 const seed=hash(w.id),accent=['#7dd3fc','#c4b5fd','#86efac','#f2c879','#f9a8d4','#67e8f9'][seed%6]!;
 const role=w.orchestration?.role??w.role??'OMP';
 const title=role==='coordinator'?'COORD':role.toUpperCase().replace(/[^A-Z0-9 ]/g,'').slice(0,5)||'OMP';
 return {seed,accent,title,mark:(seed%1296).toString(36).padStart(2,'0').toUpperCase()};
}
/** Desk front nameplate plus a tiny framed landscape at the monitor's edge. */
export function drawPersonalDesk(g:CanvasRenderingContext2D,w:Worker,x:number,y:number){
 const d=deskIdentity(w);g.fillStyle='#242331';g.fillRect(x+7,y+11,29,8);
 g.fillStyle=d.accent;g.fillRect(x+7,y+11,2,8);
 const label=textBitmap(MICRO(),fit(MICRO(),d.title.slice(0,3)+' '+d.mark,23),'#eee7da');g.drawImage(label.c,x+11,y+12);
 g.fillStyle='#242331';g.fillRect(x,y-6,5,7);g.fillStyle=d.accent;g.fillRect(x+1,y-5,3,4);
 g.fillStyle='#455b50';g.fillRect(x+1,y-2,3,2);g.fillStyle='#f3dfac';g.fillRect(x+1+(d.seed%2),y-4,1,1);
}

type Transfer={from:string;to:string;at:number;kind:'assignment'|'helper-start'|'helper-end'|'goal-complete'};
const binding=(w:{orchestration?:OfficeEvent['orchestration']})=>w.orchestration?.dispatchId;
export class Handoffs{
 readonly pending:Transfer[]=[];
 private seq=0;
 private assignments=new Set<string>();
 clear(){this.pending.length=0;this.seq=0;this.assignments.clear();}
 seed(s:Snapshot){this.clear();this.seq=Math.max(0,...s.recent.map(e=>e.seq||0));for(const w of s.workers)if(binding(w))this.remember(w.workerId+':'+binding(w));}
 private remember(key:string){this.assignments.add(key);if(this.assignments.size>2048)this.assignments.delete(this.assignments.values().next().value!);}
 observe(e:OfficeEvent,workers:Map<string,Worker>,now:number,enabled:boolean,unavailable:(w:Worker)=>boolean){
  if(e.seq&&e.seq<=this.seq)return;if(e.seq)this.seq=e.seq;
  const existing=workers.get(e.workerId),parent=e.parentId??existing?.parentId;
  const current=existing?{...existing,...(e.orchestration!==undefined?{orchestration:e.orchestration}:{})}:{id:e.workerId,host:e.host,project:e.project,orchestration:e.orchestration};
  let from:string|undefined,to:string|undefined,kind:Transfer['kind']|undefined;
  if(parent&&e.kind==='subagent_start'&&(!existing||existing.leaving)){from=parent;to=e.workerId;kind='helper-start';}
  else if(parent&&e.kind==='subagent_end'&&existing&&!existing.leaving){from=e.workerId;to=parent;kind='helper-end';}
  else if(!parent){
   const run=teamKey({...current,act:'idle',needsHuman:false,leaving:false,summary:''}),owners=run?[...workers.values()].filter(w=>!w.parentId&&!w.leaving&&w.id!==e.workerId&&w.orchestration?.role==='coordinator'&&teamKey(w)===run):[];
   const key=e.workerId+':'+binding(current),fresh=!!binding(current)&&!this.assignments.has(key);
   if(fresh)this.remember(key);
   if(owners.length===1){
    if(fresh){from=owners[0]!.id;to=e.workerId;kind='assignment';}
    else if(e.kind==='plan'&&existing&&completesGoal(existing.plan,e.plan)){from=e.workerId;to=owners[0]!.id;kind='goal-complete';}
   }
  }
  if(!enabled||!from||!to||!kind)return;
  const a=workers.get(from),b=workers.get(to);if((a&&unavailable(a))||(b&&unavailable(b)))return;
  // Unknown owner, foreign host or project: no guessed handoff across teams.
  const owner=workers.get(parent??(from===e.workerId?to:from));
  if(!owner||owner.project!==current.project||owner.host?.id!==current.host?.id||owner.host?.kind!==current.host?.kind)return;
  this.pending.push({from,to,at:now,kind});if(this.pending.length>24)this.pending.shift();
 }
 draw(g:CanvasRenderingContext2D,workers:Map<string,Worker>,now:number,enabled:boolean,unavailable:(w:Worker)=>boolean){
  for(let i=this.pending.length-1;i>=0;i--)if(now-this.pending[i]!.at>1800)this.pending.splice(i,1);
  if(!enabled){this.pending.length=0;return;}
  for(const h of this.pending){const a=workers.get(h.from),b=workers.get(h.to);if(!a||!b||a.gone||b.gone||unavailable(a)||unavailable(b))continue;
   const t=Math.max(0,Math.min(1,(now-h.at)/1800)),x=Math.round(a.x+(b.x-a.x)*t),y=Math.round(a.y+(b.y-a.y)*t-24-Math.sin(t*Math.PI)*24);
   if(!Number.isFinite(x)||!Number.isFinite(y))continue;
   g.save();g.globalAlpha=Math.min(1,t*8,(1-t)*8);g.fillStyle='#262538';g.fillRect(x-5,y-4,11,8);
   g.fillStyle=h.kind==='assignment'||h.kind==='helper-start'?'#f2c879':'#b4d6e8';g.fillRect(x-4,y-3,9,6);g.fillRect(x-4,y-5,4,2);
   g.fillStyle='#5b637d';g.fillRect(x-2,y-1,5,1);g.restore();
  }
 }
}
