import { describe, expect, it } from "vitest";
import {
  assertPeerCapacity,
  normalizeMinReplicas,
  requiredPeerReplications
} from "../src/coordinator/replication-policy.js";

describe("replication policy", () => {
  it("defaults to 100 replicas when unset", () => {
    expect(normalizeMinReplicas(undefined)).toBe(100);
  });

  it("requires minReplicas - 1 peer acknowledgements", () => {
    expect(requiredPeerReplications(100)).toBe(99);
    expect(requiredPeerReplications(1)).toBe(0);
  });

  it("rejects insufficient peer capacity", () => {
    expect(() => assertPeerCapacity(100, 98)).toThrow(/requires at least 99 peers/);
    expect(() => assertPeerCapacity(100, 99)).not.toThrow();
  });
});
