import { describe, expect, it } from "vitest";
import {
  assignQuestionIdentityAnchors,
  discoverGroupedQuestionIdentityAnchors,
  discoverQuestionIdentityAnchor,
  discoverSplitQuestionIdentityAnchor,
  hasDuplicateQuestionPartNumbers,
  type IdentityAnchorPage,
} from "./question-identity-anchor";

const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
const page = (pageNumber: number, lines: IdentityAnchorPage["lines"]): IdentityAnchorPage => ({ pageNumber, lines });
const line = (spans: Array<[string, number, number, number]>, y: number) => ({
  text: spans.map(([text]) => text).join(" "),
  y,
  bbox: box(spans[0][1], y, spans[spans.length - 1][1] + spans[spans.length - 1][2], y + 12),
  spans: spans.map(([text, x, width]) => ({ text, bbox: box(x, y, x + width, y + 12) })),
});

describe("discoverQuestionIdentityAnchor", () => {
  it("extracts a standalone marker and the next meaningful line", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "geography",
      questionNumber: "2",
      pages: [page(4, [line([["2", 42, 8, 0]], 650), line([["Explain how the data changes.", 42, 178, 0]], 630)])],
    })).toEqual({
      status: "found",
      anchor: { pageNumber: 4, numberBounds: box(42, 650, 50, 662), promptBaseline: 630, promptBounds: box(42, 630, 220, 642) },
    });
  });

  it("clamps an extracted prompt baseline to its prompt bounds", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "aqa",
      subjectSlug: "english-literature",
      questionNumber: "7",
      questionPartNumber: "2",
      pages: [page(13, [
        line([["0", 52, 6, 0], ["7 .", 69, 18, 0], ["2", 94, 6, 0]], 490),
        { text: "Explore the presentation of conflict.", y: 460, bbox: { x0: 119, y0: 462, x1: 400, y1: 474 }, spans: [{ text: "Explore the presentation of conflict.", bbox: { x0: 119, y0: 462, x1: 400, y1: 474 } }] },
      ])],
    })).toMatchObject({
      status: "found",
      anchor: { promptBaseline: 462, promptBounds: { y0: 462, y1: 474 } },
    });
  });

  it("clamps a same-line prompt baseline to its prompt spans", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "aqa",
      subjectSlug: "geography",
      questionNumber: "1",
      questionPartNumber: "2",
      pages: [page(2, [{
        text: "0 1 . 2 Explain the trend.",
        y: 368.8,
        bbox: box(52, 368.8, 260, 380),
        spans: [
          { text: "0", bbox: box(52, 368.8, 58, 379.8) },
          { text: "1 .", bbox: box(69, 368.8, 87, 379.8) },
          { text: "2", bbox: box(94, 368.8, 100, 379.8) },
          { text: "Explain the trend.", bbox: box(133, 369, 260, 380) },
        ],
      }])],
    })).toMatchObject({
      status: "found",
      anchor: { promptBaseline: 369, promptBounds: { y0: 369, y1: 380 } },
    });
  });

  it("uses separate inline Maths marker and prompt spans", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "mathematics",
      questionNumber: "12",
      pages: [page(2, [line([["12.", 54, 24, 0], ["Calculate the missing angle.", 82, 158, 0]], 610)])],
    })).toEqual({
      status: "found",
      anchor: { pageNumber: 2, numberBounds: box(54, 610, 78, 622), promptBaseline: 610, promptBounds: box(82, 610, 240, 622) },
    });
  });

  it("anchors a standalone two-digit question instead of treating it as furniture", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "geography",
      questionNumber: "12",
      pages: [page(2, [line([["12", 42, 16, 0]], 650), line([["Explain the pattern.", 42, 150, 0]], 630)])],
    })).toEqual({
      status: "found",
      anchor: { pageNumber: 2, numberBounds: box(42, 650, 58, 662), promptBaseline: 630, promptBounds: box(42, 630, 192, 642) },
    });
  });

  it("accepts a Maths question whose prompt starts with a formula", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "mathematics",
      questionNumber: "13",
      pages: [page(14, [line([["13", 42, 16, 0], ["5(8 + 18) can be written", 64, 160, 0]], 360)])],
      candidateRegion: { yTop: 380, yBottom: 300 },
    })).toMatchObject({ status: "found", anchor: { numberBounds: { x0: 42, x1: 58 } } });
  });

  it("does not treat an uppercase answer option as a bare lowercase part marker", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "biology",
      questionNumber: "2",
      questionPartNumber: "a",
      pages: [page(4, [
        line([["(a)", 82, 18, 0], ["What is the shape?", 108, 120, 0]], 538),
        line([["A", 115, 8, 0], ["single helix", 132, 70, 0]], 510),
      ])],
      candidateRegion: { yTop: 552, yBottom: 428 },
    })).toMatchObject({ status: "found", anchor: { numberBounds: { y0: 538 } } });
  });

  it("uses the full composite part prefix when nested labels share one span", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "biology",
      questionNumber: "2",
      questionPartNumber: "a",
      pages: [page(4, [line([["(a) (i)", 82, 28, 0], ["What is the shape?", 116, 120, 0]], 538)])],
      candidateRegion: { yTop: 552, yBottom: 428 },
    })).toEqual({
      status: "found",
      anchor: { pageNumber: 4, numberBounds: box(82, 538, 110, 550), promptBaseline: 538, promptBounds: box(116, 538, 236, 550) },
    });
  });

  it("combines an exact stem number with an inseparable first prompt line", () => {
    expect(discoverSplitQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "mathematics",
      questionNumber: "5",
      questionPartNumber: "a",
      pages: [page(6, [
        line([["5", 42, 8, 0], ["Here is a pyramid.", 60, 120, 0]], 700),
        line([["(a) Draw an accurate front elevation.", 60, 220, 0]], 440),
      ])],
      pageNumber: 6,
      numberRegion: { yTop: 720, yBottom: 500 },
      promptRegion: { yTop: 460, yBottom: 300 },
    })).toEqual({
      status: "found",
      anchor: {
        pageNumber: 6,
        numberBounds: box(42, 700, 50, 712),
        promptBaseline: 440,
        promptBounds: box(60, 440, 280, 452),
      },
    });
  });

  it("reports which half of a split anchor is missing", () => {
    expect(discoverSplitQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "mathematics",
      questionNumber: "5",
      questionPartNumber: "a",
      pages: [page(6, [line([["(a) Draw the elevation.", 60, 160, 0]], 440)])],
      pageNumber: 6,
      numberRegion: { yTop: 720, yBottom: 500 },
      promptRegion: { yTop: 460, yBottom: 300 },
    })).toEqual({ status: "missing", reason: "split stem number marker is unavailable" });
  });

  it("finds a split prompt after leading furniture spans", () => {
    expect(discoverSplitQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "combined-science",
      questionNumber: "5",
      questionPartNumber: "i",
      pages: [page(15, [
        line([["5", 64, 8, 0], ["Figure 9 shows cells.", 82, 130, 0]], 740),
        line([["DO NOT WRITE IN THIS AREA", 6, 140, 0], ["(i)", 98, 10, 0], ["These cells are animal cells.", 116, 150, 0]], 580),
      ])],
      pageNumber: 15,
      numberRegion: { yTop: 755, yBottom: 600 },
      promptRegion: { yTop: 596, yBottom: 448 },
    })).toMatchObject({
      status: "found",
      anchor: { numberBounds: { x0: 64 }, promptBaseline: 580, promptBounds: { x0: 116 } },
    });
  });

  it("uses the top-left stem marker when stem content repeats the question number", () => {
    expect(discoverSplitQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "mathematics",
      questionNumber: "6",
      questionPartNumber: "b",
      pages: [page(6, [
        line([["6", 42, 8, 0], ["The scatter graph shows", 60, 150, 0]], 700),
        line([["6", 148, 8, 0], ["kg", 164, 20, 0]], 590),
        line([["(b)", 60, 14, 0], ["Find an estimate.", 82, 110, 0]], 300),
      ])],
      pageNumber: 6,
      numberRegion: { yTop: 715, yBottom: 400 },
      promptRegion: { yTop: 315, yBottom: 200 },
    })).toMatchObject({
      status: "found",
      anchor: { numberBounds: { x0: 42, y0: 700 }, promptBounds: { x0: 82, y0: 300 } },
    });
  });

  it("uses the leftmost stem marker when a formula repeats the question number on the same line", () => {
    expect(discoverSplitQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "mathematics",
      questionNumber: "2",
      questionPartNumber: "a",
      pages: [page(2, [
        line([["2", 42, 8, 0], ["v", 60, 8, 0], ["2", 68, 8, 0], ["= u + 2as", 80, 80, 0]], 700),
        line([["(a)", 60, 14, 0], ["Work out v.", 82, 80, 0]], 620),
      ])],
      pageNumber: 2,
      numberRegion: { yTop: 715, yBottom: 680 },
      promptRegion: { yTop: 635, yBottom: 580 },
    })).toMatchObject({ status: "found", anchor: { numberBounds: { x0: 42 } } });
  });

  it("prefers a combined question and part heading over numeric content", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "chemistry",
      questionNumber: "2",
      questionPartNumber: "a",
      pages: [page(4, [
        line([["2", 42, 8, 0], ["(a)", 60, 14, 0], ["The molecular formula is", 82, 140, 0]], 680),
        line([["2", 110, 8, 0], ["moles", 126, 40, 0]], 640),
      ])],
      startPageNumber: 4,
      candidateRegion: { yTop: 695, yBottom: 500 },
    })).toMatchObject({
      status: "found",
      anchor: { numberBounds: { x0: 42, x1: 50 }, promptBounds: { x0: 60 } },
    });
  });

  it("uses the unique candidate on the exact region top edge", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "mathematics",
      questionNumber: "6",
      pages: [page(7, [
        line([["6", 42, 8, 0], ["A shop sells pens.", 60, 110, 0]], 680),
        line([["6", 110, 8, 0], ["pens in each pack", 126, 110, 0]], 640),
      ])],
      candidateRegion: { yTop: 695, yBottom: 500 },
    })).toMatchObject({ status: "found", anchor: { numberBounds: { x0: 42 } } });
  });

  it("finds a distant textual prompt within a diagram question region", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "mathematics",
      questionNumber: "21",
      pages: [page(21, [
        line([["21", 70, 12, 0]], 800),
        line([["y", 164, 6, 0]], 790),
        line([["O", 164, 8, 0]], 640),
        line([["The diagram shows a curve.", 89, 160, 0]], 492),
      ])],
      candidateRegion: { yTop: 815, yBottom: 300 },
    })).toMatchObject({ status: "found", anchor: { promptBaseline: 492, promptBounds: { x0: 89 } } });
  });

  it("prefers the left-margin Maths marker over a graph-axis value", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "mathematics",
      questionNumber: "7",
      pages: [page(8, [
        line([["7", 42, 8, 0]], 770),
        line([["7", 171, 8, 0]], 628),
        line([["Enlarge shape A by scale factor 2.", 70, 190, 0]], 320),
      ])],
      candidateRegion: { yTop: 820, yBottom: 280 },
    })).toMatchObject({ status: "found", anchor: { numberBounds: { x0: 42 } } });
  });

  it("prefers an exact Maths marker over an inseparable answer line", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "mathematics",
      questionNumber: "1",
      pages: [page(2, [
        line([["1", 42, 8, 0], ["The table shows weights.", 60, 140, 0]], 686),
        line([["1. ................................", 42, 220, 0]], 188),
      ])],
      candidateRegion: { yTop: 760, yBottom: 75 },
    })).toMatchObject({ status: "found", anchor: { numberBounds: { x0: 42, x1: 50 } } });
  });

  it("keeps a two-digit page-number collision ambiguous", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "geography",
      questionNumber: "12",
      pages: [page(2, [
        line([["12", 42, 16, 0]], 650),
        line([["Explain the pattern.", 42, 150, 0]], 630),
        line([["12", 42, 16, 0]], 40),
      ])],
    })).toMatchObject({ status: "ambiguous" });
  });

  it("excludes duplicate markers outside the question region", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "mathematics",
      questionNumber: "12",
      pages: [page(2, [
        line([["12", 42, 16, 0], ["Explain the pattern.", 64, 150, 0]], 650),
        line([["12", 42, 16, 0]], 40),
      ])],
      candidateRegion: { yTop: 700, yBottom: 100 },
    })).toEqual({
      status: "found",
      anchor: { pageNumber: 2, numberBounds: box(42, 650, 58, 662), promptBaseline: 650, promptBounds: box(64, 650, 214, 662) },
    });
  });

  it("keeps duplicate markers inside the question region ambiguous", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "aqa",
      subjectSlug: "english-literature",
      questionNumber: "8",
      pages: [page(14, [
        line([["0", 42, 8, 0], ["8", 54, 8, 0], ["Title", 70, 40, 0]], 250),
        line([["0", 42, 8, 0], ["8", 54, 8, 0], ["Starting with", 70, 80, 0]], 200),
      ])],
      candidateRegion: { yTop: 300, yBottom: 100 },
    })).toMatchObject({ status: "ambiguous" });
  });

  it("matches AQA spaced compound marker spans", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "aqa",
      subjectSlug: "geography",
      questionNumber: "5",
      questionPartNumber: "1",
      pages: [page(3, [line([["0", 38, 8, 0], ["5", 48, 8, 0], [".", 58, 4, 0], ["1", 66, 8, 0], ["Explain the process.", 84, 166, 0]], 570)])],
    })).toEqual({
      status: "found",
      anchor: { pageNumber: 3, numberBounds: box(38, 570, 74, 582), promptBaseline: 570, promptBounds: box(84, 570, 250, 582) },
    });
  });

  it.each([
    ["(b)", "b"],
    ["(iii)", "iii"],
  ])("finds a page-local part marker %s", (marker, questionPartNumber) => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "combined-science",
      questionNumber: "5",
      questionPartNumber,
      pages: [page(8, [line([[marker, 42, marker.length * 8, 0], ["Does this affect the result?", 82, 170, 0]], 570)])],
    })).toEqual({
      status: "found",
      anchor: {
        pageNumber: 8,
        numberBounds: box(42, 570, 42 + marker.length * 8, 582),
        promptBaseline: 570,
        promptBounds: box(82, 570, 252, 582),
      },
    });
  });

  it("prefers an AQA compound marker over a part-marker fallback", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "aqa",
      subjectSlug: "geography",
      questionNumber: "5",
      questionPartNumber: "1",
      pages: [page(3, [
        line([["(b)", 42, 24, 0], ["Fallback prompt.", 72, 110, 0]], 650),
        line([["5", 42, 8, 0], [".", 52, 4, 0], ["1", 60, 8, 0], ["Compound prompt.", 76, 120, 0]], 570),
      ])],
    })).toEqual({
      status: "found",
      anchor: { pageNumber: 3, numberBounds: box(42, 570, 68, 582), promptBaseline: 570, promptBounds: box(76, 570, 196, 582) },
    });
  });

  it("returns ambiguous when a requested part marker repeats on the page", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "mathematics",
      questionNumber: "3",
      questionPartNumber: "a",
      pages: [page(4, [
        line([["(a)", 42, 24, 0], ["First prompt.", 72, 90, 0]], 650),
        line([["(a)", 42, 24, 0], ["Second prompt.", 72, 100, 0]], 500),
      ])],
    })).toMatchObject({ status: "ambiguous" });
  });

  it("does not turn unrelated answer-option markers into a found anchor", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "combined-science",
      questionNumber: "5",
      questionPartNumber: "a",
      pages: [page(4, [
        line([["(a)", 42, 24, 0], ["A", 72, 8, 0], ["(b)", 90, 24, 0], ["B", 120, 8, 0]], 650),
        line([["(a)", 42, 24, 0], ["Choose one answer.", 72, 130, 0]], 500),
      ])],
    })).toMatchObject({ status: "ambiguous" });
  });

  it("stays missing when the requested part marker is absent", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "combined-science",
      questionNumber: "5",
      questionPartNumber: "iii",
      pages: [page(4, [line([["(ii)", 42, 32, 0], ["Earlier prompt.", 82, 100, 0]], 650)])],
    })).toEqual({ status: "missing", reason: "no identity marker on the requested page" });
  });

  it("prefers the boxed AQA major marker over answer-list numerals", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "aqa",
      subjectSlug: "english-language",
      questionNumber: "1",
      questionPartNumber: null,
      pages: [page(7, [
        line([["0", 38, 8, 0], ["1", 50, 8, 0], ["Read again the first part of the source.", 70, 220, 0]], 650),
        line([["1", 42, 8, 0], ["2", 56, 8, 0]], 610),
        line([["Barcode: AQA-8700-1-7", 40, 160, 0]], 560),
      ])],
    })).toEqual({
      status: "found",
      anchor: {
        pageNumber: 7,
        numberBounds: box(38, 650, 58, 662),
        promptBaseline: 650,
        promptBounds: box(70, 650, 290, 662),
      },
    });
  });

  it("does not treat an AQA compound marker as a null-part major marker", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "aqa",
      subjectSlug: "english-language",
      questionNumber: "1",
      questionPartNumber: null,
      pages: [page(7, [
        line([["0", 38, 8, 0], ["1", 50, 8, 0], [".", 62, 4, 0], ["1", 70, 8, 0], ["Read again.", 84, 80, 0]], 650),
      ])],
    })).toEqual({ status: "missing", reason: "no identity marker on the requested page" });
  });

  it("uses the first AQA compound marker beneath its major question heading", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "aqa",
      subjectSlug: "geography",
      questionNumber: "1",
      pages: [page(2, [
        line([["Question 1", 46, 58, 0], ["Urban issues", 134, 80, 0]], 505),
        line([["0", 52, 6, 0], ["1 .", 69, 18, 0], ["1", 94, 6, 0]], 478),
        line([["Which statement completes the sentence?", 134, 210, 0]], 450),
      ])],
      candidateRegion: { yTop: 520, yBottom: 400 },
    })).toMatchObject({
      status: "found",
      anchor: { numberBounds: { x0: 52, x1: 100 }, promptBounds: { y0: 450 } },
    });
  });

  it("does not scan from an AQA marker to distant barcode furniture", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "aqa",
      subjectSlug: "english-language",
      questionNumber: "1",
      questionPartNumber: null,
      pages: [page(7, [
        line([["0", 38, 8, 0], ["1", 50, 8, 0]], 650),
        line([["1", 42, 8, 0]], 610),
        line([["AQA-8700-1-7", 40, 120, 0]], 540),
      ])],
    })).toEqual({ status: "missing", reason: "identity marker has no meaningful prompt line" });
  });

  it("does not use an arbitrary AQA compound when the requested part is absent", () => {
    const pages = [page(3, [line([["5", 38, 8, 0], [".", 48, 4, 0], ["2", 56, 8, 0]], 570), line([["Explain the process.", 38, 84, 0]], 550)])];
    expect(discoverQuestionIdentityAnchor({
      boardCode: "aqa",
      subjectSlug: "geography",
      questionNumber: "5",
      questionPartNumber: "1",
      pages,
    })).toEqual({ status: "missing", reason: "no identity marker on the requested page" });
    expect(discoverQuestionIdentityAnchor({ boardCode: "aqa", subjectSlug: "geography", questionNumber: "5", questionPartNumber: null, pages }))
      .toEqual({ status: "missing", reason: "no identity marker on the requested page" });
  });

  it("does not select an AQA compound marker as prompt text", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "aqa",
      subjectSlug: "geography",
      questionNumber: "5",
      pages: [page(3, [
        line([["5", 38, 8, 0]], 570),
        line([["5", 38, 8, 0], [".", 48, 4, 0], ["1", 56, 8, 0]], 550),
        line([["Explain the process.", 38, 150, 0]], 530),
      ])],
    })).toMatchObject({
      status: "found",
      anchor: { promptBaseline: 530, promptBounds: box(38, 530, 188, 542) },
    });
  });

  it("skips a rule before the next meaningful prompt", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "aqa",
      subjectSlug: "geography",
      questionNumber: "6",
      pages: [page(5, [line([["6.", 40, 12, 0]], 520), line([["________________________", 40, 170, 0]], 505), line([["Evaluate the evidence.", 40, 140, 0]], 480)])],
    })).toEqual({
      status: "found",
      anchor: { pageNumber: 5, numberBounds: box(40, 520, 52, 532), promptBaseline: 480, promptBounds: box(40, 480, 180, 492) },
    });
  });

  it("returns missing when marker and prompt share one extracted span", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "geography",
      questionNumber: "2",
      pages: [page(1, [line([["2 Explain this.", 40, 100, 0]], 600)])],
    })).toEqual({ status: "missing", reason: "identity marker and prompt share an inseparable extracted span" });
  });

  it("preserves ambiguity", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "geography",
      questionNumber: "2",
      pages: [page(4, [line([["2", 40, 8, 0], ["First prompt.", 60, 80, 0]], 650), line([["2", 40, 8, 0], ["Second prompt.", 60, 90, 0]], 500)])],
    })).toMatchObject({ status: "ambiguous" });
  });

  it("does not use a later question marker as question 2 prompt", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "geography",
      questionNumber: "2",
      startPageNumber: 1,
      pages: [page(1, [line([["2", 40, 8, 0]], 650), line([["3", 40, 8, 0]], 630)])],
    })).toEqual({ status: "missing", reason: "identity marker has no meaningful prompt line" });
  });

  it("keeps Maths footer and total lines out of discovery", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "mathematics",
      questionNumber: "2",
      pages: [page(1, [line([["2 Total for Question 2 = 10 marks", 40, 180, 0]], 650)])],
    }).status).toBe("missing");
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "mathematics",
      questionNumber: "2",
      pages: [page(1, [line([["2", 250, 8, 0], ["Calculate this.", 270, 100, 0]], 650)])],
    }).status).toBe("missing");
  });

  it("does not create an anchor from a continuation page", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "geography",
      questionNumber: "2",
      startPageNumber: 1,
      pages: [page(1, []), page(2, [line([["2", 40, 8, 0]], 650), line([["Explain this.", 40, 100, 0]], 630)])],
    })).toEqual({ status: "missing", reason: "no identity marker on the requested page" });
  });

  it("excludes trailing mark furniture from same-line prompt bounds", () => {
    expect(discoverQuestionIdentityAnchor({
      boardCode: "edexcel",
      subjectSlug: "geography",
      questionNumber: "2",
      pages: [page(1, [line([["2.", 40, 12, 0], ["Explain this.", 60, 100, 0], ["[3 marks]", 170, 50, 0]], 650)])],
    })).toMatchObject({
      status: "found",
      anchor: { promptBounds: box(60, 650, 160, 662) },
    });
  });

  it("does not invent an anchor on a continuation page", () => {
    const firstAnchor = { pageNumber: 2, numberBounds: box(40, 600, 48, 612), promptBaseline: 580, promptBounds: box(40, 580, 180, 592) };
    const parts = [
      { section_code: null, question_number: "3", choiceGroupId: null, identity_anchor: null, page_number: 2 },
      { section_code: null, question_number: "3", choiceGroupId: null, identity_anchor: null, page_number: 3 },
    ];
    const assigned = assignQuestionIdentityAnchors(parts, new Map([["-::3::-", firstAnchor]]));
    expect(assigned.map((part) => part.identity_anchor)).toEqual([firstAnchor, firstAnchor]);
    expect(assigned[1].page_number).toBe(3);
  });
});

