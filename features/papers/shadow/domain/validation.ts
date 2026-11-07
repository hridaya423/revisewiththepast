import {
  questionDocumentSchema,
  solutionSchema,
  type ShadowQuestionDocument,
  type ShadowSolution,
  type ShadowValidationReport,
} from "../contracts/shadow-paper";
import { blockPlainText, numeralTokens } from "./content";
import type { ShadowParameters } from "./parameters";
import { check, type AnyShadowTemplate, type ShadowCheck, type ShadowReveal, type ShadowTemplate } from "./types";

function schemaCheck(name: string, result: { success: boolean; error?: { issues: Array<{ message: string; path: PropertyKey[] }> } }): ShadowCheck {
  if (result.success) return check(name, true);
  const detail = (result.error?.issues ?? []).slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  return check(name, false, detail);
}

function partText(question: ShadowQuestionDocument, partIndex: number) {
  const part = question.parts[partIndex]!;
  return blockPlainText([...part.lead, ...part.prompt]);
}

export function checkRevealOrder(question: ShadowQuestionDocument, reveals: ShadowReveal[]): ShadowCheck[] {
  return reveals.map((reveal) => {
    const index = question.parts.findIndex((part) => part.id === reveal.partId);
    if (index < 0) return check(`reveal-order:${reveal.partId}`, false, "Reveal names an unknown part.");
    const earlier = numeralTokens([blockPlainText(question.stem), ...question.parts.slice(0, index).map((_, partIndex) => partText(question, partIndex))].join("\n"));
    const leaked = reveal.tokens.filter((token) => earlier.includes(token));
    const shown = numeralTokens(partText(question, index));
    const missing = reveal.tokens.filter((token) => !shown.includes(token));
    if (leaked.length > 0) return check(`reveal-order:${reveal.partId}`, false, `Visible before part ${reveal.partId}: ${leaked.join(", ")}`);
    if (missing.length > 0) return check(`reveal-order:${reveal.partId}`, false, `Not printed in part ${reveal.partId}: ${missing.join(", ")}`);
    return check(`reveal-order:${reveal.partId}`, true);
  });
}

export function checkStructure(template: Pick<ShadowTemplate, "structure">, question: ShadowQuestionDocument, solution: ShadowSolution): ShadowCheck[] {
  const expected = template.structure.map((part) => `${part.partId}:${part.marks}`).join(",");
  const printed = question.parts.map((part) => `${part.id}:${part.marks}`).join(",");
  const scheme = solution.parts.map((part) => `${part.partId}:${part.marks}`).join(",");
  return [
    check("structure:question-matches-source", printed === expected, `Expected ${expected}, printed ${printed}`),
    check("structure:scheme-matches-question", scheme === printed, `Question ${printed}, scheme ${scheme}`),
    check("structure:total-marks", question.totalMarks === template.structure.reduce((sum, part) => sum + part.marks, 0)),
  ];
}

export function buildValidationReport(checks: ShadowCheck[]): ShadowValidationReport {
  const trimmed = checks.slice(0, 80).map((entry) => ({
    name: entry.name.slice(0, 80),
    ok: entry.ok,
    ...(entry.detail && !entry.ok ? { detail: entry.detail.slice(0, 400) } : {}),
  }));
  return { ok: checks.every((entry) => entry.ok), checks: trimmed.length > 0 ? trimmed : [{ name: "no-checks", ok: false }] };
}

export function validateUnit(
  template: AnyShadowTemplate,
  parameters: ShadowParameters,
  derived: unknown,
  question: ShadowQuestionDocument,
  solution: ShadowSolution,
): ShadowValidationReport {
  const checks: ShadowCheck[] = [
    schemaCheck("schema:question", questionDocumentSchema.safeParse(question)),
    schemaCheck("schema:solution", solutionSchema.safeParse(solution)),
    ...checkStructure(template, question, solution),
    ...checkRevealOrder(question, template.reveals?.(parameters, derived) ?? []),
  ];
  if (checks.every((entry) => entry.ok)) {
    try {
      checks.push(...template.verify(parameters, derived, question, solution));
    } catch (error) {
      checks.push(check("verify:threw", false, error instanceof Error ? error.message : String(error)));
    }
  }
  return buildValidationReport(checks);
}
