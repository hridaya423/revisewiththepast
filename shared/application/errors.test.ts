import { describe, expect, it } from "vitest";
import { DomainError, ValidationError, normalizeApplicationError } from "./errors";

describe("application errors", () => {
  it("preserves typed validation errors", () => {
    const error = new ValidationError("Invalid input.", { subjectKey: ["Required"] });
    expect(normalizeApplicationError(error)).toBe(error);
    expect(error.status).toBe(400);
    expect(error.details?.subjectKey).toEqual(["Required"]);
  });

  it("does not expose unexpected internal details", () => {
    const error = normalizeApplicationError(new Error("secret provider stack"));
    expect(error.status).toBe(500);
    expect(error.message).toBe("An unexpected error occurred.");
  });

  it("preserves domain failures with their client-visible status", () => {
    const error = new DomainError("The uploaded PDF is a blank question paper.");
    expect(normalizeApplicationError(error)).toBe(error);
    expect(error.status).toBe(422);
  });
});
