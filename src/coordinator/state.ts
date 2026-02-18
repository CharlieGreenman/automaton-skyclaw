import type {
  ClaimJobResponse,
  CompleteJobRequest,
  CoordinatorSnapshot,
  EnqueueJobRequest,
  HostRecord,
  JobRecord,
  RegisterHostRequest
} from "../types.js";
import { CoordinatorStorage } from "./storage.js";
import { hasCapabilities, makeId, normalizeCapabilities, nowIso } from "../util.js";

export interface CoordinatorStateOptions {
  leaseMs?: number;
  dbPath?: string;
}

export class CoordinatorState {
  private readonly hosts = new Map<string, HostRecord>();
  private readonly jobs = new Map<string, JobRecord>();
  private readonly leaseMs: number;
  private readonly storage?: CoordinatorStorage;

  constructor(options: CoordinatorStateOptions = {}) {
    this.leaseMs = options.leaseMs ?? 60_000;
    if (options.dbPath) {
      this.storage = new CoordinatorStorage(options.dbPath);
      for (const host of this.storage.loadHosts()) {
        this.hosts.set(host.id, host);
      }
      for (const job of this.storage.loadJobs()) {
        this.jobs.set(job.id, job);
      }
    }
  }

  registerHost(input: RegisterHostRequest): HostRecord {
    const id = input.hostId?.trim() || makeId("host");
    const existing = this.hosts.get(id);
    const now = nowIso();
    const host: HostRecord = {
      id,
      name: input.name.trim(),
      capabilities: normalizeCapabilities(input.capabilities),
      maxParallel: Math.max(1, input.maxParallel ?? 1),
      activeLeases: existing?.activeLeases ?? 0,
      lastSeenAt: now,
      registeredAt: existing?.registeredAt ?? now
    };
    this.hosts.set(id, host);
    this.storage?.saveHost(host);
    return host;
  }

  heartbeat(hostId: string, activeLeases?: number): HostRecord {
    const host = this.hosts.get(hostId);
    if (!host) {
      throw new Error(`unknown host: ${hostId}`);
    }
    host.lastSeenAt = nowIso();
    if (typeof activeLeases === "number" && Number.isFinite(activeLeases) && activeLeases >= 0) {
      host.activeLeases = activeLeases;
    }
    this.storage?.saveHost(host);
    return host;
  }

  enqueueJob(input: EnqueueJobRequest): JobRecord {
    const now = nowIso();
    const record: JobRecord = {
      id: makeId("job"),
      createdAt: now,
      updatedAt: now,
      status: "queued",
      attempts: 0,
      requirement: {
        requiredCapabilities: normalizeCapabilities(input.requirement?.requiredCapabilities)
      },
      payload: input.payload
    };
    this.jobs.set(record.id, record);
    this.storage?.saveJob(record);
    return record;
  }

  claimJob(hostId: string): ClaimJobResponse {
    this.requeueExpiredLeases();
    const host = this.hosts.get(hostId);
    if (!host) {
      throw new Error(`unknown host: ${hostId}`);
    }
    if (host.activeLeases >= host.maxParallel) {
      return { job: null };
    }

    const queued = [...this.jobs.values()]
      .filter((job) => job.status === "queued")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const next = queued.find((job) =>
      hasCapabilities(host.capabilities, job.requirement.requiredCapabilities)
    );

    if (!next) {
      return { job: null };
    }

    const now = nowIso();
    next.status = "leased";
    next.attempts += 1;
    next.assignedHostId = hostId;
    next.updatedAt = now;
    next.leaseExpiresAt = new Date(Date.now() + this.leaseMs).toISOString();
    host.activeLeases += 1;
    this.storage?.saveHost(host);
    this.storage?.saveJob(next);

    return { job: structuredClone(next) };
  }

  completeJob(jobId: string, input: CompleteJobRequest): JobRecord {
    const host = this.hosts.get(input.hostId);
    if (!host) {
      throw new Error(`unknown host: ${input.hostId}`);
    }
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`unknown job: ${jobId}`);
    }
    if (job.assignedHostId !== input.hostId) {
      throw new Error(`job ${jobId} is assigned to ${job.assignedHostId ?? "nobody"}`);
    }
    if (job.status !== "leased") {
      throw new Error(`job ${jobId} is not leased`);
    }

    job.status = input.success ? "completed" : "failed";
    job.updatedAt = nowIso();
    job.result = {
      finishedAt: job.updatedAt,
      durationMs: input.durationMs,
      exitCode: input.exitCode,
      stdout: input.stdout,
      stderr: input.stderr
    };
    job.error = input.error;
    job.leaseExpiresAt = undefined;

    if (host.activeLeases > 0) {
      host.activeLeases -= 1;
    }
    this.storage?.saveHost(host);
    this.storage?.saveJob(job);

    return structuredClone(job);
  }

  requeueExpiredLeases(): number {
    const now = Date.now();
    let requeued = 0;
    for (const job of this.jobs.values()) {
      if (job.status !== "leased" || !job.leaseExpiresAt) {
        continue;
      }
      if (new Date(job.leaseExpiresAt).getTime() > now) {
        continue;
      }
      const host = job.assignedHostId ? this.hosts.get(job.assignedHostId) : undefined;
      if (host && host.activeLeases > 0) {
        host.activeLeases -= 1;
        this.storage?.saveHost(host);
      }
      job.status = "queued";
      job.assignedHostId = undefined;
      job.leaseExpiresAt = undefined;
      job.updatedAt = nowIso();
      this.storage?.saveJob(job);
      requeued += 1;
    }
    return requeued;
  }

  snapshot(): CoordinatorSnapshot {
    this.requeueExpiredLeases();
    return {
      hosts: [...this.hosts.values()].map((host) => structuredClone(host)),
      jobs: [...this.jobs.values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((job) => structuredClone(job))
    };
  }
}
