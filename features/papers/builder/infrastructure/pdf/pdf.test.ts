import { describe, expect, it } from "vitest";

import type { QuestionUnit } from "@/shared/domain/paper";
import { filterUnitsByFigureResolvability } from "../../domain/integrity";
import { buildUnitRenderPlan, getReferencedFigureLabels } from "../../domain/region-render";
import { expandScienceCropToReferencedFigures } from "./pdf";
import { extendComputerScienceAnswerGeometryCropBox } from "./pdf";
import { findMathUnitStartLine } from "./pdf";
import { getFooterFloor } from "./pdf";
import { formatGeneratedAqaMarker } from "./pdf";
import { isOcrAdditionalAnswerPage } from "./pdf";
import { padScienceCropBox } from "./pdf";
import { resolveContentHorizontalBounds } from "./pdf";
import { resolveMathHorizontalCropBounds } from "./pdf";
import { shouldSanitizeSourcePageForGeneratedIdentity } from "./pdf";
import { trimScienceRegionCropBox } from "./pdf";
import { trimSourceFooterCropBox } from "./pdf";

describe("generated question identity", () => {
  it("sanitizes Business source labels before drawing generated numbering", () => {
    const unit = {
      boardCode: "edexcel",
      subjectSlug: "business",
    };

    expect(shouldSanitizeSourcePageForGeneratedIdentity(unit)).toBe(true);
  });

  it("sanitizes science source furniture before drawing generated identity", () => {
    expect(shouldSanitizeSourcePageForGeneratedIdentity({
      boardCode: "edexcel",
      subjectSlug: "biology",
    })).toBe(true);
  });

  it("sanitizes AQA English source furniture before drawing generated identity", () => {
    expect(shouldSanitizeSourcePageForGeneratedIdentity({
      boardCode: "aqa",
      subjectSlug: "english-language",
    })).toBe(true);
  });

  it("replaces an English Literature compound source marker with the generated question number", () => {
    const unit = {
      subjectSlug: "english-literature",
    };

    expect(formatGeneratedAqaMarker(unit, 1, "2")).toBe("1.");
  });
});

describe("Maths crop discovery", () => {
  it("uses the question part that belongs to a continuation page", () => {
    const page = {
      page_number: 7,
      page_text: "(b) Work out the total surface area of the pyramid.",
      text_lines: [{
        text: "(b) Work out the total surface area of the pyramid.",
        y: 771,
        bbox: { x0: 60, y0: 771, x1: 306, y1: 783 },
      }],
    };
    const unit = {
      questionNumber: "5",
      parts: [
        {
          questionNumber: "5",
          questionPartNumber: "a",
          promptText: "5 Here is a solid square-based pyramid",
          pageNumbers: [6],
        },
        {
          questionNumber: "5",
          questionPartNumber: "b",
          promptText: "(b) Work out the total surface area of the pyramid.",
          pageNumbers: [7],
        },
      ],
    } as QuestionUnit;

    expect(findMathUnitStartLine(page, unit)?.text).toBe("(b) Work out the total surface area of the pyramid.");
  });

  it("keeps a left-edge graph label without widening to the full source page", () => {
    const bounds = resolveMathHorizontalCropBounds([
      { bbox: { x0: 75.24, x1: 131.24 } },
      { bbox: { x0: 153.96, x1: 506.41 } },
    ], 595.28, [], 40);

    expect(bounds.left).toBeCloseTo(35.24);
    expect(bounds.right).toBeCloseTo(546.41);
  });

  it("keeps a right-edge answer unit without widening to the full source page", () => {
    const bounds = resolveMathHorizontalCropBounds([
      { bbox: { x0: 42.48, x1: 425.42 } },
      { bbox: { x0: 398.02, x1: 552.74 } },
    ], 595.28);

    expect(bounds.left).toBeCloseTo(26.48);
    expect(bounds.right).toBeCloseTo(568.74);
  });
});

describe("source furniture crop bounds", () => {
  it("derives horizontal bounds from protected content rather than the furniture lane", () => {
    expect(resolveContentHorizontalBounds(
      { left: 0, right: 600, bottom: 0, top: 800 },
      [{ left: 104, right: 512 }, { left: 96, right: 520 }],
      40,
    )).toEqual({ left: 56, right: 560, bottom: 0, top: 800 });
  });
});

describe("computer science answer geometry", () => {
  const crop = { left: 0, right: 595, bottom: 634, top: 783 };

  it("includes empty high-mark answer geometry owned by the unit", () => {
    expect(extendComputerScienceAnswerGeometryCropBox(crop, 56, 5, true, [
      { text: "© OCR 2022", y: 56, bbox: { x0: 60, y0: 54, x1: 120, y1: 64 } },
    ])).toEqual({ ...crop, bottom: 56 });
  });

  it("does not include a sibling question below the selected span", () => {
    expect(extendComputerScienceAnswerGeometryCropBox(crop, 56, 5, true, [
      { text: "4 A different question", y: 310, bbox: { x0: 60, y0: 300, x1: 260, y1: 320 } },
    ])).toEqual(crop);
  });

  it("does not expand short text answers", () => {
    expect(extendComputerScienceAnswerGeometryCropBox(crop, 56, 2, true, [])).toEqual(crop);
  });

  it("does not expand written high-mark answers", () => {
    expect(extendComputerScienceAnswerGeometryCropBox(crop, 56, 6, false, [])).toEqual(crop);
  });
});

