import { afterEach, describe, expect, it } from "vitest";

import { requireServiceSecret, secretsMatch } from "./serviceAuth";

const ORIGINAL_SECRET = process.env.MCP_SERVICE_SECRET;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.MCP_SERVICE_SECRET;
  } else {
    process.env.MCP_SERVICE_SECRET = ORIGINAL_SECRET;
  }
});

describe("secretsMatch", () => {
  it("accepts identical secrets", () => {
    expect(secretsMatch("s3cr3t-value", "s3cr3t-value")).toBe(true);
  });

  it("rejects secrets that differ in length", () => {
    expect(secretsMatch("short", "shorter-secret")).toBe(false);
  });

  it("rejects same-length secrets that differ", () => {
    expect(secretsMatch("s3cr3t-value", "s3cr3t-valuX")).toBe(false);
  });
});

describe("requireServiceSecret", () => {
  it("throws Unauthorized when MCP_SERVICE_SECRET is not configured", () => {
    delete process.env.MCP_SERVICE_SECRET;
    expect(() => requireServiceSecret("anything")).toThrowError("Unauthorized");
  });

  it("throws Unauthorized for a missing secret", () => {
    process.env.MCP_SERVICE_SECRET = "correct-horse-battery-staple";
    expect(() => requireServiceSecret("")).toThrowError("Unauthorized");
  });

  it("throws Unauthorized for a wrong secret", () => {
    process.env.MCP_SERVICE_SECRET = "correct-horse-battery-staple";
    expect(() => requireServiceSecret("wrong-horse-battery-staple!")).toThrowError("Unauthorized");
  });

  it("accepts the configured secret", () => {
    process.env.MCP_SERVICE_SECRET = "correct-horse-battery-staple";
    expect(() => requireServiceSecret("correct-horse-battery-staple")).not.toThrow();
  });
});
