import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'agentoffice-external-'));
const bundle = join(temp, 'server.mjs');
await build({ stdin: { contents: 'export * from "./src/server/http.ts"; export * from "./src/server/state.ts"; export * from "./src/server/external.ts";', resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'error' });
const { startServer, OfficeState, createExternalIngest } = await import(pathToFileURL(bundle));
process.on('exit', () => rmSync(temp, { recursive: true, force: true }));
const token = 'a'.repeat(64), sourceId = 'sandbox-a';
const source = { token, project: 'Teck.Monorepo', host: { kind: 'docker-sandbox', id: sourceId, name: 'teck-orca-a' } };
async function office(t, enabled = true) {
  const config = join(temp, `${crypto.randomUUID()}.json`);
  writeFileSync(config, JSON.stringify({ version: 1, sources: { [sourceId]: source } }));
  const state = new OfficeState();
  const srv = await startServer({ state, port: 0, externalConfig: enabled ? config : undefined });
  t.after(() => srv.close());
  const send = async (data, headers = {}) => {
    const r = await fetch(`${srv.url}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify({ version: 1, sourceId, ...data }) });
    return { status: r.status, body: await r.text() };
  };
  return { config, state, send, srv };
}
const event = (kind, workerId = 'main', extra = {}) => ({ eventId: crypto.randomUUID(), ts: new Date().toISOString(), agent: 'omp', workerId, kind, ...extra });

test('external ingestion is opt-in, authenticated and rejects browser origins', async t => {
  const off = await office(t, false);
  assert.equal((await off.send({ events: [] })).status, 405);
  const on = await office(t);
  assert.equal((await on.send({ events: [] }, { Authorization: 'Bearer invalid' })).status, 401);
  assert.equal((await on.send({ sourceId: 'unknown', events: [] })).status, 401);
  assert.equal((await on.send({ events: [] }, { Origin: 'https://other.example' })).status, 403);
});

test('OMP workers and helpers are namespaced and sandbox identity is server-owned', async t => {
  const { state, send } = await office(t);
  const response = await send({ events: [event('session_start'), event('subagent_start', 'child', { parentId: 'main', role: 'researcher', project: 'spoof', host: { kind: 'ssh', id: 'other', name: 'other' } })] });
  assert.equal(response.status, 202, response.body);
  const [main, child] = state.snapshot().workers;
  assert.equal(main.agent, 'omp');
  assert.equal(main.project, 'Teck.Monorepo');
  assert.equal(main.host.kind, 'docker-sandbox');
  assert.equal(main.host.id, sourceId);
  assert.notEqual(main.workerId, 'main');
  assert.equal(child.parentId, main.workerId);
  assert.equal(child.role, 'researcher');
});

test('retry delivery and heartbeats never duplicate tool counts or change activity', async t => {
  const { state, send } = await office(t);
  const events = [event('session_start'), event('tool_start', 'main', { tool: 'bash', category: 'bash', summary: 'Executing bash' })];
  assert.equal((await send({ events })).status, 202);
  assert.equal((await send({ events })).status, 202);
  const before = state.snapshot().workers[0];
  assert.equal(before.toolCalls, 1);
  assert.equal((await send({ events: [], heartbeat: ['main'] })).status, 202);
  const after = state.snapshot().workers[0];
  assert.equal(after.toolCalls, 1);
  assert.equal(after.status, before.status);
  assert.equal(after.lastTs, before.lastTs);
});

test('external own-session usage is replay-safe, preserves activity and keeps helpers separate',async t=>{
  const {state,send}=await office(t);
  await send({events:[event('session_start'),event('tool_start','main',{tool:'read',category:'read'}),event('subagent_start','helper',{parentId:'main'})]});
  const usage=event('usage','main',{tokenTotal:20_000_000});
  assert.equal((await send({events:[usage]})).status,202);
  await send({events:[usage,event('usage','main',{tokenTotal:20_000_000}),event('usage','helper',{parentId:'main',tokenTotal:350})]});
  let main=state.snapshot().workers.find(w=>w.workerId.endsWith(':main'));
  assert.equal(main.tokens,20_000_000);assert.equal(main.toolCalls,1);assert.equal(main.status,'tool_start');assert.equal(main.tool,'read');
  assert.equal(state.snapshot().workers.find(w=>w.workerId.endsWith(':helper')).tokens,350);
  await send({events:[event('usage','main',{tokenTotal:19_000_000}),event('usage','main',{tokens:7})]});
  main=state.snapshot().workers.find(w=>w.workerId.endsWith(':main'));assert.equal(main.tokens,20_000_007);
  for(const tokenTotal of [-1,1.5,'123',null,Number.MAX_SAFE_INTEGER+1]){
    assert.equal((await send({events:[event('usage','main',{tokenTotal})]})).status,400);
  }
  assert.equal(state.snapshot().workers.find(w=>w.workerId.endsWith(':main')).tokens,20_000_007);
});

test('malformed batches are rejected atomically; revoked credentials stop working', async t => {
  const { state, send, config } = await office(t);
  assert.equal((await send({ events: [event('session_start'), event('invented')] })).status, 400);
  assert.equal(state.size, 0);
  assert.equal((await send({ events: Array.from({ length: 101 }, () => event('session_start')) })).status, 400);
  assert.equal((await send({ events: [event('session_start', '../bad')] })).status, 400);
  writeFileSync(config, JSON.stringify({ version: 1, sources: {} }));
  assert.equal((await send({ events: [event('session_start')] })).status, 401);
});

test('unknown payload fields never enter the office snapshot', async t => {
  const { state, send } = await office(t);
  const secret = 'sensitive-prompt-and-tool-output';
  assert.equal((await send({ events: [event('session_start', 'main', { prompt: secret, args: { key: secret }, output: secret, cwd: '/private/root' })] })).status, 202);
  assert.ok(!JSON.stringify(state.snapshot()).includes(secret));
  assert.ok(!JSON.stringify(state.snapshot()).includes('/private/root'));
});


test('Orca placement is separate from the server-owned sandbox and preserves bounded lifecycle IDs',async t=>{
  const {state,send}=await office(t);
  const orchestration={role:'coordinator',runId:'run-one',extra:'discard-me'};
  assert.equal((await send({events:[event('session_start','coordinator',{orchestration,placement:'cloud'}),event('subagent_start','helper',{parentId:'coordinator',orchestration,role:'researcher'}),event('session_start','executor',{orchestration:{role:'executor',runId:'run-one',taskId:'task-one',dispatchId:'dispatch-one'},placement:'office'})]})).status,202);
  const [coordinator,helper,executor]=state.snapshot().workers;
  assert.equal(coordinator.placement,'office');assert.equal(coordinator.host.kind,'docker-sandbox');
  assert.equal(helper.placement,'office');assert.equal(helper.parentId,coordinator.workerId);
  assert.equal(executor.placement,'cloud');assert.equal(executor.parentId,undefined);
  assert.equal(executor.orchestration.dispatchId,'dispatch-one');assert.equal(coordinator.orchestration.extra,undefined);
  assert.equal((await send({events:[event('thinking','coordinator',{orchestration:null,placement:'office'})]})).status,202);
  const cleared=state.snapshot().workers.find(w=>w.workerId===coordinator.workerId);
  assert.equal(cleared.orchestration,null);assert.equal(cleared.placement,'cloud');
  assert.equal((await send({events:[event('session_start','invalid',{orchestration:{role:'executor',runId:'run-one'}})]})).status,400);
});


test('late same-room Run binding refreshes idle native descendants and revocation clears them',async t=>{
  const {state,send}=await office(t);
  assert.equal((await send({events:[event('session_start','main',{orchestration:{role:'coordinator'}}),event('subagent_start','child',{parentId:'main'}),event('subagent_start','deep',{parentId:'child'})]})).status,202);
  const childBefore=state.snapshot().workers.find(w=>w.parentId?.endsWith(':main'));
  assert.equal((await send({events:[event('thinking','main',{orchestration:{role:'coordinator',runId:'run-late'}})]})).status,202);
  for(const w of state.snapshot().workers){assert.equal(w.orchestration.runId,'run-late');assert.equal(w.placement,'office');}
  const childAfter=state.snapshot().workers.find(w=>w.workerId===childBefore.workerId);
  assert.equal(childAfter.lastTs,childBefore.lastTs);assert.equal(childAfter.toolCalls,childBefore.toolCalls);
  assert.equal((await send({events:[event('thinking','main',{orchestration:null})]})).status,202);
  for(const w of state.snapshot().workers){assert.equal(w.orchestration,null);assert.equal(w.placement,'cloud');}
  assert.equal((await send({events:[event('thinking','deep',{parentId:'child',orchestration:{role:'coordinator',runId:'stale'}})]})).status,202);
  const deep=state.snapshot().workers.find(w=>w.workerId.endsWith(':deep'));
  assert.equal(deep.orchestration,null);assert.equal(deep.placement,'cloud');
});

test('ending a native root retires every descendant, with cycle-safe cleanup',async t=>{
  const {state,send}=await office(t);
  await send({events:[event('session_start'),event('subagent_start','child',{parentId:'main'}),event('subagent_start','deep',{parentId:'child'})]});
  await send({events:[event('session_end')]});assert.equal(state.size,0);
  assert.ok(state.snapshot().recent.some(e=>e.kind==='subagent_end'&&e.workerId.endsWith(':deep')));
  await send({events:[event('subagent_start','cycle-a',{parentId:'cycle-b'}),event('subagent_start','cycle-b',{parentId:'cycle-a'})]});
  await send({events:[event('session_end','cycle-a')]});assert.equal(state.size,0);
});


test('native plans persist across snapshots and replay without changing worker activity',async t=>{
  const {state,send}=await office(t);
  const plan={goal:{id:'goal-main',objective:'Ship preview',status:'active'},phases:[{name:'Delivery',tasks:[{content:'Verify CNPG',status:'blocked',blocker:'Waiting for restore proof'}]}]};
  await send({events:[event('session_start','main',{orchestration:{role:'coordinator',runId:'run-board'}}),event('tool_start','main',{tool:'read',category:'read'})]});
  const before=state.snapshot().workers[0], update=event('plan','main',{plan});
  assert.equal((await send({events:[update]})).status,202);
  await send({events:[update]});
  let after=state.snapshot().workers[0];
  assert.deepEqual(after.plan,plan);assert.equal(after.status,before.status);assert.equal(after.lastTs,before.lastTs);assert.equal(after.toolCalls,1);
  const childPlan={goal:null,phases:[]};
  await send({events:[event('subagent_start','child',{parentId:'main',plan:childPlan})]});
  assert.deepEqual(state.snapshot().workers.find(w=>w.parentId).plan,childPlan,'plans belong to a session, not its inherited placement');
  assert.equal((await send({events:[event('plan','main',{plan:{...plan,goal:{...plan.goal,status:'invented'}}})]})).status,400);
  assert.deepEqual(state.snapshot().workers[0].plan,plan,'invalid snapshots cannot replace the current plan');
  await send({events:[event('plan','main',{plan:null})]});assert.equal(state.snapshot().workers[0].plan,null);
});

test('plan payloads are capped, redacted and stripped of unrecognized fields',async t=>{
  const {state,send}=await office(t);
  const secret='ghp_'+'z'.repeat(36);
  const plan={goal:{id:'goal-redacted',objective:'Verify '+secret,status:'paused',raw:'PRIVATE'},phases:Array.from({length:14},()=>({name:'Tests',tasks:Array.from({length:10},()=>({content:'Check password=unsafe',status:'pending',raw:'PRIVATE'}))})),transcript:'PRIVATE'};
  assert.equal((await send({events:[event('session_start','main',{plan})]})).status,202);
  const saved=state.snapshot().workers[0].plan;
  assert.ok(saved.truncated);assert.equal(saved.phases.length,12);assert.equal(saved.phases.flatMap(p=>p.tasks).length,60);
  assert.ok(!JSON.stringify(saved).includes(secret));assert.ok(!JSON.stringify(saved).includes('unsafe'));assert.ok(!JSON.stringify(saved).includes('PRIVATE'));
});


test('Unicode goals and blocker notes stay inside the ingestion envelope',async t=>{
  const {state,send}=await office(t);
  // The incoming packet itself must fit; test the shared sanitizer separately
  // through a normal batch with repetitive but valid Unicode titles.
  const plan={goal:{id:'g-unicode',objective:'界'.repeat(240),status:'active'},phases:[{name:'Delivery',tasks:Array.from({length:60},()=>({content:'界'.repeat(100),status:'blocked',blocker:'界'.repeat(100)}))}]};
  assert.equal((await send({events:[event('session_start','unicode',{plan})]})).status,202);
  const saved=state.snapshot().workers[0].plan;assert.ok(saved.truncated);
  assert.ok(Buffer.byteLength(JSON.stringify(saved))<=24*1024);assert.ok(saved.phases[0].tasks.length>0);
});


async function timedOffice(t){
  let clock=Date.now(),sweep;const state=new OfficeState({now:()=>clock});
  const config=join(temp,crypto.randomUUID()+'.json');writeFileSync(config,JSON.stringify({version:1,sources:{[sourceId]:source}}));
  const ingest=createExternalIngest(config,state,{now:()=>clock,schedule:fn=>{sweep=fn;return {unref(){}}},cancel(){}});
  const server=createServer((req,res)=>void ingest.handle(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{ingest.close();server.closeAllConnections();server.close()});
  const send=async(events=[],heartbeat=[])=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/ingest',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({version:1,sourceId,events,heartbeat})});assert.equal(r.status,202);return r.json()};
  return {state,send,advance:ms=>{clock+=ms},tick:()=>sweep(),at:()=>new Date(clock).toISOString()};
}

test('warm finished helpers leave after quiet grace despite heartbeats, stay gone and can be reused',async t=>{
  const o=await timedOffice(t),plan={goal:null,phases:[{name:'Helper',tasks:[{content:'Inspect',status:'completed'}]}]};
  await o.send([event('session_start'),event('subagent_start','helper',{parentId:'main',plan}),event('waiting','helper',{parentId:'main'})]);
  o.advance(30000);await o.send([],['main','helper']);o.advance(31000);let r=await o.send([],['main','helper']);
  assert.deepEqual(r.missing,[],'warm helper presence is acknowledged without respawning its seat');
  assert.deepEqual(o.state.snapshot().workers.map(w=>w.workerId.split(':').at(-1)),['main']);
  for(let i=0;i<4;i++){o.advance(15000);r=await o.send([],['main','helper']);assert.deepEqual(r.missing,[]);assert.equal(o.state.snapshot().workers.length,1);}
  await o.send([event('plan','helper',{parentId:'main',ts:o.at(),plan})]);assert.equal(o.state.snapshot().workers.length,1,'metadata does not wake dormant helpers');
  o.advance(1);await o.send([event('thinking','helper',{parentId:'main',ts:o.at()})]);
  const restored=o.state.snapshot().workers.find(w=>w.parentId);assert.ok(restored);assert.equal(restored.status,'thinking');assert.deepEqual(restored.plan,plan);
});

test('helper approval/continuation waits and parents supervising busy descendants do not disappear',async t=>{
  const o=await timedOffice(t),ids=['main','approval','continuation','supervisor','nested'];
  await o.send([event('session_start'),event('subagent_start','approval',{parentId:'main'}),event('waiting','approval',{parentId:'main',summary:'Awaiting approval'}),
    event('subagent_start','continuation',{parentId:'main'}),event('waiting','continuation',{parentId:'main',summary:'Awaiting helper work'}),
    event('subagent_start','supervisor',{parentId:'main'}),event('waiting','supervisor',{parentId:'main'}),
    event('subagent_start','nested',{parentId:'supervisor'}),event('tool_start','nested',{parentId:'supervisor',tool:'read'})]);
  o.advance(30000);await o.send([],ids);o.advance(31000);await o.send([],ids);
  assert.equal(o.state.snapshot().workers.length,5);
  await o.send([event('waiting','nested',{parentId:'supervisor',summary:'Awaiting continuation',ts:o.at()})]);
  o.advance(30000);await o.send([],ids);o.advance(31000);await o.send([],ids);assert.equal(o.state.snapshot().workers.length,5);
});
