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
node dist/cli.js coordinator
```

3. Start a host on an OpenClaw machine:

```bash
export SKYCLAW_COORDINATOR_URL=http://127.0.0.1:8787
export SKYCLAW_TOKEN=change-me
export SKYCLAW_CAPABILITIES=shell,automaton
export SKYCLAW_ALLOWED_COMMANDS=automaton,node,bash,sh
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

## API surface

- `POST /v1/hosts/register`
- `POST /v1/hosts/:id/heartbeat`
- `POST /v1/hosts/:id/claim`
- `POST /v1/jobs`
- `POST /v1/jobs/:id/complete`
- `GET /v1/state`
- `GET /health`

## Next integration steps

- Add signed host identities instead of shared token.
- Persist queue state (SQLite/Postgres) and add multi-coordinator replication.
- Integrate OpenClaw gateway auth/profile metadata into host registration.
- Add payment settlement and proof-of-execution receipts.
