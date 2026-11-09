// Tests for the web app's DOM-free parts: busy-pod seating (web/scene/layout.ts),
// the intern summary chip text, OfficeEvent.replaces in the chrome's model
// (web/ui/state.ts) and the control store's session lookup (web/ui/control/store.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

async function load(...entries) {
  const dir = mkdtempSync(join(tmpdir(), "agentoffice-web-test-"));
  const outfile = join(dir, "mod.mjs");
  await build({
    stdin: { contents: entries.map((e) => `export * from ${JSON.stringify(`./${e}`)};`).join("\n"), resolveDir: ROOT, loader: "ts" },
    bundle: true, platform: "node", format: "esm", target: "node18", outfile, logLevel: "error",
    loader: { ".svg": "text", ".css": "text" },
  });
  try {
    return await import(pathToFileURL(outfile).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const {
  Layout, Camera, SEAT_W, MAX_BENCH, MAX_HOT, POD_H, DESK_W, DESK_DY, SEAT_DY, DESK_ROW, ROOM_MIN_W, ROOM_MIN_W_TALL,
  internSummary, OfficeModel, ControlStore, Crew,
} = await load(
  "web/scene/workers.ts",
  "web/scene/layout.ts",
  "web/scene/camera.ts",
  "web/scene/util.ts",
  "web/ui/state.ts",
  "web/ui/control/store.ts",
);

/** A pod with one main worker and `n` interns, packed and settled. */
function crew(n, mains = 1) {
  const layout = new Layout();
  const seats = [];
  for (let m = 0; m < mains; m++) {
    layout.allocMain(`main${m}`, "claude", "Codes", undefined, 0);
    for (let i = 0; i < n; i++) seats.push(layout.allocIntern(`m${m}-sub${i}`, `main${m}`, "claude", "Codes", undefined, 0));
  }
  for (let t = 0; t < 200; t++) layout.update(16, t * 16);
  return { layout, seats, block: [...layout.blocks.values()][0] };
}

test("a busy pod seats every intern: nobody stands", () => {
  for (const n of [5, 9, 15]) {
    const { seats } = crew(n);
    assert.equal(seats.length, n);
    for (const s of seats) assert.equal(s.kind, "intern", `${n} interns: ${s.kind}`);
  }
});

test("1 + 9: the main desk's bench fills, the overflow goes to a hot desk, all on the rug", () => {
  const { seats, block } = crew(9);
  const own = seats.filter((s) => !s.st.hot), hot = seats.filter((s) => s.st.hot);
  assert.equal(own.length, MAX_BENCH);
  assert.equal(hot.length, 9 - MAX_BENCH);
  assert.equal(block.stations.at(-1).hot, true, "hot desks sit at the end of the pod");
  const xs = seats.map((s) => s.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= SEAT_W, `seats ${xs[i - 1]} and ${xs[i]} overlap`);
  for (const s of seats) {
    assert.ok(s.x - 7 >= block.x && s.x + 7 <= block.x + block.w, `intern at ${s.x} is off the rug [${block.x}, ${block.x + block.w}]`);
    assert.ok(s.y < block.y + POD_H, "inside the pod");
  }
});

test("two crowded desks share hot desks, and a hot desk never becomes a main desk", () => {
  const { layout, seats, block } = crew(MAX_BENCH + 5, 2);
  assert.equal(seats.filter((s) => s.st.hot).length, 10);
  assert.ok(block.stations.filter((s) => s.hot).every((s) => s.seats <= MAX_HOT));
  layout.allocMain("main2", "claude", "Codes", undefined, 0);
  const st = layout.seatOf("main2").st;
  assert.ok(!st.hot, "a new session gets a real desk");
  assert.ok(block.stations.indexOf(st) < block.stations.findIndex((s) => s.hot), "desks before hot desks");
});

test("an empty hot desk is cleared away after a short linger", () => {
  const { layout, block } = crew(MAX_BENCH + 2);
  let now = 10_000;
  for (let i = MAX_BENCH; i < MAX_BENCH + 2; i++) layout.free(`m0-sub${i}`, now);
  for (let t = 0; t < 200; t++) layout.update(16, (now += 16));
  assert.ok(block.stations.some((s) => s.hot), "still lingering");
  for (let t = 0; t < 200; t++) layout.update(16, (now += 16));
  assert.ok(!block.stations.some((s) => s.hot), "gone once it lingered");
});

test("rename keeps the seat: a replacing worker takes over the desk in place", () => {
  const layout = new Layout();
  const seat = layout.allocMain("ctl:ab12", "claude", "api", undefined, 0);
  layout.rename("ctl:ab12", "sess-1");
  assert.equal(layout.seatOf("sess-1"), seat);
  assert.equal(layout.seatOf("ctl:ab12"), undefined);
  assert.equal(seat.st.main, "sess-1");
});

/* ---- the floor plan by screen shape: a phone held upright vs a landscape screen ---- */

/** The owner's phone repro: six sessions in one project, three more one each. */
const HIRES = [["alpha", 6], ["beta", 1], ["gamma", 1], ["ledger", 1]];
/** The free area of a 390x844 phone between the top bar and the toolbar. */
const PHONE = 390 / 528;

function office(pods, aspect, tall, layout = new Layout()) {
  let n = 0;
  for (const [project, desks] of pods) for (let i = 0; i < desks; i++) layout.allocMain(`${project}-${n++}`, "claude", project, undefined, 0);
  return settle(layout, aspect, tall);
}

function settle(layout, aspect, tall) {
  layout.setAspect(aspect, tall);
  for (let t = 0; t < 300; t++) layout.update(16, t * 16);
  return layout;
}

const pod = (layout, project) => [...layout.blocks.values()].find((b) => b.project === project);
const rowsOf = (b) => new Set(b.stations.map((s) => s.oy)).size;
/** How big auto-fit can draw the room in a free area of this shape (relative units). */
const scale = (layout, aspect) => { const r = layout.room(); return Math.min(aspect / (r.w + 20), 1 / (r.h + 20)); };

test("portrait: a pod too wide for the screen wraps its desks into balanced rows", () => {
  const layout = office(HIRES, PHONE, true);
  const alpha = pod(layout, "alpha");
  const rows = rowsOf(alpha);
  assert.ok(rows >= 2, `alpha has ${rows} desk row(s)`);
  assert.equal(alpha.h, POD_H + (rows - 1) * DESK_ROW);
  const perRow = [...new Set(alpha.stations.map((s) => s.oy))].map((oy) => alpha.stations.filter((s) => s.oy === oy).length);
  assert.ok(Math.max(...perRow) - Math.min(...perRow) <= 1, `unbalanced rows ${perRow}`);
  for (const b of ["beta", "gamma", "ledger"].map((p) => pod(layout, p))) assert.equal(b.h, POD_H, `${b.project} stays one row`);
});

test("portrait: every wrapped desk sits on its own rug, in its row, with no desk on another", () => {
  const layout = office(HIRES, PHONE, true);
  const alpha = pod(layout, "alpha");
  const seats = alpha.stations.map((st) => layout.seatOf(st.main));
  for (const s of seats) {
    assert.ok(s.deskX >= alpha.x && s.deskX + DESK_W <= alpha.x + alpha.w, `desk at x ${s.deskX} is off the rug`);
    assert.equal(s.deskY, Math.round(alpha.y + s.st.oy) + DESK_DY, "the desk is in its row");
    assert.equal(s.y, s.deskY + SEAT_DY, "the chair hangs off the desk");
    assert.ok(s.laneY < alpha.y + alpha.h, "the lane to the chair is on the rug");
  }
  for (const a of seats) for (const b of seats) {
    if (a === b || a.deskY !== b.deskY) continue;
    assert.ok(Math.abs(a.deskX - b.deskX) >= DESK_W, `desks at ${a.deskX} and ${b.deskX} overlap`);
  }
});

test("landscape keeps the plan it always had: one row per pod, the wide room", () => {
  const layout = office(HIRES, 1.6, false);
  for (const b of layout.blocks.values()) {
    assert.equal(b.h, POD_H, `${b.project} is one row`);
    assert.ok(b.stations.every((s) => s.oy === 0));
  }
  assert.ok(layout.room().w >= ROOM_MIN_W);
});

test("portrait packing frames the office bigger than the landscape rules would on the same screen", () => {
  const tall = office(HIRES, PHONE, true);
  const wide = office(HIRES, PHONE, false);
  assert.ok(tall.room().w < wide.room().w, `portrait room ${tall.room().w} wide, landscape rules ${wide.room().w}`);
  assert.ok(tall.room().w >= ROOM_MIN_W_TALL);
  assert.ok(scale(tall, PHONE) > scale(wide, PHONE) * 1.15, `portrait ${scale(tall, PHONE)} vs ${scale(wide, PHONE)}`);
});

test("small pods on a phone don't wrap: there is nothing to gain", () => {
  const layout = office([["api", 1], ["web", 2], ["docs", 1]], PHONE, true);
  for (const b of layout.blocks.values()) assert.equal(b.h, POD_H, `${b.project} wrapped`);
});

test("turning the screen re-packs: wrapped desks go back to one row and the seats follow", () => {
  const layout = office(HIRES, PHONE, true);
  assert.ok(pod(layout, "alpha").h > POD_H);
  settle(layout, 1.6, false);
  const alpha = pod(layout, "alpha");
  assert.equal(alpha.h, POD_H);
  for (const st of alpha.stations) {
    const s = layout.seatOf(st.main);
    assert.equal(s.deskY, Math.round(alpha.y) + DESK_DY);
  }
});

/** A camera on a 390x844 phone at 3x, the chrome's top bar and toolbar as insets. */
function phoneCamera() {
  const cam = new Camera();
  Object.assign(cam, { vw: 1170, vh: 2532, dpr: 3 });
  cam.insets = { top: 116, right: 0, bottom: 200, left: 0 };
  return cam;
}
const podSpan = (layout) => {
  const bs = [...layout.blocks.values()];
  return { x0: Math.min(...bs.map((b) => b.tx)) - 26, x1: Math.max(...bs.map((b) => b.tx + b.w)) + 26 };
};

test("auto-fit on a phone rests on a whole zoom and keeps every pod in the free area", () => {
  const cam = phoneCamera();
  const layout = office(HIRES, cam.layoutAspect(), true);
  cam.fit(layout.room(), podSpan(layout));
  assert.ok(Number.isInteger(cam.tz), `zoom ${cam.tz}`);
  for (const b of layout.blocks.values()) {
    const [x0, y0] = cam.toScreen(b.x, b.y);
    const [x1, y1] = cam.toScreen(b.x + b.w, b.y + b.h);
    assert.ok(x0 >= 0 && x1 <= cam.vw, `${b.project} cut at the side: ${x0}..${x1}`);
    assert.ok(y0 >= 116 * 3 && y1 <= cam.vh - 200 * 3, `${b.project} under the chrome: ${y0}..${y1}`);
  }
});

test("drags and pinches stay over the office, and end on a whole zoom", () => {
  const layout = office([["api", 1]], 1, false);
  const room = layout.room();
  const cam = new Camera();
  Object.assign(cam, { vw: 1000, vh: 1000, dpr: 1 });
  cam.bounds = room;
  cam.fit(room);
  assert.equal(cam.tz, 3, "a whole zoom");
  // the whole office in frame: nothing to drag to, the camera stays on auto
  cam.panBy(0, 300);
  assert.equal(cam.mode, "auto");
  // pinch in: manual, and the gesture ends on the next whole zoom it was heading for
  cam.zoomAt(500, 500, 2.5);
  assert.equal(cam.mode, "manual");
  cam.settle(500, 500, 3);
  assert.equal(cam.tz, 8);
  // one small wheel notch still takes a whole step, either way
  cam.zoomAt(500, 500, 1.1);
  cam.settle(500, 500, 8);
  assert.equal(cam.tz, 9);
  cam.zoomAt(500, 500, 0.95);
  cam.settle(500, 500, 9);
  assert.equal(cam.tz, 8);
  // a drag far past the corner stops a few px past the room's edge
  cam.z = cam.tz;
  cam.panBy(-1e5, -1e5);
  const [sx, sy] = cam.toScreen(room.x + room.w, room.y + room.h);
  assert.ok(sx >= cam.vw - 12 - 1e-6 && sy >= cam.vh - 12 - 1e-6, `the room's corner is at ${sx}, ${sy}`);
  // zoomed out past the room it sits centred, wherever the drag goes
  cam.zoomAt(500, 500, 0.01);
  cam.z = cam.tz;
  cam.panBy(400, -250);
  const [cx, cy] = cam.toScreen(room.x + room.w / 2, room.y + room.h / 2);
  assert.ok(Math.abs(cx - 500) < 1e-6 && Math.abs(cy - 500) < 1e-6, `centre at ${cx}, ${cy}`);
});

test("intern summary: counts roles, folds the rest into +N when it doesn't fit", () => {
  const roles = ["fork", "fork", "general-purpose", "fork", "fork"];
  assert.equal(internSummary(roles, 60), "5 interns · fork ×4 · general-purpose");
  assert.equal(internSummary(roles, 24), "5 interns · fork ×4 · +1");
  assert.equal(internSummary(roles, 10), "5 interns · +2");
  assert.equal(internSummary(["Explore", "Plan", "Explore"], 60), "3 interns · Explore ×2 · Plan");
});

test("OfficeEvent.replaces moves a worker, its history and its interns to the new id", () => {
  const m = new OfficeModel();
  m.load({ version: 1, startedAt: "", demo: false, workers: [], recent: [] });
  const base = { ts: new Date().toISOString(), agent: "claude", project: "api" };
  m.apply({ ...base, seq: 1, workerId: "ctl:ab12", kind: "session_start" });
  m.apply({ ...base, seq: 2, workerId: "ctl:ab12", kind: "tool_start", tool: "Read", category: "read", summary: "Read a.ts" });
  m.apply({ ...base, seq: 3, workerId: "sub1", parentId: "ctl:ab12", kind: "subagent_start", role: "Explore" });
  const ch = m.apply({ ...base, seq: 4, workerId: "sess-1", kind: "session_start", replaces: "ctl:ab12" });
  assert.deepEqual(ch.renamed, { from: "ctl:ab12", to: "sess-1" });
  assert.equal(ch.joined, undefined, "no new worker joins");
  assert.equal(m.get("ctl:ab12"), undefined);
  const w = m.get("sess-1");
  assert.equal(w.toolCalls, 1);
  assert.ok(w.history.some((a) => a.summary === "Read a.ts"));
  assert.equal(m.get("sub1").parentId, "sess-1");
  assert.equal(m.workers.size, 2);
});

test("cumulative own usage updates inspector totals without changing pose, duplicating helpers or history",()=>{
  const model=new OfficeModel();model.load({version:1,startedAt:'',demo:false,workers:[],recent:[]});
  let seq=0;const emit=(workerId,kind,extra={})=>model.apply({seq:++seq,ts:new Date().toISOString(),agent:'omp',project:'test',workerId,kind,...extra});
  emit('main','session_start');emit('main','waiting');emit('helper','subagent_start',{parentId:'main'});
  const history=model.get('main').history.length;
  emit('main','usage',{tokenTotal:20_000_000});emit('main','usage',{tokenTotal:20_000_000});emit('helper','usage',{parentId:'main',tokenTotal:350});
  emit('main','usage',{tokenTotal:19_000_000});
  assert.equal(model.get('main').tokens,20_000_000);assert.equal(model.get('main').status,'waiting');assert.equal(model.get('main').history.length,history);
  assert.equal(model.get('helper').tokens,350);assert.equal(model.tokens,20_000_350);assert.equal(model.toolCalls,0);
  emit('main','usage',{tokens:7});assert.equal(model.tokens,20_000_357);
  assert.equal(model.get('main').tokens,20_000_007);
  emit('main','session_end');emit('main','session_start');emit('main','usage',{tokenTotal:20_000_007});
  assert.equal(model.get('main').tokens,20_000_007);assert.equal(model.tokens,20_000_357,'a resumed worker restores its own counter without adding the whole session again');
});

test("control store: sessions arrive by event and are found by their (renamed) worker", () => {
  const store = new ControlStore();
  store.state = "enabled";
  store.info = { enabled: true, agents: [], providers: [], keys: [], service: { supported: false, installed: false, running: false, startAtLogin: false, platform: "x" }, sessions: [], recentFolders: [] };
  const seen = [];
  store.subscribe((what) => seen.push(what));
  const s = { id: "ab12", agent: "claude", place: { kind: "local", target: "/w/api" }, mode: "terminal", workerId: "ctl:ab12", status: "starting", startedAt: new Date().toISOString(), title: "api", permission: "default" };
  store.onEvent("control", s);
  assert.equal(store.forWorker("ctl:ab12")?.id, "ab12");
  store.onEvent("control", { ...s, workerId: "sess-1", status: "running" });
  assert.equal(store.forWorker("ctl:ab12"), undefined);
  assert.equal(store.forWorker("sess-1")?.status, "running");
  store.onEvent("control_info", { keys: [{ name: "K", agents: [], preview: "k…1", addedAt: "" }] });
  assert.equal(store.info.keys.length, 1);
  store.onEvent("control_gone", { id: "ab12" });
  assert.equal(store.sessions.size, 0);
  assert.ok(seen.includes("sessions") && seen.includes("info"));
});

test("control store: a locked or control-less snapshot needs no request", async () => {
  const store = new ControlStore();
  let fetched = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched++; return new Response("{}", { status: 401 }); };
  try {
    await store.fromSnapshot("locked");
    assert.equal(store.state, "locked");
    await store.fromSnapshot("off");
    assert.equal(store.state, "off");
    assert.equal(fetched, 0);
    await store.fromSnapshot(undefined);
    assert.equal(fetched, 1, "absent: probe once");
    assert.equal(store.state, "locked", "a 401 probe locks");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("control store: a primed answer stands for the first snapshot, and a dialog's refresh keeps the sessions events brought", async () => {
  const store = new ControlStore();
  const realFetch = globalThis.fetch;
  let fetched = 0;
  const session = (status) => ({ id: "s1", workerId: "w1", agent: "claude", mode: "terminal", status, title: "app", startedAt: new Date().toISOString(), place: { kind: "local", target: "/w" }, permission: "default" });
  let reply = { enabled: true, agents: [], providers: [], keys: [], sessions: [session("starting")], recentFolders: [], service: {} };
  globalThis.fetch = async () => { fetched++; return new Response(JSON.stringify(reply), { status: 200 }); };
  try {
    await store.refresh();
    assert.equal(store.state, "enabled");
    await store.fromSnapshot("enabled");
    assert.equal(fetched, 1, "the snapshot right after the primed answer doesn't ask again");
    store.onEvent("control", session("running"));
    // an answer computed before that event, as a dialog's refresh might get
    reply = { ...reply, keys: [{ name: "K", agents: [], preview: "k…1", addedAt: "" }], sessions: [session("starting")] };
    await store.refresh({ keepSessions: true });
    assert.equal(store.get("s1").status, "running", "the event's state stays");
    assert.equal(store.info.keys[0].name, "K", "the rest is new");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("control store: a control_info that lands while GET /api/control is out isn't lost to that older answer", async () => {
  const store = new ControlStore();
  const realFetch = globalThis.fetch;
  // The office's state: the agents on PATH first, their versions once the startup probe is done.
  let agents = [{ agent: "claude", installed: true, modes: ["terminal"], keyNames: [] }];
  const answer = () => JSON.stringify({ enabled: true, agents, providers: [], keys: [], sessions: [], recentFolders: [], service: {} });
  let release;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      // assembled now, answered later (it waited on the platforms)
      const body = answer();
      await new Promise((r) => (release = r));
      return new Response(body, { status: 200 });
    }
    return new Response(answer(), { status: 200 });
  };
  try {
    const loading = store.refresh();
    await new Promise((r) => setTimeout(r, 5));
    // meanwhile the probe finishes and /events carries it
    agents = [{ agent: "claude", installed: true, version: "2.1.302", modes: ["terminal"], keyNames: [] }];
    store.onEvent("control_info", { agents });
    release();
    await loading;
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(store.state, "enabled");
    assert.equal(store.info.agents[0].version, "2.1.302", "the probe's versions stay");
  } finally {
    globalThis.fetch = realFetch;
  }
});


test("Docker Sandbox OMP sessions and helpers share one cloud pod per sandbox",()=>{
  const layout=new Layout();
  const first={kind:"docker-sandbox",id:"sandbox-one",name:"Teck.Monorepo"};
  const second={kind:"docker-sandbox",id:"sandbox-two",name:"Other project"};
  layout.allocMain("main-one","omp","Teck.Monorepo",first,0);
  layout.allocMain("main-two","omp","Teck.Monorepo",first,0);
  layout.allocIntern("helper","main-one","omp","Teck.Monorepo",first,0);
  layout.allocMain("other","omp","Other project",second,0);
  assert.equal(layout.blocks.size,2);
  for(const block of layout.blocks.values())assert.equal(block.zone,"cloud");
  assert.equal(layout.blocks.get("host:sandbox-one").host.kind,"docker-sandbox");
  assert.equal(layout.seatOf("helper").kind,"intern");
});


test("late coordinator binding moves its whole native family to the office, retaining Docker host and worker identity",()=>{
  let clock=0;const crew=new Crew(()=>clock);
  const host={kind:"docker-sandbox",id:"sandbox-hierarchy",name:"Teck.Monorepo"};
  const ws=(workerId,extra={})=>({workerId,agent:"omp",project:"Teck.Monorepo",host,status:"thinking",lastTs:new Date().toISOString(),toolCalls:0,tokens:0,filesTouched:0,...extra});
  crew.load({version:1,startedAt:new Date().toISOString(),demo:false,recent:[],workers:[ws("coordinator"),ws("native",{parentId:"coordinator"}),ws("executor",{orchestration:{role:"executor",runId:"run-one",taskId:"task-one",dispatchId:"dispatch-one"},placement:"cloud"})]});
  const original=crew.workers.get("coordinator");
  assert.equal(original.seat.block.zone,"cloud");
  crew.apply({seq:1,ts:new Date().toISOString(),kind:"thinking",workerId:"coordinator",agent:"omp",project:"Teck.Monorepo",host,placement:"office",orchestration:{role:"coordinator",runId:"run-one"}});
  assert.equal(crew.workers.size,3);assert.equal(crew.workers.get("coordinator"),original);
  assert.equal(original.seat.block.zone,"local");assert.equal(original.host.id,host.id);
  assert.equal(crew.workers.get("native").seat.block,original.seat.block);
  assert.equal(crew.workers.get("executor").seat.block.zone,"cloud");
  assert.equal(crew.sameTeam("coordinator","executor"),true);
  assert.equal(crew.sameTeam("coordinator","native"),true);
  assert.equal(crew.sameTeam("coordinator","missing"),false);
  assert.equal([...crew.layout.blocks.values()].flatMap(b=>b.stations).filter(s=>s.main).length,2);
  crew.apply({seq:2,ts:new Date().toISOString(),kind:"thinking",workerId:"coordinator",agent:"omp",project:"Teck.Monorepo",host,placement:"cloud",orchestration:null});
  assert.equal(original.seat.block.zone,"cloud");assert.equal(original.orchestration,null);
  assert.equal(crew.workers.get("native").seat.block,original.seat.block);
  assert.equal(crew.workers.size,3);
});

test("nested native helpers remain on the owning main's bench",()=>{
  const layout=new Layout(),host={kind:"docker-sandbox",id:"nested",name:"Teck.Monorepo"};
  layout.allocMain("coordinator","omp","Teck.Monorepo",host,0,"office");
  const one=layout.allocIntern("helper-one","coordinator","omp","Teck.Monorepo",host,0,"office");
  const two=layout.allocIntern("helper-two","helper-one","omp","Teck.Monorepo",host,0,"office");
  assert.equal(two.kind,"intern");assert.equal(one.block,two.block);assert.equal(two.block.zone,"local");
});


test("out-of-order native helper checkpoints adopt the real parent in snapshots and live events",()=>{
  const crew=new Crew(()=>0),host={kind:"docker-sandbox",id:"out-of-order",name:"Teck.Monorepo"};
  const ws=(workerId,parentId)=>({workerId,parentId,agent:"omp",project:"Teck.Monorepo",host,status:"thinking",lastTs:new Date().toISOString(),toolCalls:0,tokens:0,filesTouched:0,placement:"office",orchestration:{role:"coordinator",runId:"run-order"}});
  crew.load({version:1,startedAt:new Date().toISOString(),demo:false,recent:[],workers:[ws("deep","child"),ws("child","main"),ws("main")]});
  assert.equal(crew.workers.get("deep").seat.kind,"intern");assert.equal(crew.workers.get("child").seat.kind,"intern");
  assert.equal(crew.workers.get("deep").seat.block,crew.workers.get("main").seat.block);
  crew.clear();
  crew.apply({...ws("child","main"),seq:1,ts:new Date().toISOString(),kind:"subagent_start"});
  crew.apply({...ws("main"),seq:2,ts:new Date().toISOString(),kind:"session_start"});
  assert.equal(crew.workers.size,2);assert.equal(crew.workers.get("child").seat.kind,"intern");
  assert.equal(crew.workers.get("child").seat.block,crew.workers.get("main").seat.block);
});


test("idle native descendants inherit a late Run and lose revoked ownership in live folds",()=>{
  const crew=new Crew(()=>0),model=new OfficeModel(),host={kind:"docker-sandbox",id:"late-run",name:"Teck.Monorepo"};
  const event=(workerId,extra={})=>({seq:1,ts:new Date().toISOString(),kind:"session_start",agent:"omp",project:"Teck.Monorepo",host,workerId,...extra});
  const events=[event("main",{orchestration:{role:"coordinator"},placement:"office"}),event("native",{kind:"subagent_start",parentId:"main",orchestration:null,placement:"cloud"}),event("executor",{orchestration:{role:"executor",runId:"run-late",taskId:"task-one",dispatchId:"dispatch-one"},placement:"cloud"})];
  for(const e of events){model.apply(e);crew.apply(e);}
  const bound=event("main",{kind:"thinking",orchestration:{role:"coordinator",runId:"run-late"},placement:"office"});
  model.apply(bound);crew.apply(bound);
  assert.equal(model.get("native").orchestration.runId,"run-late");assert.equal(crew.workers.get("native").orchestration.runId,"run-late");
  assert.equal(crew.sameTeam("executor","native"),true);assert.equal(crew.workers.get("native").seat.block.zone,"local");
  const revoked=event("main",{kind:"thinking",orchestration:null,placement:"cloud"});model.apply(revoked);crew.apply(revoked);
  assert.equal(model.get("native").orchestration,null);assert.equal(crew.workers.get("native").orchestration,null);
  assert.equal(crew.sameTeam("executor","native"),false);
  assert.equal(crew.workers.get("native").seat.block.zone,"cloud");
  crew.apply(event("deep",{kind:"subagent_start",parentId:"native"}));crew.apply(event("main",{kind:"session_end"}));
  assert.equal(crew.workers.get("deep").leaving,true);
});


test('a reusable OMP helper cancels its departure when a new turn starts before the animation ends',()=>{
  let clock=0;const crew=new Crew(()=>clock),host={kind:'docker-sandbox',id:'reuse',name:'Sandbox'};
  const base={seq:1,ts:new Date().toISOString(),agent:'omp',project:'Repo',host,placement:'cloud'};
  crew.apply({...base,kind:'session_start',workerId:'main'});crew.apply({...base,kind:'subagent_start',workerId:'helper',parentId:'main'});
  const first=crew.workers.get('helper');crew.apply({...base,kind:'subagent_end',workerId:'helper',parentId:'main'});assert.equal(first.leaving,true);
  clock=100;crew.apply({...base,kind:'subagent_start',workerId:'helper',parentId:'main'});crew.apply({...base,kind:'thinking',workerId:'helper',parentId:'main'});
  assert.equal(crew.workers.get('helper'),first);assert.equal(first.leaving,false);assert.equal(first.gone,false);assert.equal(first.parentId,'main');assert.equal(crew.workers.size,2);
});
