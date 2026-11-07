import { describe, expect, it } from "vitest";

import { JUNE_2019_PAPER_1_TEMPLATES } from "../content/edexcel-higher/pilot";
import { SOURCE_EXPECTATIONS } from "../content/edexcel-higher/june-2019-paper-1/source-expectations";
import { blockPlainText, inlinePlainText } from "./content";
import { canonicalStringify } from "./parameters";
import { ShadowTemplateRegistry, generateUnitVariant } from "./template-registry";
import type { AnyShadowTemplate } from "./types";
import { validateUnit } from "./validation";

const SEEDS = Array.from({ length: 100 }, (_, index) => `fixed-seed-${String(index).padStart(3, "0")}`);

function questionText(template: AnyShadowTemplate, parameters: Record<string, unknown>) {
  const derived = template.derive(parameters);
  const question = template.buildQuestion(parameters, derived, { questionNumber: template.sourceQuestionNumber });
  const solution = template.solve(parameters, derived);
  return {
    derived,
    question,
    solution,
    prompt: [blockPlainText(question.stem), ...question.parts.map((part) => blockPlainText([...part.lead, ...part.prompt]))].join("\n"),
    answers: solution.parts.map((part) => inlinePlainText(part.answer)),
  };
}

describe.each(JUNE_2019_PAPER_1_TEMPLATES.map((template) => [template.templateId, template] as const))("%s", (_id, template) => {
  const expectation = SOURCE_EXPECTATIONS[template.sourceQuestionNumber];

  it("reproduces the source question, answers, and marks", () => {
    expect(expectation, `Missing source expectation for question ${template.sourceQuestionNumber}`).toBeDefined();
    expect(template.constraints(template.sourceParameters)).toEqual([]);
    const source = questionText(template, template.sourceParameters);
    const report = validateUnit(template, template.sourceParameters, source.derived, source.question, source.solution);
    expect(report.checks.filter((entry) => !entry.ok)).toEqual([]);
    for (const fragment of expectation!.prompt) expect(source.prompt).toContain(fragment);
    expect(source.answers).toEqual(expectation!.answers);
    expect(source.question.parts.map((part) => part.marks)).toEqual(template.structure.map((part) => part.marks));
    if (template.unchangedParts) expect(template.unchangedParts(template.sourceParameters)).toEqual(template.structure.map((part) => part.partId));
  });

  it("generates 100 valid, changed, deterministic variants", () => {
    const sourceKey = canonicalStringify(template.sourceParameters);
    const distinct = new Set<string>();
    for (const seed of SEEDS) {
      const variant = generateUnitVariant(template, { paperSeed: seed, displayOrder: template.sourceQuestionNumber });
      expect(variant.validation.ok, `${seed}: ${JSON.stringify(variant.validation.checks.filter((entry) => !entry.ok))}`).toBe(true);
      const key = canonicalStringify(variant.parameters);
      expect(key).not.toBe(sourceKey);
      expect(template.unchangedParts?.(variant.parameters) ?? []).toEqual([]);
      distinct.add(key);
      const text = questionText(template, variant.parameters);
      for (const answer of text.answers) expect(answer.length).toBeGreaterThan(0);
    }
    expect(distinct.size).toBeGreaterThanOrEqual(Math.min(expectation?.minimumVariety ?? 20, 100));
    const again = generateUnitVariant(template, { paperSeed: SEEDS[7]!, displayOrder: template.sourceQuestionNumber });
    expect(canonicalStringify(again.parameters)).toBe(canonicalStringify(generateUnitVariant(template, { paperSeed: SEEDS[7]!, displayOrder: template.sourceQuestionNumber }).parameters));
  });

  it("rejects invalid domains", () => {
    for (const invalid of expectation?.invalid ?? []) {
      expect(template.constraints({ ...template.sourceParameters, ...invalid }), JSON.stringify(invalid)).not.toEqual([]);
    }
    expect((expectation?.invalid ?? []).length).toBeGreaterThan(0);
  });

  it("never prints a variant answer inside its own question", () => {
    for (const seed of SEEDS.slice(0, 25)) {
      const variant = generateUnitVariant(template, { paperSeed: seed, displayOrder: template.sourceQuestionNumber });
      const text = questionText(template, variant.parameters);
      for (const leak of expectation?.answerMustNotAppear?.(text.answers) ?? []) {
        expect(text.prompt.includes(leak), `${seed}: "${leak}" appears in the prompt`).toBe(false);
      }
    }
  });
});

describe("template registry", () => {
  it("rejects unknown, draft, and withdrawn revisions", () => {
    const [first] = JUNE_2019_PAPER_1_TEMPLATES;
    const draft = { ...first!, templateId: "draft-template", review: { ...first!.review, status: "draft" as const } };
    const withdrawn = { ...first!, templateId: "withdrawn-template", review: { ...first!.review, status: "withdrawn" as const } };
    const registry = new ShadowTemplateRegistry([first!, draft, withdrawn]);
    expect(() => registry.get("missing@1")).toThrow(/Unknown/);
    expect(() => registry.get("draft-template@1")).toThrow(/not approved/);
    expect(registry.get("draft-template@1", { allowDraft: true })).toBe(draft);
    expect(() => registry.get("withdrawn-template@1", { allowDraft: true })).toThrow(/withdrawn/);
    expect(() => new ShadowTemplateRegistry([first!, first!])).toThrow(/Duplicate/);
  });
});
