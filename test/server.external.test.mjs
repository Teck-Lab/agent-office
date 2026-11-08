import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'agentoffice-external-'));
const bundle = join(temp, 'server.mjs');
await build({ stdin: { contents: 'export * from "./src/server/http.ts"; export * from "./src/server/state.ts";', resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'error' });
const { startServer, OfficeState } = await import(pathToFileURL(bundle));
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
