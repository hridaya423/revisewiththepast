import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { PAPER_MAKER_SUBJECTS } from "@/shared/domain/subject-catalog";
import { GENERATED_PAGE } from "../../domain/generated-layout";
import { setGeneratedPageRole } from "../pdf/page-chrome";
import { assertGeneratedPaperForGeneration } from "./generate";

describe("paper generation routing", () => {
  it("declares a canonical route for every generation-enabled subject", () => {
    const source = readFileSync(new URL("./generate.ts", import.meta.url), "utf8");
    const configStart = source.indexOf("const SUBJECT_GENERATION_CONFIGS");
    const config = source.slice(configStart, source.indexOf("function makeSeparateScienceConfig", configStart));
    const enabled = PAPER_MAKER_SUBJECTS.filter((subject) => subject.generationEnabled);

    for (const subject of enabled) {
      expect(config).toContain(`\"${subject.key}\"`);
    }
    expect(source).toContain("generateStrictSourcePaperPdf");
    expect(source).not.toContain("PAPER_MAKER_REGION_MODE");
    expect(source).not.toContain('subject.subjectSlug === "mathematics"');
  });

  it("runs the post-generation QA boundary for every enabled subject", async () => {
    const calls: string[] = [];
    const pdf = await makeMisalignedPaper();

    for (const subject of PAPER_MAKER_SUBJECTS.filter((candidate) => candidate.generationEnabled)) {
      await expect(assertGeneratedPaperForGeneration(pdf, {
        subjectKey: subject.key,
        totalMarks: 1,
        selectedUnitCount: 1,
        selectedUnitMarks: [1],
        coverPage: { totalMarks: 1, timeMinutes: 1, questionCount: 1 },
      }, async (_bytes, options) => {
        calls.push(options.subjectKey ?? "");
        expect(options.expectedOrdinalCount).toBe(options.selectedUnitCount);
        throw new Error("known ordinal defect");
      })).rejects.toThrow("known ordinal defect");
    }

    expect(calls).toEqual(PAPER_MAKER_SUBJECTS
      .filter((subject) => subject.generationEnabled)
      .map((subject) => subject.key));
  });

  it("rejects a known ordinal defect for every enabled subject", async () => {
    const pdf = await makeMisalignedPaper();

    for (const subject of PAPER_MAKER_SUBJECTS.filter((candidate) => candidate.generationEnabled)) {
      await expect(assertGeneratedPaperForGeneration(pdf, {
        subjectKey: subject.key,
        totalMarks: 1,
        selectedUnitCount: 1,
        selectedUnitMarks: [1],
        coverPage: { totalMarks: 1, timeMinutes: 1, questionCount: 1 },
      })).rejects.toThrow(/x position/);
    }
  });
});

async function makeMisalignedPaper() {
  const document = await PDFDocument.create();
  const page = document.addPage([GENERATED_PAGE.width, GENERATED_PAGE.height]);
  setGeneratedPageRole(page, "question-content");
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("1", { x: GENERATED_PAGE.numberX + 2, y: 700, size: GENERATED_PAGE.numberFontSize, font });
  return new Uint8Array(await document.save());
}
