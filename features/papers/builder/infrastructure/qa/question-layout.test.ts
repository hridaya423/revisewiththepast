import { describe, expect, it } from "vitest";
import { degrees, PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { checkQuestionLayout } from "./question-layout";
import { GENERATED_PAGE } from "../../domain/generated-layout";
import { setGeneratedPageRole } from "../pdf/page-chrome";

async function makePdf(pages: Array<{ role?: "question-content" | "answer-space"; ordinals: Array<{ value: string; x?: number; y?: number; rotate?: number }>; contentX?: number; contentY?: number; furniture?: string }>) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const pageInput of [{ ordinals: [] }, ...pages]) {
    const page = document.addPage([GENERATED_PAGE.width, GENERATED_PAGE.height]);
    if (pageInput.role) setGeneratedPageRole(page, pageInput.role);
    for (const ordinal of pageInput.ordinals) {
      page.drawText(ordinal.value, {
        x: ordinal.x ?? GENERATED_PAGE.numberX,
        y: ordinal.y ?? 700,
        size: GENERATED_PAGE.numberFontSize,
        font,
        color: rgb(0, 0, 0),
        rotate: ordinal.rotate === undefined ? undefined : degrees(ordinal.rotate),
      });
    }
    if (pageInput.furniture) page.drawText(pageInput.furniture, { x: 8, y: 700, size: 9, font, color: rgb(0, 0, 0) });
    if (pageInput.contentX !== undefined) {
      page.drawText("Describe the answer", {
        x: pageInput.contentX,
        y: pageInput.contentY ?? 700,
        size: 12,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }
  return new Uint8Array(await document.save());
}

describe("generated question layout QA", () => {
  it("accepts canonical ordinals across multiple pages", async () => {
    const pdf = await makePdf([
       { role: "question-content", ordinals: [{ value: "1" }] },
       { role: "question-content", ordinals: [{ value: "2" }] },
    ]);

    expect(await checkQuestionLayout(pdf, { selectedUnitCount: 2 })).toEqual([]);
  });

  it("rejects an ordinal whose x position drifts from the canonical gutter", async () => {
    const pdf = await makePdf([{ role: "question-content", ordinals: [{ value: "1", x: GENERATED_PAGE.numberX + 2 }] }]);

    expect(await checkQuestionLayout(pdf, { expectedOrdinalCount: 1 })).toEqual([
      expect.objectContaining({ check: "question-layout", severity: "error", message: expect.stringContaining("x position") }),
    ]);
  });

  it("rejects duplicate ordinals", async () => {
    const pdf = await makePdf([{ role: "question-content", ordinals: [{ value: "1" }, { value: "1", y: 650 }] }]);

    expect(await checkQuestionLayout(pdf, { expectedOrdinalCount: 1 })).toEqual([
      expect.objectContaining({ message: expect.stringContaining("appears 2 times") }),
    ]);
  });

  it("rejects missing and unexpected ordinals", async () => {
    const pdf = await makePdf([{ role: "question-content", ordinals: [{ value: "3" }] }]);

    expect(await checkQuestionLayout(pdf, { expectedOrdinalCount: 2 })).toEqual([
      expect.objectContaining({ message: expect.stringContaining("missing ordinal 1") }),
      expect.objectContaining({ message: expect.stringContaining("missing ordinal 2") }),
      expect.objectContaining({ message: expect.stringContaining("unexpected ordinal 3") }),
    ]);
  });

  it("rejects an ordinal that overlaps content text", async () => {
    const pdf = await makePdf([{
      role: "question-content",
      ordinals: [{ value: "1", x: GENERATED_PAGE.contentLeft - 1 }],
      contentX: GENERATED_PAGE.contentLeft,
    }]);

    expect(await checkQuestionLayout(pdf, { expectedOrdinalCount: 1 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining("overlaps content") }),
    ]));
  });

  it("rejects an ordinal outside generated page bounds", async () => {
    const pdf = await makePdf([{ role: "question-content", ordinals: [{ value: "1", x: -1 }] }]);

    expect(await checkQuestionLayout(pdf, { expectedOrdinalCount: 1 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining("outside generated page bounds") }),
    ]));
  });

  it("ignores numeric text on preface and answer pages", async () => {
    const pdf = await makePdf([
      { ordinals: [{ value: "1" }] },
      { role: "answer-space", ordinals: [{ value: "1" }] },
      { role: "question-content", ordinals: [{ value: "1" }, { value: "2", y: 650 }] },
    ]);

    expect(await checkQuestionLayout(pdf, { expectedOrdinalCount: 2 })).toEqual([]);
  });

  it("uses transformed bounds for rotated ordinal and furniture checks", async () => {
    const pdf = await makePdf([{
      role: "question-content",
      ordinals: [{ value: "1", x: 70, rotate: 90 }],
      furniture: "TURN OVER FOR NEXT QUESTION",
    }]);

    expect(await checkQuestionLayout(pdf, { expectedOrdinalCount: 1 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining("outside the generated number column") }),
      expect.objectContaining({ message: expect.stringContaining("warning") }),
    ]));
  });
});