describe("OCR additional answer pages", () => {
  it("ignores the copyright block on the final lined answer page", () => {
    expect(isOcrAdditionalAnswerPage([
      "20",
      "........................................................................",
      "........................................................................",
      "Oxford Cambridge and RSA",
      "Copyright Information",
      "OCR is committed to seeking permission to reproduce third-party content.",
    ])).toBe(true);
  });

  it("keeps a real question page that ends with copyright furniture", () => {
    expect(isOcrAdditionalAnswerPage([
      "16",
      "Write an algorithm to output the winning team.",
      "........................................................................",
      "© OCR 2024",
    ])).toBe(false);
  });

  it("keeps real content immediately before the copyright block", () => {
    expect(isOcrAdditionalAnswerPage([
      "20",
      "State one benefit of abstraction.",
      "Copyright Information",
      "OCR is committed to seeking permission to reproduce third-party content.",
    ])).toBe(false);
  });
});

describe("expandScienceCropToReferencedFigures", () => {
  it("includes the full matching figure geometry with a safe margin", () => {
    const crop = expandScienceCropToReferencedFigures(
      { left: 0, right: 595, bottom: 460, top: 600 },
      21,
      595,
      842,
      ["Figure 12"],
      [{ label: "Figure 12", pageNumber: 21, yTop: 817.8895, yBottom: 442.5559 }],
      [],
    );

    expect(crop).toEqual({ left: 0, right: 595, bottom: 434.5559, top: 825.8895 });
  });

  it("leaves crops without a matching figure unchanged", () => {
    const crop = { left: 0, right: 595, bottom: 460, top: 600 };

    expect(expandScienceCropToReferencedFigures(crop, 21, 595, 842, ["Figure 11"], [{ label: "Figure 12", pageNumber: 21, yTop: 817, yBottom: 443 }], [])).toBe(crop);
  });

  it("ignores siblings in another column", () => {
    const crop = expandScienceCropToReferencedFigures(
      { left: 0, right: 280, bottom: 460, top: 600 },
      21,
      595,
      842,
      ["Figure 12"],
      [{ label: "Figure 12", pageNumber: 21, yTop: 817, yBottom: 443 }],
      [{ left: 315, right: 595, bottom: 700, top: 820 }],
    );

    expect(crop.top).toBe(825);
  });

});


