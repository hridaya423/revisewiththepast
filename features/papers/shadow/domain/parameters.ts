export const SHADOW_SAMPLE_LIMIT = 400;
export const SHADOW_RNG_ALGORITHM = "sfc32-cyrb128-v1";

export type ShadowErrorCodeLike = "NO_VALID_VARIANT" | "VALIDATION_FAILED";

export class ShadowGenerationError extends Error {
  readonly code: ShadowErrorCodeLike;
  readonly reasons: Record<string, number>;

  constructor(code: ShadowErrorCodeLike, message: string, reasons: Record<string, number> = {}) {
    super(message);
    this.name = "ShadowGenerationError";
    this.code = code;
    this.reasons = reasons;
  }
}

/** cyrb128: a fast, well-distributed 128-bit string hash. Stable across platforms because it uses only 32-bit integer maths. */
export function hash128(input: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function hashHex(input: string) {
  return hash128(input).map((part) => part.toString(16).padStart(8, "0")).join("");
}

export type ShadowRng = {
  readonly algorithm: typeof SHADOW_RNG_ALGORITHM;
  next(): number;
  int(min: number, max: number): number;
  pick<T>(values: readonly T[]): T;
  shuffle<T>(values: readonly T[]): T[];
  chance(probability: number): boolean;
};

export function createShadowRng(seed: string): ShadowRng {
  let [a, b, c, d] = hash128(seed);
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let index = 0; index < 12; index += 1) next();
  const int = (min: number, max: number) => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new Error(`Invalid integer range ${min}..${max}.`);
    return min + Math.floor(next() * (max - min + 1));
  };
  return {
    algorithm: SHADOW_RNG_ALGORITHM,
    next,
    int,
    pick: (values) => {
      if (values.length === 0) throw new Error("Cannot pick from an empty list.");
      return values[int(0, values.length - 1)]!;
    },
    shuffle: (values) => {
      const copy = [...values];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = int(0, index);
        [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
      }
      return copy;
    },
    chance: (probability) => next() < probability,
  };
}

/** Unit seeds depend only on the paper seed, the template revision, and the source unit — never on traversal order or time. */
export function deriveUnitSeed(paperSeed: string, templateRevision: string, sourceUnitKey: string) {
  return hashHex(`shadow-unit-v1\u0000${paperSeed}\u0000${templateRevision}\u0000${sourceUnitKey}`);
}

export type ParameterValue = number | string | boolean | ParameterValue[] | { [key: string]: ParameterValue };
export type ShadowParameters = { [key: string]: ParameterValue };

export function canonicalStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Parameters must be finite numbers.");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalStringify(entry)}`).join(",")}}`;
  }
  throw new Error(`Unsupported parameter value of type ${typeof value}.`);
}

export type CandidateDecision<T> = { ok: true; value: T } | { ok: false; reason: string };

export function sampleCandidates<P extends ShadowParameters, T>(input: {
  unitSeed: string;
  sourceParameters: P;
  sample: (rng: ShadowRng) => P;
  accept: (parameters: P) => CandidateDecision<T>;
  limit?: number;
}): { parameters: P; value: T; attempt: number } {
  const limit = input.limit ?? SHADOW_SAMPLE_LIMIT;
  const source = canonicalStringify(input.sourceParameters);
  const reasons: Record<string, number> = {};
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const parameters = input.sample(createShadowRng(`${input.unitSeed}#${attempt}`));
    const reason = canonicalStringify(parameters) === source
      ? "identical-to-source"
      : (() => {
          const decision = input.accept(parameters);
          if (decision.ok) return { decision };
          return decision.reason;
        })();
    if (typeof reason === "object") return { parameters, value: reason.decision.value, attempt };
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  throw new ShadowGenerationError("NO_VALID_VARIANT", `No valid variant after ${limit} candidates.`, reasons);
}
