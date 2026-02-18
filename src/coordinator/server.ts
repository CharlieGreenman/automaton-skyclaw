import { createServer } from "node:http";
import type {
  CompleteJobRequest,
  CoordinatorSnapshot,
  EnqueueJobRequest,
  HeartbeatRequest,
  RegisterHostRequest
} from "../types.js";
import { readJson, sendError, sendJson } from "../http.js";
import {
  assertPeerCapacity,
  normalizeMinReplicas,
  requiredPeerReplications
} from "./replication-policy.js";
import { CoordinatorState } from "./state.js";

export interface CoordinatorServerOptions {
  port: number;
  host?: string;
  authToken?: string;
  leaseMs?: number;
  dbPath?: string;
  nodeId?: string;
  peerUrls?: string[];
  peerSyncIntervalMs?: number;
  minReplicas?: number;
}

function checkAuth(reqToken: string | undefined, configured: string | undefined): boolean {
  if (!configured) return true;
  return reqToken === configured;
}

function normalizePeerUrls(urls: string[] | undefined, ownPort: number): string[] {
  if (!urls?.length) return [];
  const ownLocal = new Set([
    `http://127.0.0.1:${ownPort}`,
    `http://localhost:${ownPort}`,
    `http://0.0.0.0:${ownPort}`
  ]);
  return [...new Set(urls.map((url) => url.trim()).filter(Boolean))].filter((url) => !ownLocal.has(url));
}

