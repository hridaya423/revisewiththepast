import { describe, expect, it } from "vitest";
import { buildStructuredLines, detectEdexcelScienceQuestionStart, detectOcrComputerScienceQuestionNumbers, detectPageQuestionNumber, normalizeQuestionNumber, pageHasQuestionStart } from "./text-structure";

describe("mark-scheme text structure", () => {
  it("groups positioned text into the expected columns", () => {
    expect(buildStructuredLines(2, [
      { text: "Question", x: 20, y: 100 },
      { text: "answer", x: 140, y: 100 },
      { text: "2", x: 220, y: 100 },
      { text: "scheme", x: 300, y: 100 },
      { text: "guidance", x: 600, y: 100 },
    ])).toEqual([{
      pageNumber: 2,
      y: 99,
      leftText: "Question",
      answerText: "answer",
      markText: "2",
      schemeText: "scheme",
      guidanceText: "guidance",
      fullText: "Question answer 2 scheme guidance",
    }]);
  });

  it("detects question numbers from headers and left-column parts", () => {
    expect(detectPageQuestionNumber({ pageNumber: 1, text: "Additional guidance 07", lines: [] })).toBe("7");
    expect(detectPageQuestionNumber({
      pageNumber: 2,
      text: "",
      lines: [{ pageNumber: 2, y: 1, leftText: "12 (b)", answerText: "", markText: "", schemeText: "", guidanceText: "", fullText: "12 (b)" }],
    })).toBe("12");
  });

  it("detects a later bare Mathematics question row on a shared mark-scheme page", () => {
    const page = {
      pageNumber: 10,
      text: "Paper: 1MA1/1H Question Answer Mark Mark scheme Additional guidance 6 answer 7 answer",
      lines: [
        { pageNumber: 10, y: 500, leftText: "Question", answerText: "Answer", markText: "Mark", schemeText: "Mark scheme", guidanceText: "Additional guidance", fullText: "Question Answer Mark Mark scheme Additional guidance" },
        { pageNumber: 10, y: 480, leftText: "6", answerText: "55", markText: "P1", schemeText: "", guidanceText: "", fullText: "6 55 P1" },
        { pageNumber: 10, y: 420, leftText: "7 Rate of change", answerText: "", markText: "B1", schemeText: "", guidanceText: "", fullText: "7 Rate of change B1" },
      ],
    };

    expect(pageHasQuestionStart(page, "7")).toBe(true);
  });

  it("uses source page geometry for landscape mark-scheme columns", () => {
    expect(buildStructuredLines(2, [
      { text: "Question", x: 20, y: 100 },
      { text: "answer", x: 80, y: 100 },
      { text: "2", x: 170, y: 100 },
      { text: "scheme", x: 230, y: 100 },
      { text: "guidance", x: 600, y: 100 },
    ], 841.89)).toEqual([{
      pageNumber: 2,
      y: 99,
      leftText: "Question",
      answerText: "answer",
      markText: "2",
      schemeText: "scheme",
      guidanceText: "guidance",
      fullText: "Question answer 2 scheme guidance",
    }]);
  });

  it("uses portrait table headers to keep calculation values in the answer column", () => {
    const lines = buildStructuredLines(5, [
      { text: "Question", x: 49.86, y: 619.56 },
      { text: "number", x: 49.86, y: 607.32 },
      { text: "Answer", x: 118.02, y: 619.86 },
      { text: "Additional guidance", x: 338.04, y: 619.86 },
      { text: "Mark", x: 465.48, y: 619.86 },
      { text: "2(c)", x: 49.86, y: 589.26 },
      { text: "Substitution into correct formula:", x: 118.02, y: 589.26 },
      { text: "Award full marks for", x: 338.04, y: 589.32 },
      { text: "(2)", x: 465.48, y: 589.86 },
      { text: "Total Costs = £3 600 + (£9 x 340) (1)", x: 118.02, y: 564.36 },
      { text: "Answer: £6 660 (1)", x: 118.02, y: 540.12 },
    ], 595.44);

    expect(lines.find((line) => line.fullText.includes("3 600"))).toMatchObject({
      answerText: "Total Costs = £3 600 + (£9 x 340) (1)",
      markText: "",
    });
    expect(lines.find((line) => line.fullText.includes("6 660"))).toMatchObject({
      answerText: "Answer: £6 660 (1)",
      markText: "",
    });
    expect(lines.find((line) => line.fullText.includes("Substitution"))).toMatchObject({
      answerText: "Substitution into correct formula:",
      guidanceText: "Award full marks for",
    });
    expect(lines.find((line) => line.fullText === "(2)")).toMatchObject({
      answerText: "",
      markText: "(2)",
    });
  });

  it("normalizes numeric question tokens without changing non-numeric labels", () => {
    expect(normalizeQuestionNumber("007")).toBe("7");
    expect(normalizeQuestionNumber("A")).toBe("A");
  });

  it.each([
    "9 (a) selected answer",
    "09(a)(i) selected answer",
    "9a selected answer",
    "*9(c) selected answer",
    "Question Number Answer Mark 9(a)(i) selected answer",
    "Question Number Answer Additional guidance Mark 09 (a) selected answer",
  ])("detects an Edexcel Science question start in %s", (text) => {
    expect(detectEdexcelScienceQuestionStart({ pageNumber: 1, text, lines: [] }, "9")).toBe(true);
  });

  it("detects an Edexcel Science start from the structured left column", () => {
    expect(detectEdexcelScienceQuestionStart({
      pageNumber: 1,
      text: "table content",
      lines: [{ pageNumber: 1, y: 1, leftText: "9(a)(i)", answerText: "answer", markText: "", schemeText: "", guidanceText: "", fullText: "9(a)(i) answer" }],
    }, "9")).toBe(true);
  });

  it.each([
    "compare with 9 (b) in the question",
    "Question 8 (a) answer referring to 9 (b)",
    "19(a) adjacent question",
    "Question Number Answer Mark 10(a) adjacent question",
  ])("rejects a non-start Edexcel Science reference in %s", (text) => {
    expect(detectEdexcelScienceQuestionStart({ pageNumber: 1, text, lines: [] }, "9")).toBe(false);
  });

  it("detects a bare OCR question row from structured columns", () => {
    expect(detectOcrComputerScienceQuestionNumbers({
      pageNumber: 20,
      text: "J277/01 Mark Scheme June 2023",
      lines: [{ pageNumber: 20, y: 258, leftText: "6", answerText: "Mark Band 3-High Level", markText: "", schemeText: "", guidanceText: "8 Indicative content", fullText: "6 Mark Band 3-High Level 8 Indicative content" }],
    })).toEqual(["6"]);
  });

  it("detects a skipped OCR question from a marking-table header", () => {
    expect(detectOcrComputerScienceQuestionNumbers({
      pageNumber: 23,
      text: "Question Answer Mark Guidance 7 1 mark for example",
      lines: [
        { pageNumber: 23, y: 700, leftText: "Question", answerText: "Answer", markText: "Mark", schemeText: "", guidanceText: "Guidance", fullText: "Question Answer Mark Guidance" },
        { pageNumber: 23, y: 680, leftText: "7 1 mark for example:", answerText: "", markText: "3", schemeText: "", guidanceText: "Allow", fullText: "7 1 mark for example: 3 Allow" },
      ],
    })).toEqual(["7"]);
  });

  it("does not treat a numeric answer-table row as an OCR question", () => {
    expect(detectOcrComputerScienceQuestionNumbers({
      pageNumber: 8,
      text: "Question Answer Mark Guidance 1 b answer Denary 8-bit binary Hexadecimal 7 00000111 7",
      lines: [
        { pageNumber: 8, y: 500, leftText: "Question", answerText: "Answer", markText: "Mark", schemeText: "", guidanceText: "Guidance", fullText: "Question Answer Mark Guidance" },
        { pageNumber: 8, y: 480, leftText: "1 b 1 mark for each completed box", answerText: "", markText: "4", schemeText: "", guidanceText: "Must be 8-bits", fullText: "1 b 1 mark for each completed box 4 Must be 8-bits" },
        { pageNumber: 8, y: 420, leftText: "7", answerText: "00000111", markText: "", schemeText: "7", guidanceText: "", fullText: "7 00000111 7" },
      ],
    })).toEqual(["1"]);
  });
});