describe("science figure ownership", () => {
  const scienceUnit = {
    unitKey: "science.pdf::q1",
    sourceRelativePath: "science.pdf",
    subjectSlug: "combined-science",
    parts: [{
      promptText: "Use Figure 6 to answer the question.",
      contextText: "Figure 8 shows the results.",
      pageNumbers: [2],
    }],
  } as QuestionUnit;

  it("expands a crop to a letter-labelled figure", () => {
    expect(expandScienceCropToReferencedFigures(
      { left: 0, right: 595, bottom: 460, top: 600 },
      2,
      595,
      842,
      ["Figure A"],
      [{ label: "figure a", pageNumber: 2, yTop: 760, yBottom: 420 }],
      [],
    )).toEqual({ left: 0, right: 595, bottom: 412, top: 768 });
  });

  it("matches normalized geometry labels when planning figure crops", () => {
    const unit = {
      ...scienceUnit,
      parts: [{
        promptText: "Use Figure 6.",
        referencedFigures: ["Figure 6"],
        pageNumbers: [2],
        regionSpans: [{ pageNumber: 2, yTop: 700, yBottom: 500 }],
      }],
    } as QuestionUnit;
    const layouts = new Map([
      [1, { pageNumber: 1, pageWidth: 595, pageHeight: 842, contentX0: 0, contentX1: 595, headerFloorY: 820, footerCeilingY: 20 }],
      [2, { pageNumber: 2, pageWidth: 595, pageHeight: 842, contentX0: 0, contentX1: 595, headerFloorY: 820, footerCeilingY: 20 }],
    ]);

    expect(buildUnitRenderPlan(unit, layouts, [{ label: " figure 6 ", pageNumber: 1, yTop: 700, yBottom: 500 }]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ pageNumber: 1, kind: "figure" })]));
  });

  it("discovers figure references when structured metadata is absent", () => {
    expect(getReferencedFigureLabels(scienceUnit)).toEqual(["Figure 6", "Figure 8"]);
  });

  it("normalizes number-and-letter figure labels across text and geometry", () => {
    const unit = {
      ...scienceUnit,
      parts: [{
        promptText: "Use Figure 1a.",
        referencedFigures: ["Figure 1A"],
        pageNumbers: [2],
      }],
    } as QuestionUnit;
    const labels = getReferencedFigureLabels(unit);

    expect(labels).toEqual(["Figure 1A"]);
    expect(expandScienceCropToReferencedFigures(
      { left: 0, right: 595, bottom: 460, top: 600 },
      2,
      595,
      842,
      labels,
      [{ label: "figure 1a", pageNumber: 2, yTop: 760, yBottom: 420 }],
      [],
    )).toEqual({ left: 0, right: 595, bottom: 412, top: 768 });
  });

  it("rejects a legacy science unit when referenced figure geometry is absent", () => {
    const result = filterUnitsByFigureResolvability([scienceUnit], {
      figuresBySource: new Map(),
      pageLayoutsBySource: new Map(),
      subjectUsesInserts: false,
    });

    expect(result.kept).toEqual([]);
    expect(result.excluded).toEqual([{
      unitKey: "science.pdf::q1",
      missingFigures: ["Figure 6", "Figure 8"],
    }]);
  });

  it("keeps a legacy science unit when every referenced figure has geometry", () => {
    const result = filterUnitsByFigureResolvability([scienceUnit], {
      figuresBySource: new Map([["science.pdf", [
        { label: " figure 6 ", pageNumber: 2, yTop: 700, yBottom: 500 },
        { label: "FIGURE 8", pageNumber: 2, yTop: 450, yBottom: 250 },
      ]]]),
      pageLayoutsBySource: new Map(),
      subjectUsesInserts: false,
    });

    expect(result.kept).toEqual([scienceUnit]);
    expect(result.excluded).toEqual([]);
  });

  it("still rejects unresolved figures for non-science region units", () => {
    const unit = {
      ...scienceUnit,
      subjectSlug: "geography",
      parts: [{
        promptText: "Use Figure 6.",
        pageNumbers: [2],
        regionSpans: [{ pageNumber: 2, yTop: 700, yBottom: 500 }],
      }],
    } as QuestionUnit;
    const pageLayoutsBySource = new Map([["science.pdf", [
      { pageNumber: 2, pageWidth: 595, pageHeight: 842, contentX0: 0, contentX1: 595, headerFloorY: 820, footerCeilingY: 20 },
    ]]])

    expect(filterUnitsByFigureResolvability([unit], {
      figuresBySource: new Map(),
      pageLayoutsBySource,
      subjectUsesInserts: false,
    }).excluded).toEqual([{ unitKey: "science.pdf::q1", missingFigures: ["Figure 6"] }]);
  });

  it("keeps unresolved references when the subject provides figures through inserts", () => {
    const result = filterUnitsByFigureResolvability([scienceUnit], {
      figuresBySource: new Map(),
      pageLayoutsBySource: new Map(),
      subjectUsesInserts: true,
    });

    expect(result.kept).toEqual([scienceUnit]);
    expect(result.excluded).toEqual([]);
  });

});

describe("science footer trimming", () => {
  it("does not treat a graph axis tick as a page number", () => {
    const unit = {
      boardCode: "edexcel",
      subjectSlug: "combined-science",
      sourceRelativePath: "edexcel/combined-science/foundation/000618-2020-chemistry-2-question_paper-june-202020-20qp-20-20chemistry-202-20-f-20edexcel-20science-20gcse-pdf.pdf",
    } as QuestionUnit;
    const crop = { left: 0, right: 595.2755, bottom: 235.5625, top: 822.874 };

    expect(trimSourceFooterCropBox(unit, 17, crop)).toEqual(crop);
  });

  it("does not treat a response mark label as footer furniture", () => {
    const page = {
      page_number: 17,
      page_text: "(1) *P62098A01724* Turn over",
      text_lines: [
        { text: "(1)", y: 204.8, bbox: { x0: 524, y0: 204.8, x1: 539, y1: 216.8 } },
        { text: "*P62098A01724* Turn over", y: 42.6, bbox: { x0: 210, y0: 42, x1: 577, y1: 68.6 } },
      ],
    };

    expect(getFooterFloor(page, 842)).toBeCloseTo(76.6);
  });

  it("preserves the final response line above a source total", () => {
    const unit = {
      boardCode: "edexcel",
      subjectSlug: "combined-science",
      sourceRelativePath: "edexcel/combined-science/foundation/000618-2020-chemistry-2-question_paper-june-202020-20qp-20-20chemistry-202-20-f-20edexcel-20science-20gcse-pdf.pdf",
      questionNumber: "5",
    } as QuestionUnit;

    const crop = trimScienceRegionCropBox(unit, {
      pageNumber: 17,
      cropBox: { left: 0, right: 595.2755, bottom: 76.6, top: 822.874 },
      kind: "question",
    });

    expect(crop.bottom).toBeCloseTo(76.6);
  });
});

describe("science crop padding", () => {
  it("keeps glyphs that extend beyond extracted text bounds", () => {
    expect(padScienceCropBox({ left: 70.8661, right: 538.5781, bottom: 68, top: 822 }, 595.2755)).toEqual({
      left: 62.8661,
      right: 546.5781,
      bottom: 68,
      top: 822,
    });
  });
});
