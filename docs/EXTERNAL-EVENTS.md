# External observer integration (Teck fork)

This is the Teck-Lab fork. OMP and Docker Sandboxes are observer integrations; Orca owns agent execution and sandbox lifecycle. Upstream attribution and licensing are retained.

Start the normal browser/server with --external-only --external-config /private/ingest.json --no-control --no-cloud --no-open. External-only mode skips local transcript discovery and cloud login discovery. The service binds to loopback; the producer endpoint is refused with a non-loopback listener. An optional --parent-pid stops the service when its owning desktop exits.

The private configuration is {"version":1,"sources":{"SANDBOX-ID":{"token":"64 lowercase hex characters","project":"Teck.Monorepo","host":{"kind":"docker-sandbox","id":"SANDBOX-ID","name":"sandbox-name"}}}}. Replace the example token with a generated credential. Configuration is reread for every request, so removing a source or rotating its token takes effect immediately. Never commit this file.

POST /api/ingest accepts Authorization: Bearer TOKEN and application/json. The version-1 body contains sourceId, events (at most 100) and optional heartbeat (worker IDs). Each event has eventId (stable across retries), ts (ISO timestamp within two minutes), agent, workerId, kind, and optional parentId, tool, category, summary, model, role, isError. Agents include omp. Event kinds follow src/shared/events.ts; sanitized native Office status, shout, celebrate and flip signals are accepted for observed workers. Control events are excluded.

The server owns project and host metadata and prefixes worker/parent identifiers per source. Unknown fields (including prompts, arguments, results and cwd) are discarded. Use metadata-only summaries. Duplicate event IDs are ignored within the bounded retry window. Heartbeats preserve an existing observed state without adding tool calls. A producer missing for 60 seconds is retired. The 202 response includes missing worker IDs: after a server restart, replay a session-start and the latest observed state for those workers. IDs are stable across reconnects; a new backend has a fresh activity history.

No browser Origin/Sec-Fetch-Site is accepted. Batches are limited to 64 KiB and validated before any event is applied. This credential grants ingestion only, never terminal, approval, key or sandbox control. The ordinary office stays unchanged unless external ingestion is explicitly enabled.

For the local Teck setup, Orca starts one host service and opens a reverse SSH tunnel per owned running Docker Sandbox: a fresh guest loopback port, recorded in /etc/teck-orca/office.json, forwards to the host service. The OMP extension posts to that loopback endpoint; no host LAN listener, inbound firewall opening, cloud service or sandbox credentials for other services are required. With OMP 18.16.0, existing sessions must be reopened/resumed to load a newly installed extension; /reload-plugins does not reload extension code.

## Orca coordination layout

The observer reads the role guard's `teck-orca-contract` session entry rather than guessing from prompts or model names. Optional `orchestration` metadata carries a bounded role, Run ID, Task ID, Dispatch ID and GitHub issue URL. Worker roles require all three lifecycle IDs. A coordinator's Run ID is supplied from its confirmed run-create receipt. `orchestration: null` clears a revoked or unbound role. These fields describe ownership; they grant no execution privileges.

The server derives rendering `placement`: coordinators and their native task helpers sit in the office; dispatched workers and their native helpers sit in the sandbox's cloud pod. The real Docker Sandbox `host` remains on every event, snapshot and inspector card. Caller-provided placement cannot override that derivation. Native `parentId` links stay separate from Orca Run/Task/Dispatch relationships, so a dispatched executor is a main desk rather than a native intern.

Late role binding moves an existing native family between rooms without replacing worker IDs or duplicating desks. Nested task helpers share the owning main's bench. Selecting a worker highlights native family members and other dispatched workers with the same confirmed Run ID. The inspector shows the role and lifecycle IDs alongside the real host.

Native task subagents have documented lifecycle events and are represented independently. Built-in advisors do not expose an equivalent public start/end lifecycle in the tested OMP version; advisory work remains attributed to its owning session rather than inventing advisor lifetimes.

## Native Office MCP signals and usage

The authenticated event stream also accepts `status`, `shout`, `celebrate`,
`flip` and `usage`. Signals apply to an already observed worker and preserve
its activity pose. A status uses `summary` for its public status text and `tool`
for an optional emoji mood. Signal summaries are scrubbed again on ingestion.

