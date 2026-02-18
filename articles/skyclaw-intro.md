# Introducing Skyclaw: Turning Your AI Host Into Distributed Compute

## Thread

Ever wondered what happens when autonomous AI agents need compute power, but don't want to spin up expensive cloud infrastructure?

Enter Skyclaw - a lightweight bridge that transforms OpenClaw hosts into opt-in compute workers for Automaton workloads.

---

Here's the problem: Automaton is an autonomous agent runtime that needs paid compute. OpenClaw is a personal AI host/control plane that people already run on their machines.

Skyclaw is the elegant glue that connects them.

---

Think of it like this:

You're already running OpenClaw on your machine. With Skyclaw, you can opt-in to share spare compute capacity with Automaton jobs. When you're not using it, why let it sit idle?

---

The architecture is beautifully simple:

**Automaton (Client)** → Submits compute jobs
**Skyclaw Coordinator** → Central job queue & orchestrator
**OpenClaw Host (Worker)** → Executes jobs on local machines

Three components. One seamless flow.

---

Here's how it works:

1. Automaton enqueues a job to the coordinator
2. OpenClaw hosts register with the coordinator and maintain heartbeats
3. Hosts claim jobs they can handle
4. Jobs get executed (shell commands or automaton workloads)
5. Results flow back through the coordinator to Automaton

---

What makes this interesting:

- Jobs can be simple shell commands OR complex automaton workloads
- Hosts only claim jobs they have capabilities for
- Multi-node replication ensures durability
- Built on SQLite for persistence
- Shared token auth with host-local command allowlists for security

---

The durability model is clever:

Coordinator state persists in SQLite. If it crashes and restarts, hosts and jobs are reloaded. Expired leases get re-queued automatically.

Multi-node? Each coordinator replicates to peers. If one goes down, another continues scheduling.

---

Security in the MVP:

- Shared token authentication
- Host-local command allowlist (you control what can run)
- Per-job timeout controls
- Output truncation to prevent abuse

You opt-in. You control what runs. You decide.

---

Want to try it?

```bash
npm install -g @razroo/skyclaw

# Start coordinator
skyclaw coordinator

# Register as a host
skyclaw host

# Enqueue a job
skyclaw enqueue-shell bash -lc "echo hello from skyclaw"
```

That's it. Three commands to join the network.

---

What's next for Skyclaw?

- Signed host identities (moving beyond shared tokens)
- Incremental log shipping (replacing full-snapshot replication)
- OpenClaw gateway auth integration
- Payment settlement & proof-of-execution receipts

The foundation is built. Now comes the evolution.

---

Why this matters:

We're moving toward a world where AI agents need compute, and compute is increasingly distributed. Skyclaw shows one way to bridge personal AI infrastructure with autonomous workloads.

It's opt-in. It's lightweight. It's already working.

---

Built by @Razroo as part of the Automaton/OpenClaw ecosystem.

Open source. Ready to use. Waiting for your compute.

Check it out: https://github.com/razroo/automaton-skyclaw
