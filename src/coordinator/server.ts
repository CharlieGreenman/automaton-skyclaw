import { createServer } from "node:http";
import type {
  CompleteJobRequest,
  EnqueueJobRequest,
  HeartbeatRequest,
  RegisterHostRequest
} from "../types.js";
import { readJson, sendError, sendJson } from "../http.js";
import { CoordinatorState } from "./state.js";

export interface CoordinatorServerOptions {
  port: number;
  host?: string;
  authToken?: string;
  leaseMs?: number;
}

function checkAuth(reqToken: string | undefined, configured: string | undefined): boolean {
  if (!configured) return true;
  return reqToken === configured;
}

export async function startCoordinatorServer(options: CoordinatorServerOptions): Promise<void> {
  const state = new CoordinatorState({ leaseMs: options.leaseMs });

  setInterval(() => {
    state.requeueExpiredLeases();
  }, 1_000).unref();

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
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && pathname === "/v1/state") {
        sendJson(res, 200, state.snapshot());
        return;
      }

      if (req.method === "POST" && pathname === "/v1/hosts/register") {
        const body = await readJson<RegisterHostRequest>(req);
        if (!body.name?.trim()) {
          sendError(res, 400, "name is required");
          return;
        }
        const host = state.registerHost(body);
        sendJson(res, 200, { host });
        return;
      }

      const heartbeatMatch = pathname.match(/^\/v1\/hosts\/([^/]+)\/heartbeat$/);
      if (req.method === "POST" && heartbeatMatch) {
        const hostId = decodeURIComponent(heartbeatMatch[1]);
        const body = await readJson<HeartbeatRequest>(req);
        const host = state.heartbeat(hostId, body.activeLeases);
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
        sendJson(res, 200, { job });
        return;
      }

      const claimMatch = pathname.match(/^\/v1\/hosts\/([^/]+)\/claim$/);
      if (req.method === "POST" && claimMatch) {
        const hostId = decodeURIComponent(claimMatch[1]);
        const result = state.claimJob(hostId);
        sendJson(res, 200, result);
        return;
      }

      const completeMatch = pathname.match(/^\/v1\/jobs\/([^/]+)\/complete$/);
      if (req.method === "POST" && completeMatch) {
        const jobId = decodeURIComponent(completeMatch[1]);
        const body = await readJson<CompleteJobRequest>(req);
        const job = state.completeJob(jobId, body);
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
    `[skyclaw] coordinator listening on http://${options.host ?? "0.0.0.0"}:${options.port}\n`
  );
}
