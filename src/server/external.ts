/** Opt-in, push-based observer API. It grants no terminal or agent-control access. */
import { timingSafeEqual } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { cleanOrchestration, nativeFamilyIds, type WorkerState, type Host, type RawEvent } from '../shared/events.ts';
import type { OfficeState } from './state.ts';
import {cleanMeeting} from '../shared/meetings.ts';
import { cleanPlan } from '../shared/plan.ts';
import { scrubText } from '../ingest/redact.ts';
import { parseMood } from '../mcp/tools.ts';

const ID = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,119}$/;
const kinds = new Set(['session_start','session_end','subagent_start','subagent_end','prompt','thinking','tool_start','tool_end','waiting','reply','plan','usage','error','idle','test_pass','test_fail','status','shout','celebrate','flip','meeting']);
const signals = new Set(['status','shout','celebrate','flip']);
const categories = new Set(['read','edit','bash','search','web','agent','todo','mcp','other']);
const agents = new Set(['omp','claude','codex','commandcode','opencode','droid','gemini','qwen','cursor']);
const label = (v: unknown, limit = 64) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, '').slice(0, limit) : undefined;
type Source = { token: string; project: string; host: Host };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function createExternalIngest(configPath: string, state: OfficeState, options: {
  now?:()=>number; schedule?:typeof setInterval; cancel?:typeof clearInterval;
} = {}) {
  const seen = new Map<string, number>();
  const active = new Map<string, { at: number; event: RawEvent }>();
  // Older loaded OMP observers heartbeat warm/finished helpers indefinitely.
  // Dormancy is presentation-only; a real new turn can reuse the same identity.
  const dormant = new Map<string,{at:number; parkedAt:number; state:WorkerState; event:RawEvent}>();
  const now = options.now ?? Date.now;
  const activeKinds = new Set(['session_start','subagent_start','prompt','thinking','tool_start','tool_end','reply','error','test_pass','test_fail']);
  const protectedWaits = new Set(['Awaiting approval','Awaiting helper work','Awaiting continuation']);
  const sweep = () => {
    const time = now();
    for (const [id, worker] of active) if (time - worker.at > 60_000) {
      state.ingest({ ...worker.event, ts: new Date(time).toISOString(), kind: worker.event.parentId ? 'subagent_end' : 'session_end' });
      active.delete(id);
    }
    const workers = state.snapshot().workers, byId = new Map(workers.map(w=>[w.workerId,w]));
    for(const [id, worker] of active){
      const w=byId.get(id);
      if(!w?.parentId || w.status!=='waiting' || protectedWaits.has(w.summary??'') || time-Date.parse(w.lastTs)<60_000)continue;
      const children=nativeFamilyIds(id,workers).slice(1);
      if(children.some(childId=>{const c=byId.get(childId);return c&&c.status!=='subagent_end'&&c.status!=='session_end'&&
        (protectedWaits.has(c.summary??'')||time-Date.parse(c.lastTs)<60_000||!['waiting','idle'].includes(c.status));}))continue;
      state.ingest({...worker.event,kind:'subagent_end',ts:new Date(time).toISOString()});
      active.delete(id);dormant.set(id,{at:time,parkedAt:time,state:w,event:worker.event});
    }
    for(const [id,worker] of dormant)if(time-worker.at>60_000)dormant.delete(id);
    for (const [id, at] of seen) if (time - at > 120_000) seen.delete(id);
  };
  const timer = (options.schedule??setInterval)(sweep, 5000); timer.unref?.();
  const reply = (res: ServerResponse, code: number, message: string) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ message }));
  };
  function sourceFor(id: string): Source | undefined {
    try {
      if (!lstatSync(configPath).isFile()) return;
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      if (config.version !== 1 || !record(config.sources) || !Object.hasOwn(config.sources, id)) return;
      const source = config.sources[id];
      if (!record(source) || typeof source.token !== 'string' || !/^[a-f0-9]{64}$/.test(source.token) ||
          typeof source.project !== 'string' || !record(source.host) || source.host.kind !== 'docker-sandbox' ||
          source.host.id !== id || typeof source.host.name !== 'string') return;
      return source as Source;
    } catch { return; }
  }
  return {
    close() { (options.cancel??clearInterval)(timer); },
    async handle(req: IncomingMessage, res: ServerResponse) {
      if (req.method !== 'POST') return reply(res, 405, 'POST required');
      if (req.headers.origin || req.headers['sec-fetch-site']) return reply(res, 403, 'Producer requests only');
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) return reply(res, 415, 'JSON required');
      let packet: Record<string, unknown>;
      try {
        let length = 0; const chunks: Buffer[] = [];
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 64 * 1024) return reply(res, 413, 'Batch too large');
          chunks.push(Buffer.from(chunk));
        }
        const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!record(data)) return reply(res, 400, 'Invalid packet');
        packet = data;
      } catch { return reply(res, 400, 'Invalid JSON'); }
      const sourceId = packet.sourceId;
      if (typeof sourceId !== 'string' || !ID.test(sourceId)) return reply(res, 401, 'Unknown source');
      const source = sourceFor(sourceId);
      const provided = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (!source || !/^[a-f0-9]{64}$/.test(provided) || !timingSafeEqual(Buffer.from(provided), Buffer.from(source.token))) return reply(res, 401, 'Invalid credential');
      if (packet.version !== 1 || !Array.isArray(packet.events) || packet.events.length > 100 ||
          (packet.wantSnapshot !== undefined && typeof packet.wantSnapshot !== 'boolean') ||
          (packet.heartbeat !== undefined && (!Array.isArray(packet.heartbeat) || packet.heartbeat.length > 256 || packet.heartbeat.some(id => typeof id !== 'string' || !ID.test(id))))) return reply(res, 400, 'Invalid batch');
      const pending: { id: string; event: RawEvent }[] = [];
      for (const value of packet.events) {
        if (!record(value) || typeof value.eventId !== 'string' || !ID.test(value.eventId) ||
            typeof value.workerId !== 'string' || !ID.test(value.workerId) ||
            (value.parentId !== undefined && (typeof value.parentId !== 'string' || !ID.test(value.parentId) || value.parentId === value.workerId)) ||
            typeof value.kind !== 'string' || !kinds.has(value.kind) || typeof value.agent !== 'string' || !agents.has(value.agent) ||
            typeof value.ts !== 'string' || !Number.isFinite(Date.parse(value.ts)) || Math.abs(now() - Date.parse(value.ts)) > 120_000 ||
            (value.category !== undefined && (typeof value.category !== 'string' || !categories.has(value.category))) ||
            (value.tokens !== undefined && (!Number.isSafeInteger(value.tokens) || Number(value.tokens) < 0 || Number(value.tokens) > 10_000_000)) ||
            (value.tokenTotal !== undefined && (!Number.isSafeInteger(value.tokenTotal) || Number(value.tokenTotal) < 0))) return reply(res, 400, 'Invalid event');
        const meeting=value.kind==='meeting'?cleanMeeting(value.meeting):undefined;
        if(value.kind==='meeting'&&(!meeting||value.nativeKind!=='main'||value.parentId))return reply(res,400,'Meetings require a main session');
        if(value.nativeKind!==undefined&&!['main','sub'].includes(String(value.nativeKind)))return reply(res,400,'Invalid native identity');
        const plan = value.plan === null ? null : value.plan === undefined ? undefined : cleanPlan(value.plan);
        if (value.plan !== undefined && value.plan !== null && !plan) return reply(res,400,'Invalid plan');
        const orchestration = cleanOrchestration(value.orchestration);
        if (value.orchestration !== undefined && value.orchestration !== null && !orchestration) return reply(res, 400, 'Invalid Orca ownership');
        const prefix = `external:${sourceId}:`;
        pending.push({ id: `${sourceId}:${value.eventId}`, event: {
          ts: value.ts, agent: value.agent as RawEvent['agent'], workerId: prefix + value.workerId,
          ...(meeting?{meeting}:{}),
          ...(value.nativeKind?{nativeKind:value.nativeKind as 'main'|'sub'}:{}),
          ...(value.parentId ? { parentId: prefix + value.parentId } : {}), kind: value.kind as RawEvent['kind'],
          project: label(source.project)!, host: { ...source.host, name: label(source.host.name)! },
          ...(plan !== undefined ? {plan} : {}),
          orchestration, placement: orchestration?.role === 'coordinator' ? 'office' : 'cloud',
          ...(value.tool ? { tool: value.kind === 'status' ? parseMood(value.tool) : label(value.tool, 48) } : {}),
          ...(value.category ? { category: value.category as RawEvent['category'] } : {}),
          ...(value.summary ? { summary: signals.has(value.kind) ? scrubText(value.summary) : label(value.summary) } : {}),
          ...(value.model ? { model: label(value.model) } : {}),
          ...(value.role ? { role: label(value.role) } : {}),
          ...(value.isError === true ? { isError: true } : {}),
          ...(value.tokens !== undefined ? { tokens: Number(value.tokens) } : {}),
          ...(value.tokenTotal !== undefined ? { tokenTotal: Number(value.tokenTotal) } : {}),
        } });
      }
      sweep();
      for (const { id, event } of pending) {
        if (seen.has(id)) continue;
        if (seen.size >= 10_000) seen.delete(seen.keys().next().value!);
        seen.set(id, now());
        const sleeping=dormant.get(event.workerId);
        if(sleeping){
          sleeping.at=now();
          if(event.kind==='session_end'||event.kind==='subagent_end'){dormant.delete(event.workerId);continue;}
          if(!activeKinds.has(event.kind)||Date.parse(event.ts)<=sleeping.parkedAt){
            if(event.plan!==undefined)sleeping.state.plan=event.plan;
            if(event.tokenTotal!==undefined)sleeping.state.tokens=Math.max(sleeping.state.tokens,event.tokenTotal);
            continue;
          }
          dormant.delete(event.workerId);
          state.ingest({...event,kind:'subagent_start',plan:event.plan??sleeping.state.plan,tokenTotal:event.tokenTotal??sleeping.state.tokens});
        }
        if (!active.has(event.workerId) && active.size+dormant.size >= 1024) continue;
        state.ingest(event);
        if (event.kind === 'session_end' || event.kind === 'subagent_end') active.delete(event.workerId);
        else active.set(event.workerId, { at: now(), event });
      }
      const live: string[] = [];
      for (const id of (packet.heartbeat ?? []) as string[]) {
        const key = `external:${sourceId}:${id}`, worker = active.get(key);
        if (worker) { worker.at = now(); live.push(key); }
        else {const sleeping=dormant.get(key);if(sleeping)sleeping.at=now();}
      }
      state.heartbeat(live);
      const current = packet.wantSnapshot === true ? state.snapshot() : undefined;
      const snapshot = current ? { version: 1, startedAt: current.startedAt, demo: false,
        workers: current.workers.filter(w => w.host?.kind === 'docker-sandbox' && w.host.id === sourceId),
        meetings: current.meetings?.filter(m=>m.sourceId===sourceId),
        recent: current.recent.filter(e => e.host?.kind === 'docker-sandbox' && e.host.id === sourceId).slice(-100) } : undefined;
      res.writeHead(202, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ accepted: true, missing: ((packet.heartbeat ?? []) as string[]).filter(id => !active.has(`external:${sourceId}:${id}`)&&!dormant.has(`external:${sourceId}:${id}`)), ...(snapshot ? { snapshot } : {}) }));
    },
  };
}
