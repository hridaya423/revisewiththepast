import { describe, expect, it } from "vitest";

import { parseMarkInput, validateMarkInput } from "./marking/parse-mark-input";

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

describe("validateMarkInput", () => {
  it("refuses blanks, fractions, negatives and marks above the maximum with a reason", () => {
    expect(validateMarkInput("", 4)).toEqual({ ok: false, message: "Enter a mark." });
    expect(validateMarkInput("2.5", 4)).toMatchObject({ ok: false });
    expect(validateMarkInput("-1", 4)).toMatchObject({ ok: false });
    expect(validateMarkInput("Infinity", 4)).toMatchObject({ ok: false });
    expect(validateMarkInput("5", 4)).toEqual({ ok: false, message: "This question is out of 4." });
  });

  it("accepts whole marks inside the range", () => {
    expect(validateMarkInput(" 3 ", 4)).toEqual({ ok: true, value: 3 });
    expect(validateMarkInput("0", 0)).toEqual({ ok: true, value: 0 });
  });
});
