import type { HostRecord, JobRecord, RegisterHostResponse } from "../types.js";
import { parseIntEnv } from "../util.js";
import { runJob, type HostExecutionConfig } from "./runner.js";

export interface HostDaemonConfig {
  coordinatorUrl: string;
  token?: string;
  hostName: string;
  hostId?: string;
  capabilities: string[];
  maxParallel: number;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  execution: HostExecutionConfig;
}

async function postJson<T>(url: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-skyclaw-token": token } : {})
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

export async function startHostDaemon(config: HostDaemonConfig): Promise<void> {
  const registerRes = await postJson<RegisterHostResponse>(
    `${config.coordinatorUrl}/v1/hosts/register`,
    {
      hostId: config.hostId,
      name: config.hostName,
      capabilities: config.capabilities,
      maxParallel: config.maxParallel
    },
    config.token
  );

  let host: HostRecord = registerRes.host;
  process.stdout.write(`[skyclaw] host registered: ${host.id} (${host.name})\n`);

  setInterval(async () => {
    try {
      const next = await postJson<{ host: HostRecord }>(
        `${config.coordinatorUrl}/v1/hosts/${encodeURIComponent(host.id)}/heartbeat`,
        { activeLeases: host.activeLeases },
        config.token
      );
      host = next.host;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[skyclaw] heartbeat failed: ${msg}\n`);
    }
  }, config.heartbeatIntervalMs).unref();

  for (;;) {
    try {
      const claim = await postJson<{ job: JobRecord | null }>(
        `${config.coordinatorUrl}/v1/hosts/${encodeURIComponent(host.id)}/claim`,
        {},
        config.token
      );

      if (!claim.job) {
        await sleep(config.pollIntervalMs);
        continue;
      }

      host.activeLeases += 1;
      process.stdout.write(`[skyclaw] running ${claim.job.id} (${claim.job.payload.kind})\n`);
      const result = await runJob(claim.job.payload, config.execution);

      await postJson(
        `${config.coordinatorUrl}/v1/jobs/${encodeURIComponent(claim.job.id)}/complete`,
        {
          hostId: host.id,
          success: result.success,
          durationMs: result.durationMs,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          error: result.error
        },
        config.token
      );

      if (host.activeLeases > 0) {
        host.activeLeases -= 1;
      }
      const status = result.success ? "ok" : "failed";
      process.stdout.write(`[skyclaw] completed ${claim.job.id}: ${status}\n`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[skyclaw] worker loop error: ${msg}\n`);
      await sleep(config.pollIntervalMs);
    }
  }
}

export function hostConfigFromEnv(): HostDaemonConfig {
  const coordinatorUrl = process.env.SKYCLAW_COORDINATOR_URL || "http://127.0.0.1:8787";
  const token = process.env.SKYCLAW_TOKEN;
  const hostName = process.env.SKYCLAW_HOST_NAME || `openclaw-${process.pid}`;
  const hostId = process.env.SKYCLAW_HOST_ID;
  const capabilities = (process.env.SKYCLAW_CAPABILITIES || "shell,automaton")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const allowedCommands = (process.env.SKYCLAW_ALLOWED_COMMANDS || "automaton,node,bash,sh")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  return {
    coordinatorUrl,
    token,
    hostName,
    hostId,
    capabilities,
    maxParallel: parseIntEnv("SKYCLAW_MAX_PARALLEL", 1),
    pollIntervalMs: parseIntEnv("SKYCLAW_POLL_MS", 2_000),
    heartbeatIntervalMs: parseIntEnv("SKYCLAW_HEARTBEAT_MS", 5_000),
    execution: {
      allowedCommands,
      defaultTimeoutMs: parseIntEnv("SKYCLAW_TIMEOUT_MS", 300_000),
      maxOutputBytes: parseIntEnv("SKYCLAW_MAX_OUTPUT_BYTES", 128_000),
      automatonCommand: process.env.SKYCLAW_AUTOMATON_COMMAND || "automaton"
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