For OMP, the sandbox adapter runs Agent Office's native stdio MCP implementation.
The native handlers own the five tool definitions, text scrubbing, mood parsing
and cooldowns. Successful calls return an intentional public structured signal;
the OMP observer associates that signal with the actual calling session/helper
and forwards it over this authenticated stream. Arbitrary prompts, tool arguments
and tool output are not used as signal data.

`tokens` remains an additive per-event delta for existing producers. New OMP
producers use nonnegative safe-integer `tokenTotal`, a cumulative total of that
agent's own finalized assistant usage. A `usage` event updates counters without
changing activity. Resending the same or a lower total does not add tokens.
Attach the latest total to lifecycle/reconnect snapshots too. Parent/helper
ledgers stay separate; parent task-result aggregates are excluded.

An authenticated batch can set `wantSnapshot: true` with `events: []` to obtain
a `snapshot` alongside its ordinary receipt. This supports `office_peers` through
the existing tunnel. It contains only workers and recent events whose server-owned
Docker Sandbox host ID exactly matches the authenticated source, and exposes no
control settings or other projects. Snapshot reads do not fabricate activity.


## Read-only native goal/task whiteboard

OMP producers may send kind "plan" with "plan: {goal, phases}". Goal is
null or {id, objective, status}; statuses are active, paused, complete,
dropped and budget-limited. Phases contain a name and tasks with content,
status (pending/in_progress/completed/abandoned/blocked) and an optional blocker.
Unknown fields are discarded, credential-like text is redacted, labels are
capped, and the preview is limited to 12 phases, 60 tasks and 24 KiB. An explicit
truncated flag tells the viewer that OMP retains more. Null clears a plan.

Each worker owns its own plan; native helpers do not inherit their parent's
goal/todos. Plan events preserve the last activity, pose, tool counts and
completion status. Snapshots carry plans so browser reconnects work. A physical
pixel whiteboard opens the same read-only sheet as the Whiteboard button or B.
Multiple coordinators have separate boards. Connected assignments are grouped
only by equal Orca Run and sandbox host, never by project name alone. The sheet
shows session activity and native goal state separately; it does not claim that
a waiting turn is a completed Orca Task or close any GitHub issue.

This opt-in metadata includes sanitized goal/task titles and blocker notes,
unlike the activity-only observer. Prompts, tool arguments, output, files and
credentials are not part of the plan schema. The integration adds no agent-control
endpoint or additional MCP and continues using the authenticated loopback tunnel.


## Reusable helper seats

OMP can keep a completed helper idle/parked for later reuse. Producers should
send subagent_end when that helper's turn settles terminally, stop its presence
heartbeats, and send subagent_start on the same identity if it receives new work.
This is a presentation lifecycle; it must not cancel or release the native helper.
Nonterminal waits may use the summaries "Awaiting approval", "Awaiting helper work"
or "Awaiting continuation" to retain their seats.

For older producers, plain waiting helpers leave after 60 seconds without actual
activity. Their quiet heartbeats are acknowledged without respawning the seat;
real new activity makes the helper return. Metadata updates do not wake it.
Parents supervising busy descendants remain visible, as do top-level sessions.
Reconnect snapshots exclude helpers already departing. Fast reuse cancels the
old departure animation, keeping the same native parent and worker identity.


## Explicit meeting room

The meeting area is left of the elevator, with the same curtain windows used by
the cloud area. Matching steel/glass side partitions and a shallow front rail
enclose it, with a doorway toward the office. The table runs horizontally, with eight office chairs along its two long sides. The native OMP
goal/task whiteboard is integrated into the existing TV: goal, current task,
progress and counters fit the screen, while announcements retain their full-screen
and ticker behavior. Click the TV, meeting area or Meeting room button to open the
full native plan and agenda. A selector switches between simultaneous meetings.

The identity-aware OMP MCP adapter exposes office_meeting with list, start, join,
update, leave and end. Actions are delivered as a structured result to the owning
observer, which publishes a meeting event with nativeKind=main. The server requires
an existing, live main-session record with the same exact worker id and source.
Subagents, including orphan helpers, cannot participate. The tool accepts no target
worker or participants argument; other main sessions explicitly join themselves.
Only the host updates or ends a meeting. Its session ending also ends the meeting;
departing guests are removed. A main session can host one meeting, a source can
have four meetings, and each session can attend one. Meeting ids are source-scoped.

