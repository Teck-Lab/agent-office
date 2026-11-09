import type {OfficePlan} from '../../src/shared/plan.ts';
import type {OrcaCoordination,Host} from '../../src/shared/events.ts';

export interface ViewPreferences {
  time:'local'|'day'|'dusk'|'night'; weather:'date'|'clear'|'rain';
  theme:'original'|'forest'|'sunset'; furniture:'oak'|'walnut';
  layout:'horizontal'|'vertical'; characters:'original'|'headphones'|'caps';
  decor:'standard'|'plants'|'minimal'; labels:'tasks'|'status'|'quiet';
  motion:boolean; ambience:boolean; links:boolean; celebrations:boolean;
}
export const DEFAULT_VIEW:ViewPreferences={time:'local',weather:'date',theme:'original',furniture:'oak',layout:'horizontal',characters:'original',decor:'standard',labels:'tasks',motion:true,ambience:true,links:true,celebrations:true};
export function cleanView(input:unknown):ViewPreferences {
 const out={...DEFAULT_VIEW};if(!input||typeof input!=='object')return out;
 const raw=input as Record<string,unknown>;
 const enums={time:['local','day','dusk','night'],weather:['date','clear','rain'],theme:['original','forest','sunset'],furniture:['oak','walnut'],layout:['horizontal','vertical'],characters:['original','headphones','caps'],decor:['standard','plants','minimal'],labels:['tasks','status','quiet']};
 for(const [key,values]of Object.entries(enums))if(values.includes(raw[key] as string))Object.assign(out,{[key]:raw[key]});
 for(const key of ['motion','ambience','links','celebrations']as const)if(typeof raw[key]==='boolean')out[key]=raw[key];
 return out;
}
export const viewHour=(prefs:ViewPreferences,date=new Date())=>prefs.time==='local'?date.getHours()+date.getMinutes()/60+date.getSeconds()/3600:prefs.time==='day'?12:prefs.time==='dusk'?18:23;
export interface VisualWorker {id:string;parentId?:string;host?:Host;project:string;orchestration?:OrcaCoordination|null;act:string;needsHuman:boolean;leaving:boolean;plan?:OfficePlan|null;summary:string;role?:string}
export function teamKey(w:VisualWorker):string|null{return w.orchestration?.runId?JSON.stringify([w.host?.kind??'local',w.host?.id??'',w.project,w.orchestration.runId]):null;}
export function visualState(w:VisualWorker,crew:Iterable<VisualWorker>):{kind:string;label:string;color:string} {
 const state=(kind:string,label:string,color:string)=>({kind,label,color});
 if(w.leaving)return state('finished','Leaving','#9b99b2');
 if(w.needsHuman)return state('waiting-human','Needs you','#f2c879');
 if(w.act==='error')return state('blocked','Error reported','#fb7185');
 // Plan metadata is not execution activity: active tool use always wins.
 if(w.act!=='idle'&&w.act!=='waiting'){
   if(w.act==='edit')return state('coding','Implementing','#7dd3fc');
   if(w.orchestration?.role==='reviewer')return state('review','Reviewing','#c4b5fd');
   if(['read','search','web'].includes(w.act)||w.orchestration?.role==='researcher')return state('research','Researching','#f2c879');
   return state(w.act,w.act==='bash'?'Running command':w.act==='reply'?'Reporting':w.act==='thinking'?'Thinking':'Working','#7dd3fc');
 }
 if(w.plan?.goal?.status==='complete')return state('finished','Goal complete','#86efac');
 if(w.plan?.goal?.status==='paused')return state('paused','Goal paused','#c4b5fd');
 if(w.plan?.goal?.status==='dropped')return state('paused','Goal dropped','#9b99b2');
 if(w.plan?.goal?.status==='budget-limited')return state('paused','Budget limit','#f2c879');
 const open=w.plan?.phases.flatMap(p=>p.tasks).filter(t=>t.status!=='completed'&&t.status!=='abandoned')??[];
 if(open.length&&open.every(t=>t.status==='blocked'))return state('blocked','Tasks blocked','#fb7185');
 const key=teamKey(w);
 if(w.orchestration?.role==='coordinator'&&key&&[...crew].some(p=>p.id!==w.id&&!p.leaving&&teamKey(p)===key&&p.orchestration?.role!=='coordinator'))return state('waiting-team','Team present','#c4b5fd');
 return state('idle','Idle','#9b99b2');
}
export function taskLabel(w:VisualWorker):string {
 const tasks=w.plan?.phases.flatMap(p=>p.tasks)??[];
 return (tasks.find(t=>t.status==='in_progress')?.content??tasks.find(t=>t.status==='blocked')?.content??w.plan?.goal?.objective??w.summary??'').replace(/\s+/g,' ').slice(0,180);
}
export function completesGoal(before:OfficePlan|null|undefined,after:OfficePlan|null|undefined):boolean {
 return !!before?.goal&&before.goal.id===after?.goal?.id&&before.goal.status!=='complete'&&after.goal.status==='complete';
}
