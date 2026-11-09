// Deliberately bounded presentation metadata. Never contains tool inputs or transcripts.
import { clip, redactSecrets } from '../ingest/redact.ts';
export type TaskStatus = 'pending'|'in_progress'|'completed'|'abandoned'|'blocked';
export interface OfficePlan {
  goal: { id: string; objective: string; status: 'active'|'paused'|'complete'|'dropped'|'budget-limited' } | null;
  phases: { name: string; tasks: { content: string; status: TaskStatus; blocker?: string }[] }[];
  truncated?: boolean;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v==='object' && !Array.isArray(v);
const statuses = new Set(['pending','in_progress','completed','abandoned','blocked']);
const goals = new Set(['active','paused','complete','dropped','budget-limited']);
const text = (v: unknown, max: number) => typeof v==='string' ? clip(redactSecrets(v.slice(0,2000)),max) : '';
export function cleanPlan(v: unknown): OfficePlan | null {
  if (!object(v) || !Array.isArray(v.phases)) return null;
  const out: OfficePlan = {goal:null, phases:[]};
  if (v.goal !== null) {
    if (!object(v.goal) || typeof v.goal.id!=='string' || !/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,119}$/.test(v.goal.id) ||
        typeof v.goal.status!=='string' || !goals.has(v.goal.status) || !text(v.goal.objective,240)) return null;
    out.goal={id:v.goal.id,objective:text(v.goal.objective,240),status:v.goal.status as NonNullable<OfficePlan['goal']>['status']};
  }
  let remaining=60;
  if(v.phases.length>12 || v.truncated===true)out.truncated=true;
  for(const phase of v.phases.slice(0,12)) {
    if(!object(phase)||typeof phase.name!=='string'||!Array.isArray(phase.tasks))return null;
    const tasks: OfficePlan['phases'][number]['tasks']=[];
    if(phase.tasks.length>remaining)out.truncated=true;
    for(const task of phase.tasks.slice(0,remaining)) {
      if(!object(task)||typeof task.content!=='string'||typeof task.status!=='string'||!statuses.has(task.status))return null;
      tasks.push({content:text(task.content,180),status:task.status as TaskStatus,...(typeof task.blocker==='string'?{blocker:text(task.blocker,180)}:{})});
    }
    remaining-=tasks.length;out.phases.push({name:text(phase.name,64),tasks});
  }
  // Leave ample room in the 64 KiB ingest envelope even for Unicode and
  // blocker notes. Explicit truncation prevents claiming this is the full list.
  while(new TextEncoder().encode(JSON.stringify(out)).length>24*1024){
    const last=[...out.phases].reverse().find(p=>p.tasks.length);if(!last)break;
    last.tasks.pop();out.truncated=true;
  }
  return out;
}