describe("hasDuplicateQuestionPartNumbers", () => {
  it("rejects repeated top-level q2 occurrences but trusts distinct q2a/q2b parts", () => {
    expect(hasDuplicateQuestionPartNumbers([
      { question_part_number: null },
      { question_part_number: null },
    ])).toBe(true);
    expect(hasDuplicateQuestionPartNumbers([
      { question_part_number: "a" },
      { question_part_number: "b" },
    ])).toBe(false);

    const trustedAnchor = { pageNumber: 2, numberBounds: box(40, 600, 48, 612), promptBaseline: 580, promptBounds: box(40, 580, 180, 592) };
    const assigned = assignQuestionIdentityAnchors([
      { section_code: null, question_number: "2", choiceGroupId: null, identity_anchor: null, question_part_number: "a" },
      { section_code: null, question_number: "2", choiceGroupId: null, identity_anchor: null, question_part_number: "b" },
    ], new Map([["-::2::-", trustedAnchor]]));
    expect(assigned.map((part) => part.identity_anchor)).toEqual([trustedAnchor, trustedAnchor]);
  });
});

describe("discoverGroupedQuestionIdentityAnchors", () => {
  it("discovers independent AQA compound parts on their own pages", () => {
    const parts = [
      { questionId: "q1.1", questionNumber: "1", questionPartNumber: "1", sectionCode: null, choiceGroupId: null, pageNumber: 2, pageNumbers: [2], identity_anchor: null },
      { questionId: "q1.3", questionNumber: "1", questionPartNumber: "3", sectionCode: null, choiceGroupId: null, pageNumber: 3, pageNumbers: [3], identity_anchor: null },
    ];
    const result = discoverGroupedQuestionIdentityAnchors({
      boardCode: "aqa",
      subjectSlug: "geography",
      pages: [
        page(2, [line([["1", 40, 8, 0], [".", 50, 4, 0], ["1", 58, 8, 0], ["Explain page two.", 72, 120, 0]], 700)]),
        page(3, [line([["1", 40, 8, 0], [".", 50, 4, 0], ["3", 58, 8, 0], ["Explain page three.", 72, 130, 0]], 700)]),
      ],
      parts,
    });

    expect(result.parts.map((part) => part.identity_anchor)).toEqual([
      expect.objectContaining({ pageNumber: 2 }),
      expect.objectContaining({ pageNumber: 3 }),
    ]);
  });

  it("does not reject repeated nested leaf labels in grouped science units", () => {
    const parts = [
      { questionId: "q1ai", questionNumber: "1", questionPartNumber: "i", questionPath: ["a", "i"], sectionCode: null, choiceGroupId: null, pageNumber: 2, pageNumbers: [2], identity_anchor: null },
      { questionId: "q1bi", questionNumber: "1", questionPartNumber: "i", questionPath: ["b", "i"], sectionCode: null, choiceGroupId: null, pageNumber: 3, pageNumbers: [3], identity_anchor: null },
    ];
    const result = discoverGroupedQuestionIdentityAnchors({
      boardCode: "edexcel",
      subjectSlug: "combined-science",
      pages: [
        page(2, [line([["1", 40, 8, 0], ["(a)", 54, 18, 0], ["(i)", 78, 14, 0], ["Explain page two.", 100, 120, 0]], 700)]),
        page(3, [line([["1", 40, 8, 0], ["(b)", 54, 18, 0], ["(i)", 78, 14, 0], ["Explain page three.", 100, 130, 0]], 700)]),
      ],
      parts,
    });

    expect(result.parts.map((part) => part.identity_anchor)).toEqual([
      expect.objectContaining({ pageNumber: 2 }),
      expect.objectContaining({ pageNumber: 3 }),
    ]);
  });
});
