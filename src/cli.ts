#!/usr/bin/env node
import { startCoordinatorServer } from "./coordinator/server.js";
import { hostConfigFromEnv, startHostDaemon } from "./host/daemon.js";
import { parseIntEnv } from "./util.js";

function printHelp(): void {
  process.stdout.write(`skyclaw - OpenClaw <> Automaton compute bridge\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  skyclaw coordinator\n`);
  process.stdout.write(`  skyclaw host\n`);
  process.stdout.write(`  skyclaw enqueue-shell <command> [args...]\n`);
  process.stdout.write(`  skyclaw enqueue-automaton [automaton args...]\n`);
  process.stdout.write(`\nEnvironment:\n`);
  process.stdout.write(`  SKYCLAW_COORDINATOR_URL=http://127.0.0.1:8787\n`);
  process.stdout.write(`  SKYCLAW_TOKEN=<shared-token>\n`);
  process.stdout.write(`  SKYCLAW_ALLOWED_COMMANDS=automaton,node,bash,sh\n`);
}

async function postJson(url: string, body: unknown, token?: string): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-skyclaw-token": token } : {})
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`request failed (${response.status}): ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "-h" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "coordinator") {
    await startCoordinatorServer({
      port: parseIntEnv("SKYCLAW_COORDINATOR_PORT", 8787),
      host: process.env.SKYCLAW_COORDINATOR_HOST || "0.0.0.0",
      authToken: process.env.SKYCLAW_TOKEN,
      leaseMs: parseIntEnv("SKYCLAW_LEASE_MS", 60_000)
    });
    return;
  }

  if (command === "host") {
    await startHostDaemon(hostConfigFromEnv());
    return;
  }

  const coordinatorUrl = process.env.SKYCLAW_COORDINATOR_URL || "http://127.0.0.1:8787";
  const token = process.env.SKYCLAW_TOKEN;

  if (command === "enqueue-shell") {
    const [shellCommand, ...shellArgs] = args;
    if (!shellCommand) {
      throw new Error("enqueue-shell requires a command");
    }
    const response = await postJson(
      `${coordinatorUrl}/v1/jobs`,
      {
        payload: {
          kind: "shell",
          command: shellCommand,
          args: shellArgs
        },
        requirement: {
          requiredCapabilities: ["shell"]
        }
      },
      token
    );
    process.stdout.write(`${response.job.id}\n`);
    return;
  }

  if (command === "enqueue-automaton") {
    const response = await postJson(
      `${coordinatorUrl}/v1/jobs`,
      {
        payload: {
          kind: "automaton-run",
          args
        },
        requirement: {
          requiredCapabilities: ["automaton"]
        }
      },
      token
    );
    process.stdout.write(`${response.job.id}\n`);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[skyclaw] ${msg}\n`);
  process.exitCode = 1;
});
