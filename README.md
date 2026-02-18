# Skyclaw

Skyclaw is a lightweight bridge that lets people with an OpenClaw host opt into running Automaton compute jobs.

It provides:
- A coordinator API for host registration, heartbeats, and job queueing.
- A host daemon that runs on OpenClaw machines, claims jobs, and executes them.
- A small CLI to enqueue shell or automaton jobs.

## Why this repo exists

- `automaton`: autonomous agent runtime that needs paid compute.
- `openclaw`: personal AI host/control plane people already run.
- `skyclaw`: the glue that turns OpenClaw hosts into opt-in Automaton workers.

## Quick start

1. Install deps and build:

```bash
npm install
npm run build
```

2. Start the coordinator:

```bash
export SKYCLAW_TOKEN=change-me
export SKYCLAW_COORDINATOR_NODE_ID=node-a
export SKYCLAW_PEER_URLS=http://127.0.0.1:8788,http://127.0.0.1:8789
node dist/cli.js coordinator
```

3. Start a host on an OpenClaw machine:

```bash
export SKYCLAW_COORDINATOR_URL=http://127.0.0.1:8787
export SKYCLAW_COORDINATOR_URLS=http://127.0.0.1:8787,http://127.0.0.1:8788,http://127.0.0.1:8789
export SKYCLAW_TOKEN=change-me
export SKYCLAW_CAPABILITIES=shell,automaton
export SKYCLAW_ALLOWED_COMMANDS=automaton,node,bash,sh
export SKYCLAW_DB_PATH=.skyclaw/coordinator.db
node dist/cli.js host
```

4. Enqueue compute:

```bash
# generic shell job
node dist/cli.js enqueue-shell bash -lc "echo hello from skyclaw"

# automaton run job
node dist/cli.js enqueue-automaton --run
```

## Job model

- `shell`: run an explicit command/args.
- `automaton-run`: mapped by host daemon to `SKYCLAW_AUTOMATON_COMMAND` (default: `automaton`).

Jobs can request capabilities (`shell`, `automaton`, etc). Hosts only claim jobs they can satisfy.

## Security model (MVP)

- Shared token auth via `x-skyclaw-token`.
- Host-local command allowlist (`SKYCLAW_ALLOWED_COMMANDS`).
- Per-job timeout (`SKYCLAW_TIMEOUT_MS` fallback).
- Output truncation (`SKYCLAW_MAX_OUTPUT_BYTES`).

## Durability and failures

- Coordinator state is persisted in SQLite (`SKYCLAW_DB_PATH`, default `.skyclaw/coordinator.db`).
- If the coordinator process crashes and restarts on the same machine/disk, hosts/jobs are reloaded.
- Expired leases are re-queued automatically after restart.
- Multi-node replication is supported via peer coordinators (`SKYCLAW_PEER_URLS`) and periodic sync.
- Hosts/clients can fail over across coordinators via `SKYCLAW_COORDINATOR_URLS`.
- If one coordinator node goes down, another node can continue scheduling from replicated state.
- If all coordinator disks are lost, state is lost.

## Multi-node setup

- Run 2+ coordinators with unique `SKYCLAW_COORDINATOR_NODE_ID`.
- Give each coordinator its own SQLite file (`SKYCLAW_DB_PATH`).
- Configure each coordinator with the others in `SKYCLAW_PEER_URLS`.
- Point hosts and enqueuers at all coordinators using `SKYCLAW_COORDINATOR_URLS`.
- Keep one shared `SKYCLAW_TOKEN` across the coordinator cluster.

## API surface

- `POST /v1/hosts/register`
- `POST /v1/hosts/:id/heartbeat`
- `POST /v1/hosts/:id/claim`
- `POST /v1/jobs`
- `POST /v1/jobs/:id/complete`
- `POST /v1/replicate/snapshot`
- `GET /v1/state`
- `GET /health`

## Next integration steps

- Add signed host identities instead of shared token.
- Replace full-snapshot replication with incremental log shipping.
- Integrate OpenClaw gateway auth/profile metadata into host registration.
- Add payment settlement and proof-of-execution receipts.
