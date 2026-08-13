import { describe, expect, it } from "vitest";

import { parseMarkInput } from "./marking/parse-mark-input";

describe("parseMarkInput", () => {
  it("keeps the current value for empty, invalid, and non-finite input", () => {
    expect(parseMarkInput("", 2, 5)).toBe(2);
    expect(parseMarkInput("not a number", 2, 5)).toBe(2);
    expect(parseMarkInput("Infinity", 2, 5)).toBe(2);
  });

  it("clamps valid marks to the allowed range", () => {
    expect(parseMarkInput("-1", 2, 5)).toBe(0);
    expect(parseMarkInput("8", 2, 5)).toBe(5);
    expect(parseMarkInput("2.5", 2, 5)).toBe(2.5);
    expect(parseMarkInput("2", 2, 0)).toBe(0);
  });
});
