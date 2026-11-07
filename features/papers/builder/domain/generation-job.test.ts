import { describe, expect, it } from "vitest";

import { hasGenerationAccess, isGenerationTerminal, mayUpdateGeneration } from "./generation-job";

describe("generation ownership", () => {
  it("allows only the active worker to checkpoint a running job", () => {
    const job = { status: "generating" as const, workerId: "worker-a", leaseExpiresAt: 100 };
    expect(mayUpdateGeneration(job, "worker-a", 99)).toBe(true);
    expect(mayUpdateGeneration(job, "worker-b", 99)).toBe(false);
    expect(mayUpdateGeneration(job, "worker-a", 100)).toBe(false);
  });

  it("does not let cancellation or a late worker rewrite a terminal result", () => {
    for (const status of ["succeeded", "failed", "cancelled"] as const) {
      expect(isGenerationTerminal(status)).toBe(true);
      expect(mayUpdateGeneration({ status, workerId: "worker-a", leaseExpiresAt: 100 }, "worker-a", 1)).toBe(false);
    }
    expect(isGenerationTerminal("assembling")).toBe(false);
  });

  it("revokes guest access once a paper has an account owner", () => {
    const job = { ownerId: "student-a", guestHash: "guest-capability-hash" };
    expect(hasGenerationAccess(job, { ownerId: "student-a", guestHash: "" })).toBe(true);
    expect(hasGenerationAccess(job, { guestHash: "guest-capability-hash" })).toBe(false);
    expect(hasGenerationAccess(job, { ownerId: "student-b", guestHash: "guest-capability-hash" })).toBe(false);
  });

  it("requires a nonempty matching capability for an unclaimed paper", () => {
    expect(hasGenerationAccess({ guestHash: "known" }, { guestHash: "known" })).toBe(true);
    expect(hasGenerationAccess({ guestHash: "known" }, { guestHash: "wrong" })).toBe(false);
    expect(hasGenerationAccess({ guestHash: "" }, { guestHash: "" })).toBe(false);
  });
});