Snapshots include meetings; accepted meeting/end events carry the current list for
SSE clients. Source-scoped MCP snapshots reveal only that source's meetings. Replay
deduplication applies before meeting actions. Meeting title, agenda and decision
are short, scrubbed public text. A queued MCP request is not attendance proof:
list reads back accepted membership. The standalone generic MCP reports that an
identity-aware adapter is required for actions instead of guessing a session by cwd.

Meeting positions are presentation only: real execution host, desk allocation,
subagent seats, task state, goals and Orca coordination remain unchanged. Native
helpers keep the other Office tools. A meeting adds no dispatch or completion gate.

The table reuses the existing OMP office chair renderer, rotated to face inward.
The room fits the smallest office floor. Its windows share geometry and drawing
code with the native cloud window wall, rather than maintaining a second style.


## Read-only office presentation

The Appearance button changes browser-local visual preferences only. It does not
invoke control APIs or instruct Orca/OMP. The default sky follows the viewer’s local
clock; daylight, dusk and night can be previewed. Weather is decorative, with clear,
rain and date-based options, not a live weather feed.

Room colours, oak/walnut meeting furniture, horizontal/vertical seating, character
accessories, decoration density, task labels, ambient life, movement, team lines
and celebrations are configurable and resettable. Reduced-motion preference is
respected on first use. Layout changes preserve execution hosts, session IDs and
actual worktrees. The existing office remains a view of external activity.

Native helpers stay with their parents. Orca Runs get separate pods per host and
project; colours and hover lines show their ownership. Activity labels distinguish
reported implementation/research/review, human attention, blocked/paused native plans,
completed goals and idle coordinators whose team remains present (Team present).
Idle is never treated as completed. Task labels and hover details use the existing
bounded, redacted plan/assignment feed, not new transcript access.

Main sessions walk through the meeting doorway and around the table, then return
to their original desks; helpers remain at work. Meeting speech/gestures follow
recent reply/shout events, not simulated conversation or audio. Goal completion
celebrates once per observed transition, without replaying on reconnect. Explicit
celebration and test-pass events remain supported; a review approval is not inferred
from silence or a finished turn. Idle coffee poses and the wandering cat are ambient
visuals, not changes to agent state.

Team present means linked sessions remain visible; it is not proof that they are
currently executing a turn. Execution is shown from their individual activity.


## Handoffs, seasons and observer health

Appearance adds northern/southern calendar seasons or a fixed spring, summer,
autumn or winter preview. Window-clipped trees, blossoms, leaves and snow are
decorative. Still scenery remains with reduced motion. Personal desk accents,
short role/identity plates and pixel pictures are stable per session across
reconnects and desk moves; unrelated sessions are not treated as the same person.
Handoffs and personal desks have separate browser-local toggles.

Cosmetic handoffs follow observed assignments, native helper starts/ends and
native goal completion. A unique coordinator is resolved by exact host/project/
Run; ambiguous ownership is skipped. Helper end does not imply success; an
ordinary reply does not imply delivery to a coordinator. Reconnect snapshots
seed the replay guard without replaying transfers. Buffers are bounded and no
control operation is sent.

Browser feed loss freezes/dims last-known workers, blanks their screens and
shows a banner until a fresh snapshot arrives. Independently, the external
observer ingest tracks valid authenticated source packets. Over 60 seconds
without a packet emits a server-owned host_status event with hostStatus and
records the state in Snapshot.hosts. This means observer connectivity is lost,
not that the sandbox is stopped. Idle sessions with heartbeats stay online.
Existing stale-session cleanup still applies; source health stays offline until
a valid packet arrives. Repeated heartbeats do not produce activity or status
spam. Producers cannot submit host_status or impersonate another source's health.
Source-scoped snapshots filter health records as well as workers and meetings.

Validation: full isolated Linux suite 553 passed, 2 skipped; final focused suite
73 passed including renderer bounds/clipping; plugin suite 283 passed. Production
build, typecheck, served asset hash and live observer status verified. No visual
browser inspection was performed.
