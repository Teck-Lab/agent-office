import type { WorkerState } from '../../src/shared/events.ts';
import type { OfficePlan } from '../../src/shared/plan.ts';
export interface BoardView {
  owner: WorkerState; plan: OfficePlan|null; workers: WorkerState[];
  total: number; completed: number; blocked: number; current?: string;
}
export function boardViews(workers: Iterable<WorkerState>): BoardView[] {
  const all=[...workers];
  return all.filter(w=>!w.parentId && w.agent==='omp' && w.orchestration?.role==='coordinator')
    .sort((a,b)=>a.workerId.localeCompare(b.workerId)).map(owner=>{
      const plan=owner.plan??null, tasks=plan?.phases.flatMap(p=>p.tasks)??[];
      // Equal project names are not ownership. Match the exact host and Run.
      const run=owner.orchestration?.runId;
      const assigned=run?all.filter(w=>!w.parentId && w.workerId!==owner.workerId &&
        w.orchestration?.role!=='coordinator' && w.orchestration?.runId===run && w.host?.id===owner.host?.id):[];
      return {owner,plan,workers:assigned,total:tasks.length,completed:tasks.filter(t=>t.status==='completed').length,
        blocked:tasks.filter(t=>t.status==='blocked').length,current:tasks.find(t=>t.status==='in_progress')?.content};
    });
}
