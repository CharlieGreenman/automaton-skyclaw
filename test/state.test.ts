import { describe, expect, it } from "vitest";
import { CoordinatorState } from "../src/coordinator/state.js";

describe("CoordinatorState", () => {
  it("assigns jobs to matching hosts", () => {
    const state = new CoordinatorState({ leaseMs: 10_000 });
    const host = state.registerHost({
      name: "openclaw-a",
      capabilities: ["shell", "automaton"],
      maxParallel: 1
    });

    state.enqueueJob({
      payload: { kind: "automaton-run", args: ["--run"] },
      requirement: { requiredCapabilities: ["automaton"] }
    });

    const claim = state.claimJob(host.id);
    expect(claim.job?.status).toBe("leased");
    expect(claim.job?.assignedHostId).toBe(host.id);
  });

  it("requeues expired leases", async () => {
    const state = new CoordinatorState({ leaseMs: 10 });
    const host = state.registerHost({
      name: "openclaw-b",
      capabilities: ["shell"],
      maxParallel: 1
    });

    state.enqueueJob({
      payload: { kind: "shell", command: "bash", args: ["-lc", "echo hi"] }
    });

    const first = state.claimJob(host.id);
    expect(first.job).not.toBeNull();

    await new Promise((r) => setTimeout(r, 20));

    const requeued = state.requeueExpiredLeases();
    expect(requeued).toBe(1);

    const second = state.claimJob(host.id);
    expect(second.job?.id).toBe(first.job?.id);
    expect(second.job?.attempts).toBe(2);
  });

  it("records completion output", () => {
    const state = new CoordinatorState({ leaseMs: 1_000 });
    const host = state.registerHost({ name: "openclaw-c", capabilities: ["shell"] });
    const job = state.enqueueJob({
      payload: { kind: "shell", command: "bash", args: ["-lc", "echo ok"] }
    });
    state.claimJob(host.id);

    const completed = state.completeJob(job.id, {
      hostId: host.id,
      success: true,
      durationMs: 42,
      exitCode: 0,
      stdout: "ok\n",
      stderr: ""
    });

    expect(completed.status).toBe("completed");
    expect(completed.result?.stdout).toBe("ok\n");
  });
});
