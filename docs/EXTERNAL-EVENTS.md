# External observer integration (Teck fork)

This is the Teck-Lab fork. OMP and Docker Sandboxes are observer integrations; Orca owns agent execution and sandbox lifecycle. Upstream attribution and licensing are retained.

Start the normal browser/server with --external-only --external-config /private/ingest.json --no-control --no-cloud --no-open. External-only mode skips local transcript discovery and cloud login discovery. The service binds to loopback; the producer endpoint is refused with a non-loopback listener. An optional --parent-pid stops the service when its owning desktop exits.

The private configuration is {"version":1,"sources":{"SANDBOX-ID":{"token":"64 lowercase hex characters","project":"Teck.Monorepo","host":{"kind":"docker-sandbox","id":"SANDBOX-ID","name":"sandbox-name"}}}}. Replace the example token with a generated credential. Configuration is reread for every request, so removing a source or rotating its token takes effect immediately. Never commit this file.

POST /api/ingest accepts Authorization: Bearer TOKEN and application/json. The version-1 body contains sourceId, events (at most 100) and optional heartbeat (worker IDs). Each event has eventId (stable across retries), ts (ISO timestamp within two minutes), agent, workerId, kind, and optional parentId, tool, category, summary, model, role, isError. Agents include omp. Event kinds follow src/shared/events.ts; self-authored status/shout/control events are excluded from this ingestion route.

The server owns project and host metadata and prefixes worker/parent identifiers per source. Unknown fields (including prompts, arguments, results and cwd) are discarded. Use metadata-only summaries. Duplicate event IDs are ignored within the bounded retry window. Heartbeats preserve an existing observed state without adding tool calls. A producer missing for 60 seconds is retired. The 202 response includes missing worker IDs: after a server restart, replay a session-start and the latest observed state for those workers. IDs are stable across reconnects; a new backend has a fresh activity history.

No browser Origin/Sec-Fetch-Site is accepted. Batches are limited to 64 KiB and validated before any event is applied. This credential grants ingestion only, never terminal, approval, key or sandbox control. The ordinary office stays unchanged unless external ingestion is explicitly enabled.

For the local Teck setup, Orca starts one host service and opens a reverse SSH tunnel per owned running Docker Sandbox: a fresh guest loopback port, recorded in /etc/teck-orca/office.json, forwards to the host service. The OMP extension posts to that loopback endpoint; no host LAN listener, inbound firewall opening, cloud service or sandbox credentials for other services are required. With OMP 18.16.0, existing sessions must be reopened/resumed to load a newly installed extension; /reload-plugins does not reload extension code.

## Orca coordination layout

The observer reads the role guard's `teck-orca-contract` session entry rather than guessing from prompts or model names. Optional `orchestration` metadata carries a bounded role, Run ID, Task ID, Dispatch ID and GitHub issue URL. Worker roles require all three lifecycle IDs. A coordinator's Run ID is supplied from its confirmed run-create receipt. `orchestration: null` clears a revoked or unbound role. These fields describe ownership; they grant no execution privileges.

The server derives rendering `placement`: coordinators and their native task helpers sit in the office; dispatched workers and their native helpers sit in the sandbox's cloud pod. The real Docker Sandbox `host` remains on every event, snapshot and inspector card. Caller-provided placement cannot override that derivation. Native `parentId` links stay separate from Orca Run/Task/Dispatch relationships, so a dispatched executor is a main desk rather than a native intern.

Late role binding moves an existing native family between rooms without replacing worker IDs or duplicating desks. Nested task helpers share the owning main's bench. Selecting a worker highlights native family members and other dispatched workers with the same confirmed Run ID. The inspector shows the role and lifecycle IDs alongside the real host.

Native task subagents have documented lifecycle events and are represented independently. Built-in advisors do not expose an equivalent public start/end lifecycle in the tested OMP version; advisory work remains attributed to its owning session rather than inventing advisor lifetimes.
