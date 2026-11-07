import type { ShadowManifest } from "../contracts/shadow-paper";
import { canonicalStringify, deriveUnitSeed, hashHex, sampleCandidates, ShadowGenerationError } from "./parameters";
import { templateRevisionKey, type AnyShadowTemplate, type ShadowPaperVariant, type ShadowUnitVariant } from "./types";
import { validateUnit } from "./validation";

export class ShadowTemplateRegistry {
  private readonly templates = new Map<string, AnyShadowTemplate>();

  constructor(templates: AnyShadowTemplate[]) {
    for (const template of templates) {
      const key = templateRevisionKey(template);
      if (this.templates.has(key)) throw new Error(`Duplicate template revision ${key}.`);
      this.templates.set(key, template);
    }
  }

  get(revisionKey: string, options: { allowDraft?: boolean } = {}): AnyShadowTemplate {
    const template = this.templates.get(revisionKey);
    if (!template) throw new Error(`Unknown template revision ${revisionKey}.`);
    if (template.review.status === "withdrawn") throw new Error(`Template revision ${revisionKey} has been withdrawn.`);
    if (template.review.status === "draft" && !options.allowDraft) throw new Error(`Template revision ${revisionKey} is not approved.`);
    return template;
  }

  list() {
    return [...this.templates.values()];
  }
}

export function generateUnitVariant(template: AnyShadowTemplate, input: { paperSeed: string; displayOrder: number }): ShadowUnitVariant {
  const templateRevision = templateRevisionKey(template);
  const unitSeed = deriveUnitSeed(input.paperSeed, templateRevision, template.sourceUnitKey);
  const result = sampleCandidates({
    unitSeed,
    sourceParameters: template.sourceParameters,
    sample: (rng) => template.sample(rng),
    accept: (parameters) => {
      const violations = template.constraints(parameters);
      if (violations.length > 0) return { ok: false, reason: `constraint:${violations[0]}` };
      const unchanged = template.unchangedParts?.(parameters) ?? [];
      if (unchanged.length > 0) return { ok: false, reason: `unchanged-part:${unchanged[0]}` };
      const derived = template.derive(parameters);
      const question = template.buildQuestion(parameters, derived, { questionNumber: input.displayOrder });
      const solution = template.solve(parameters, derived);
      const validation = validateUnit(template, parameters, derived, question, solution);
      if (!validation.ok) {
        const failed = validation.checks.find((entry) => !entry.ok);
        return { ok: false, reason: `validation:${failed?.name ?? "unknown"}` };
      }
      return { ok: true, value: { question, solution, validation } };
    },
  });
  return {
    displayOrder: input.displayOrder,
    sourceUnitKey: template.sourceUnitKey,
    templateRevision,
    unitSeed,
    attempt: result.attempt,
    parameters: result.parameters,
    ...result.value,
  };
}

export function semanticHashInput(manifest: Pick<ShadowManifest, "manifestId" | "revision">, units: Array<Pick<ShadowUnitVariant, "templateRevision" | "parameters">>, mode = "full-paper") {
  return canonicalStringify({
    v: 1,
    manifest: `${manifest.manifestId}@${manifest.revision}`,
    mode,
    units: units.map((unit) => ({ template: unit.templateRevision, parameters: unit.parameters })),
  });
}

const displayAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function displayCodeFromHash(semanticHash: string) {
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    const byte = Number.parseInt(semanticHash.slice(index * 2, index * 2 + 2), 16);
    code += displayAlphabet[byte % displayAlphabet.length];
  }
  return `SH-${code.slice(0, 4)}-${code.slice(4)}`;
}

export function generatePaperVariant(input: {
  manifest: ShadowManifest;
  registry: ShadowTemplateRegistry;
  paperSeed: string;
  sha256: (value: string) => string;
  allowDraft?: boolean;
  onUnit?: (completed: number, total: number) => void;
}): ShadowPaperVariant {
  const units: ShadowUnitVariant[] = [];
  const total = input.manifest.units.length;
  for (const unit of input.manifest.units) {
    if (unit.classification !== "template" || !unit.templateRevision) {
      throw new ShadowGenerationError("VALIDATION_FAILED", `Question ${unit.questionNumber} has no approved template; unchanged units are not supported by this manifest.`);
    }
    const template = input.registry.get(unit.templateRevision, { allowDraft: input.allowDraft });
    if (template.sourceUnitKey !== unit.sourceUnitKey) {
      throw new ShadowGenerationError("VALIDATION_FAILED", `Template ${unit.templateRevision} maps ${template.sourceUnitKey}, not ${unit.sourceUnitKey}.`);
    }
    const generated = generateUnitVariant(template, { paperSeed: input.paperSeed, displayOrder: unit.questionNumber });
    const printed = generated.question.parts.map((part) => `${part.id}:${part.marks}`).join(",");
    const expected = unit.parts.map((part) => `${part.path.replace(/^\d+\(?|\)$/gu, "")}:${part.marks}`).join(",");
    if (printed !== expected) {
      throw new ShadowGenerationError("VALIDATION_FAILED", `Question ${unit.questionNumber} prints ${printed}; the manifest requires ${expected}.`);
    }
    units.push(generated);
    input.onUnit?.(units.length, total);
  }
  const totalMarks = units.reduce((sum, unit) => sum + unit.question.totalMarks, 0);
  if (totalMarks !== input.manifest.source.totalMarks) {
    throw new ShadowGenerationError("VALIDATION_FAILED", `Generated paper totals ${totalMarks} marks, not ${input.manifest.source.totalMarks}.`);
  }
  const semanticHash = input.sha256(semanticHashInput(input.manifest, units));
  return {
    manifest: input.manifest,
    paperSeed: input.paperSeed,
    semanticHash,
    displayCode: displayCodeFromHash(semanticHash),
    units,
    totalMarks,
  };
}

export function newPaperSeed(randomHex: string) {
  if (!/^[0-9a-f]{32,64}$/u.test(randomHex)) throw new Error("Paper seeds must be server-generated hex.");
  return hashHex(`shadow-paper-v1\u0000${randomHex}`);
}
