import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defectCodes,
  parsePaperRepairCases,
  verifyReportSnapshot,
  verifySourceHashes,
} from "./paper-repair-case";

const configPath = resolve(process.cwd(), "config/paper-generation/root-cause-cases.json");
const parseJson = (text: string): unknown => JSON.parse(text);
const realCases = parseJson(readFileSync(configPath, "utf8"));
const hash = "a".repeat(64);
const validCase = {
  id: "identity-collapse-1",
  defectCode: "identity-collapse",
  status: "UNPROVEN",
  reportPath: "qa-reports/run/subject/paper-1/report.json",
  subject: "subject",
  tier: "higher",
  paperIndex: 0,
  seed: 1,
  resolvedRequestedMarks: 40,
  selectedUnitKeys: ["source.pdf::q1"],
  selectedSourceQuestionKeys: ["source::q1"],
  selectedUnitMarks: [40],
  totalMarks: 40,
  sourcePdfs: [{ path: "data/source.pdf", sha256: hash, selectedUnitKeys: ["source.pdf::q1"] }],
  auditedPageOwnership: [{ page: 1, role: "audited output page", unitKey: "source.pdf::q1" }],
  artifactEvidence: [{ path: "qa-reports/run/subject/paper-1/page-01.png", kind: "screenshot", available: true, page: 1, note: "Evidence" }],
  sentinel: false,
};

function withClasses(value: typeof validCase) {
  return defectCodes.flatMap((defectCode) => [
    { ...value, id: `${defectCode}-case`, defectCode },
    { ...value, id: `${defectCode}-sentinel`, defectCode, sentinel: true, sentinelInvariant: "Class-specific invariant" },
  ]);
}

describe("paper repair cases", () => {
  it("parses every defect class with an affected case and sentinel", () => {
    expect(parsePaperRepairCases(withClasses(validCase))).toHaveLength(defectCodes.length * 2);
  });

  it("rejects duplicate identities, missing hashes, and unsupported codes", () => {
    expect(() => parsePaperRepairCases([{ ...validCase, selectedUnitKeys: ["source.pdf::q1", "source.pdf::q1"], selectedSourceQuestionKeys: ["source::q1", "source::q1"], selectedUnitMarks: [20, 20], totalMarks: 40, sourcePdfs: [{ ...validCase.sourcePdfs[0], selectedUnitKeys: ["source.pdf::q1"] }] }])).toThrow(/duplicate/i);
    expect(() => parsePaperRepairCases([{ ...validCase, sourcePdfs: [{ ...validCase.sourcePdfs[0], sha256: "" }] }])).toThrow();
    expect(() => parsePaperRepairCases([{ ...validCase, defectCode: "not-a-real-defect" }])).toThrow();
  });

  it("rejects changed verified sources", () => {
    const parsed = parsePaperRepairCases(withClasses(validCase));
    expect(() => verifySourceHashes(parsed[0], new Map([["data/source.pdf", "b".repeat(64)]]))).toThrow(/changed/i);
  });

  it("rejects cross-field mismatches", () => {
    expect(() => parsePaperRepairCases([{ ...validCase, selectedUnitMarks: [39] }])).toThrow(/total/i);
    expect(() => parsePaperRepairCases([{ ...validCase, auditedPageOwnership: [{ page: 1, role: "audited output page", unitKey: "other" }] }])).toThrow(/ownership/i);
  });

  it("loads the checked-in corpus and verifies every report and source hash", () => {
    const cases = parsePaperRepairCases(realCases);
    const hashes = new Map<string, string>();
    for (const repairCase of cases) {
      expect(existsSync(resolve(process.cwd(), repairCase.reportPath))).toBe(true);
      const report = parseJson(readFileSync(resolve(process.cwd(), repairCase.reportPath), "utf8"));
      verifyReportSnapshot(repairCase, report);
      if (typeof report !== "object" || report === null || !("pageCount" in report) || typeof report.pageCount !== "number") throw new Error("Report has no page count");
      const expectedDirectory = `/${repairCase.subject}${repairCase.tier ? `-${repairCase.tier}` : ""}/paper-${repairCase.paperIndex + 1}/`;
      expect(`/${repairCase.reportPath}`).toContain(expectedDirectory);
      for (const owner of repairCase.auditedPageOwnership) expect(owner.page).toBeLessThanOrEqual(report.pageCount);
      for (const source of repairCase.sourcePdfs) {
        expect(existsSync(resolve(process.cwd(), source.path))).toBe(true);
        hashes.set(source.path, createHash("sha256").update(readFileSync(resolve(process.cwd(), source.path))).digest("hex"));
      }
      for (const artifact of repairCase.artifactEvidence) {
        expect(existsSync(resolve(process.cwd(), artifact.path))).toBe(true);
        expect(`/${artifact.path}`).toContain(expectedDirectory);
        if (artifact.page !== undefined) expect(artifact.page).toBeLessThanOrEqual(report.pageCount);
      }
    }
    for (const repairCase of cases) verifySourceHashes(repairCase, hashes);
    expect(cases.length).toBeGreaterThan(30);
  });

  it("rejects a defect class without an unaffected sentinel", () => {
    expect(() => parsePaperRepairCases(withClasses(validCase).filter((repairCase) => repairCase.defectCode !== "column-drift" || !repairCase.sentinel))).toThrow(/sentinel/i);
  });
});
