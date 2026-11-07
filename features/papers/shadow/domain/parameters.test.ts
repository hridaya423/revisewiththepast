import { describe, expect, it } from "vitest";

import { R, Rational, formatDecimal, roundToDecimalPlaces, roundToSignificantFigures, truncateToDecimalPlaces } from "./rational";
import { SHADOW_SAMPLE_LIMIT, ShadowGenerationError, canonicalStringify, createShadowRng, deriveUnitSeed, sampleCandidates } from "./parameters";

describe("exact rational arithmetic", () => {
  it("normalises signs and common factors", () => {
    expect(R(6, -8).toExact()).toBe("-3/4");
    expect(R(-10, -5).toExact()).toBe("2");
    expect(Rational.parse("0.125").toExact()).toBe("1/8");
    expect(Rational.parse("-17/4").toExact()).toBe("-17/4");
    expect(R(1, 3).add(R(1, 6)).toExact()).toBe("1/2");
    expect(R(7, 2).mul(R(8, 5)).toExact()).toBe("28/5");
  });

  it("rejects zero denominators and malformed input", () => {
    expect(() => R(1, 0)).toThrow(/denominator/);
    expect(() => R(1).div(R(0))).toThrow(/zero/);
    expect(() => Rational.parse("1/0")).toThrow();
    expect(() => Rational.parse("1e5")).toThrow();
    expect(() => R(Number.NaN)).toThrow();
    expect(() => R(0.1)).toThrow(/integer/);
  });

  it("rounds ties half away from zero without binary floating point", () => {
    // (2.675).toFixed(2) is "2.67" in JavaScript; the exam answer is 2.68.
    expect(formatDecimal(roundToDecimalPlaces(Rational.parse("2.675"), 2))).toBe("2.68");
    expect(formatDecimal(roundToDecimalPlaces(Rational.parse("-2.675"), 2))).toBe("-2.68");
    expect(formatDecimal(roundToDecimalPlaces(Rational.parse("0.5"), 0))).toBe("1");
    expect(formatDecimal(roundToDecimalPlaces(Rational.parse("-0.5"), 0))).toBe("-1");
    expect(formatDecimal(roundToDecimalPlaces(R(1, 3), 3))).toBe("0.333");
    expect(formatDecimal(roundToDecimalPlaces(Rational.parse("1250"), -2))).toBe("1300");
  });

  it("rounds to significant figures across powers of ten and leading zeroes", () => {
    expect(formatDecimal(roundToSignificantFigures(Rational.parse("148.035889"), 3))).toBe("148");
    expect(formatDecimal(roundToSignificantFigures(Rational.parse("0.000148035889"), 3))).toBe("0.000148");
    expect(formatDecimal(roundToSignificantFigures(Rational.parse("999.5"), 3))).toBe("1000");
    expect(formatDecimal(roundToSignificantFigures(Rational.parse("0.0009995"), 3))).toBe("0.001");
    expect(formatDecimal(roundToSignificantFigures(Rational.parse("-0.04565"), 3))).toBe("-0.0457");
    expect(formatDecimal(roundToSignificantFigures(Rational.parse("100"), 2))).toBe("100");
    expect(() => roundToSignificantFigures(R(0), 3)).not.toThrow();
  });

  it("truncates toward zero", () => {
    expect(formatDecimal(truncateToDecimalPlaces(Rational.parse("2.679"), 2))).toBe("2.67");
    expect(formatDecimal(truncateToDecimalPlaces(Rational.parse("-2.679"), 2))).toBe("-2.67");
  });

  it("refuses to print non-terminating values without a rounding rule", () => {
    expect(() => formatDecimal(R(1, 3))).toThrow(/terminating/);
    expect(formatDecimal(R(1, 25))).toBe("0.04");
  });
});

describe("deterministic parameter sampling", () => {
  it("produces the same stream for the same seed and versioned algorithm", () => {
    const first = createShadowRng("paper-seed|unit");
    const second = createShadowRng("paper-seed|unit");
    const draws = () => Array.from({ length: 20 }, () => first.int(1, 1000));
    const values = draws();
    expect(Array.from({ length: 20 }, () => second.int(1, 1000))).toEqual(values);
    expect(createShadowRng("paper-seed|unit").algorithm).toBe("sfc32-cyrb128-v1");
    expect(new Set(values).size).toBeGreaterThan(10);
  });

  it("keeps integer draws inside inclusive bounds", () => {
    const rng = createShadowRng("bounds");
    const seen = new Set<number>();
    for (let index = 0; index < 2000; index += 1) {
      const value = rng.int(-2, 2);
      expect(value).toBeGreaterThanOrEqual(-2);
      expect(value).toBeLessThanOrEqual(2);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([-1, -2, 0, 1, 2].sort());
  });

  it("derives unit seeds from paper seed, template revision, and source key only", () => {
    const seed = deriveUnitSeed("abc", "q1-probability@1", "edexcel::2019::q1");
    expect(seed).toBe(deriveUnitSeed("abc", "q1-probability@1", "edexcel::2019::q1"));
    expect(seed).not.toBe(deriveUnitSeed("abc", "q1-probability@2", "edexcel::2019::q1"));
    expect(seed).not.toBe(deriveUnitSeed("abd", "q1-probability@1", "edexcel::2019::q1"));
    expect(seed).toMatch(/^[0-9a-f]{32}$/);
  });

  it("serialises parameters canonically and rejects non-finite values", () => {
    expect(canonicalStringify({ b: 2, a: [1, { d: "x", c: true }] })).toBe('{"a":[1,{"c":true,"d":"x"}],"b":2}');
    expect(() => canonicalStringify({ a: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalStringify({ a: undefined })).toThrow();
  });

  it("rejects identical-source candidates and stops after the bounded limit", () => {
    let attempts = 0;
    expect(() => sampleCandidates({
      unitSeed: "seed",
      sourceParameters: { a: 1 },
      sample: () => { attempts += 1; return { a: 1 }; },
      accept: () => ({ ok: true as const, value: null }),
    })).toThrow(ShadowGenerationError);
    expect(attempts).toBe(SHADOW_SAMPLE_LIMIT);
  });

  it("returns the first accepted candidate deterministically", () => {
    const run = () => sampleCandidates({
      unitSeed: "seed-2",
      sourceParameters: { a: 0 },
      sample: (rng) => ({ a: rng.int(0, 9) }),
      accept: (parameters) => (parameters.a % 2 === 1 ? { ok: true as const, value: parameters.a * 10 } : { ok: false as const, reason: "even" }),
    });
    const first = run();
    expect(first).toEqual(run());
    expect(first.parameters.a % 2).toBe(1);
    expect(first.value).toBe(first.parameters.a * 10);
  });

  it("reports the rejection reasons when a domain is exhausted", () => {
    try {
      sampleCandidates({ unitSeed: "s", sourceParameters: { a: 1 }, sample: () => ({ a: 2 }), accept: () => ({ ok: false as const, reason: "always-invalid" }) });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ShadowGenerationError);
      expect((error as ShadowGenerationError).code).toBe("NO_VALID_VARIANT");
      expect((error as ShadowGenerationError).reasons).toEqual({ "always-invalid": SHADOW_SAMPLE_LIMIT });
    }
  });
});
