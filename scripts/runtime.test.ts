import { describe, expect, it } from "vitest";
import { getBooleanEnvironment, getFirstEnvironment, getNumberEnvironment, mapWithConcurrency } from "./runtime";

describe("CLI runtime helpers", () => {
  it("preserves input order while processing with bounded workers", async () => {
    const values = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value === 1 ? 5 : 0));
      return value * 2;
    });
    expect(values).toEqual([2, 4, 6, 8]);
  });

  it("centralizes common environment parsing", () => {
    const previous = process.env.TEST_RUNTIME_FLAG;
    process.env.TEST_RUNTIME_FLAG = "true";
    expect(getBooleanEnvironment("TEST_RUNTIME_FLAG", false)).toBe(true);
    process.env.TEST_RUNTIME_FLAG = "";
    expect(getFirstEnvironment("TEST_RUNTIME_FLAG", "PATH")).toBe(process.env.PATH);
    expect(getNumberEnvironment("TEST_RUNTIME_NUMBER", 12, { min: 1, max: 20 })).toBe(12);
    if (previous === undefined) delete process.env.TEST_RUNTIME_FLAG;
    else process.env.TEST_RUNTIME_FLAG = previous;
  });
});
