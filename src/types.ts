export type JobStatus = "queued" | "leased" | "completed" | "failed";

export interface JobRequirement {
  requiredCapabilities?: string[];
}

export interface ShellJobPayload {
  kind: "shell";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface AutomatonRunJobPayload {
  kind: "automaton-run";
  args?: string[];
  automatonDir?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export type JobPayload = ShellJobPayload | AutomatonRunJobPayload;

export interface JobRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  attempts: number;
  leaseExpiresAt?: string;
  assignedHostId?: string;
  requirement: JobRequirement;
  payload: JobPayload;
  result?: {
    finishedAt: string;
    durationMs: number;
    exitCode: number;
    stdout: string;
    stderr: string;
  };
  error?: string;
}

export interface HostRecord {
  id: string;
  name: string;
  capabilities: string[];
  maxParallel: number;
  activeLeases: number;
  lastSeenAt: string;
  registeredAt: string;
}

export interface RegisterHostRequest {
  hostId?: string;
  name: string;
  capabilities?: string[];
  maxParallel?: number;
}

export interface RegisterHostResponse {
  host: HostRecord;
}

export interface HeartbeatRequest {
  activeLeases?: number;
}

export interface EnqueueJobRequest {
  payload: JobPayload;
  requirement?: JobRequirement;
}

export interface ClaimJobResponse {
  job: JobRecord | null;
}

export interface CompleteJobRequest {
  hostId: string;
  success: boolean;
  durationMs: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface CoordinatorSnapshot {
  hosts: HostRecord[];
  jobs: JobRecord[];
}