export async function startCoordinatorServer(options: CoordinatorServerOptions): Promise<void> {
  const minReplicas = normalizeMinReplicas(options.minReplicas);
  const requiredPeerAcks = requiredPeerReplications(minReplicas);
  const state = new CoordinatorState({
    leaseMs: options.leaseMs,
    dbPath: options.dbPath,
    nodeId: options.nodeId
  });
  const peerUrls = normalizePeerUrls(options.peerUrls, options.port);
  assertPeerCapacity(minReplicas, peerUrls.length);

  setInterval(() => {
    state.requeueExpiredLeases();
  }, 1_000).unref();

  if (peerUrls.length > 0) {
    const syncIntervalMs = options.peerSyncIntervalMs ?? 3_000;
    setInterval(() => {
      void syncFromPeers(state, peerUrls, options.authToken);
    }, syncIntervalMs).unref();
  }

  const server = createServer(async (req, res) => {
    try {
      const token = req.headers["x-skyclaw-token"];
      const providedToken = Array.isArray(token) ? token[0] : token;
      if (!checkAuth(providedToken, options.authToken)) {
        sendError(res, 401, "unauthorized");
        return;
      }

      if (!req.url || !req.method) {
        sendError(res, 400, "invalid request");
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const { pathname } = url;

      if (req.method === "GET" && pathname === "/health") {
        sendJson(res, 200, { ok: true, nodeId: state.getNodeId() });
        return;
      }

      if (req.method === "GET" && pathname === "/v1/state") {
        sendJson(res, 200, state.snapshot());
        return;
      }

      if (req.method === "POST" && pathname === "/v1/replicate/snapshot") {
        const snapshot = await readJson<CoordinatorSnapshot>(req);
        const merged = state.mergeSnapshot(snapshot);
        sendJson(res, 200, { ok: true, changed: merged.changed, nodeId: state.getNodeId() });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/hosts/register") {
        const body = await readJson<RegisterHostRequest>(req);
        if (!body.name?.trim()) {
          sendError(res, 400, "name is required");
          return;
        }
        const host = state.registerHost(body);
        const replication = await replicateSnapshotToPeers(state, peerUrls, options.authToken);
        if (replication.acked < requiredPeerAcks) {
          sendError(
            res,
            503,
            `replication target not met: required ${requiredPeerAcks} peer acks, got ${replication.acked}`
          );
          return;
        }
        sendJson(res, 200, { host });
        return;
      }

      const heartbeatMatch = pathname.match(/^\/v1\/hosts\/([^/]+)\/heartbeat$/);
      if (req.method === "POST" && heartbeatMatch) {
        const hostId = decodeURIComponent(heartbeatMatch[1]);
        const body = await readJson<HeartbeatRequest>(req);
        const host = state.heartbeat(hostId, body.activeLeases);
        const replication = await replicateSnapshotToPeers(state, peerUrls, options.authToken);
        if (replication.acked < requiredPeerAcks) {
          sendError(
            res,
            503,
            `replication target not met: required ${requiredPeerAcks} peer acks, got ${replication.acked}`
          );
          return;
        }
        sendJson(res, 200, { host });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/jobs") {
        const body = await readJson<EnqueueJobRequest>(req);
        if (!body.payload || !body.payload.kind) {
          sendError(res, 400, "payload is required");
          return;
        }
        const job = state.enqueueJob(body);
        const replication = await replicateSnapshotToPeers(state, peerUrls, options.authToken);
        if (replication.acked < requiredPeerAcks) {
          sendError(
            res,
            503,
            `replication target not met: required ${requiredPeerAcks} peer acks, got ${replication.acked}`
          );
          return;
        }
        sendJson(res, 200, { job });
        return;
      }

      const claimMatch = pathname.match(/^\/v1\/hosts\/([^/]+)\/claim$/);
      if (req.method === "POST" && claimMatch) {
        const hostId = decodeURIComponent(claimMatch[1]);
        const result = state.claimJob(hostId);
        if (result.job) {
          const replication = await replicateSnapshotToPeers(state, peerUrls, options.authToken);
          if (replication.acked < requiredPeerAcks) {
            sendError(
              res,
              503,
              `replication target not met: required ${requiredPeerAcks} peer acks, got ${replication.acked}`
            );
            return;
          }
        }
        sendJson(res, 200, result);
        return;
      }

      const completeMatch = pathname.match(/^\/v1\/jobs\/([^/]+)\/complete$/);
      if (req.method === "POST" && completeMatch) {
        const jobId = decodeURIComponent(completeMatch[1]);
        const body = await readJson<CompleteJobRequest>(req);
        const job = state.completeJob(jobId, body);
        const replication = await replicateSnapshotToPeers(state, peerUrls, options.authToken);
        if (replication.acked < requiredPeerAcks) {
          sendError(
            res,
            503,
            `replication target not met: required ${requiredPeerAcks} peer acks, got ${replication.acked}`
          );
          return;
        }
        sendJson(res, 200, { job });
        return;
      }

      sendError(res, 404, "not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal error";
      sendError(res, 500, message);
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port, options.host ?? "0.0.0.0", () => resolve());
  });

  process.stdout.write(
    `[skyclaw] coordinator ${state.getNodeId()} listening on http://${options.host ?? "0.0.0.0"}:${options.port}\n`
  );
  process.stdout.write(
    `[skyclaw] replication policy: min replicas ${minReplicas} (${requiredPeerAcks} peer acks required)\n`
  );

  if (peerUrls.length > 0) {
    process.stdout.write(`[skyclaw] peers: ${peerUrls.join(", ")}\n`);
    void syncFromPeers(state, peerUrls, options.authToken);
  }
}

async function replicateSnapshotToPeers(
  state: CoordinatorState,
  peerUrls: string[],
  token?: string
): Promise<{ acked: number; attempted: number }> {
  if (peerUrls.length === 0) return { acked: 0, attempted: 0 };
  const snapshot = state.snapshot();
  const results = await Promise.all(
    peerUrls.map(async (peerUrl) => {
      try {
        const response = await fetch(`${peerUrl}/v1/replicate/snapshot`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { "x-skyclaw-token": token } : {})
          },
          body: JSON.stringify(snapshot)
        });
        return response.ok;
      } catch {
        // best-effort replication
        return false;
      }
    })
  );
  return { acked: results.filter(Boolean).length, attempted: peerUrls.length };
}

async function syncFromPeers(state: CoordinatorState, peerUrls: string[], token?: string): Promise<void> {
  await Promise.all(
    peerUrls.map(async (peerUrl) => {
      try {
        const response = await fetch(`${peerUrl}/v1/state`, {
          headers: {
            ...(token ? { "x-skyclaw-token": token } : {})
          }
        });
        if (!response.ok) return;
        const snapshot = (await response.json()) as CoordinatorSnapshot;
        state.mergeSnapshot(snapshot);
      } catch {
        // best-effort peer sync
      }
    })
  );
}
