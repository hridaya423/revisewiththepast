import { describe, expect, it } from "vitest";

import type { QuestionBankPart, QuestionUnit } from "@/shared/domain/paper";
import { buildStructuredEntry, formatGeneratedTotalRow, resolveMarkSchemeAsset, splitMarkSchemePagesByParts, stripMatchedPrompt } from "./mark-scheme";

const identity = {
  boardCode: "edexcel",
  subjectSlug: "biology",
  paperCode: "paper-2",
  year: 2024,
  session: "june",
  tier: "higher",
};

function asset(overrides: Partial<typeof identity> & { id: string; kind?: string }) {
  return {
    ...identity,
    kind: "mark_scheme",
    ...overrides,
  };
}

describe("mark scheme asset resolution", () => {
  it("selects the unique exact paper and tier identity", () => {
    const expected = asset({ id: "expected" });
    const result = resolveMarkSchemeAsset(identity, [
      asset({ id: "wrong-subject", subjectSlug: "chemistry" }),
      asset({ id: "wrong-tier", tier: "foundation" }),
      expected,
    ]);

    expect(result).toEqual({ status: "found", asset: expected });
  });

  it("rejects duplicate exact matches as ambiguous", () => {
    expect(resolveMarkSchemeAsset(identity, [
      asset({ id: "first" }),
      asset({ id: "second" }),
    ])).toEqual({ status: "ambiguous" });
  });

  it("uses one untiered asset only when no exact tier exists", () => {
    const untiered = asset({ id: "untiered", tier: "none" });

    expect(resolveMarkSchemeAsset(identity, [untiered])).toEqual({ status: "found", asset: untiered });
  });

  it("does not treat an unknown asset session as the requested session", () => {
    expect(resolveMarkSchemeAsset(identity, [
      asset({ id: "unknown-session", session: "unknown" }),
    ])).toEqual({ status: "not-found" });
  });
});

function sciencePart(partNumber: string, marks: number): QuestionBankPart {
  return {
    partKey: `q8-${partNumber}`,
    unitKey: "q8",
    taggedPaperId: "paper",
    sourceRelativePath: "edexcel/biology/higher/paper.pdf",
    questionPaperCdnUrl: "https://example.test/paper.pdf",
    questionPaperFileName: "paper.pdf",
    pageAssetCdnUrls: [],
    boardCode: "edexcel",
    subjectSlug: "biology",
    paperCode: "paper-2",
    year: 2022,
    session: "june",
    questionId: `q8-${partNumber}`,
    questionNumber: "8",
    questionPartNumber: partNumber,
    questionPath: [partNumber],
    sectionCode: null,
    sectionName: null,
    marks,
    canonicalLeaf: "biology.topic",
    promptText: `8 (${partNumber}) Answer the question.`,
    contextText: null,
    pageNumber: 20,
    pageNumbers: [20],
    bbox: null,
    sourceMode: "crop_or_text",
    assetIds: [],
  };
}

function scienceUnit(parts: QuestionBankPart[], totalMarks = parts.reduce((sum, part) => sum + (part.marks ?? 0), 0)): QuestionUnit {
  return {
    unitKey: "q8",
    groupUnitKey: "q8",
    sourceQuestionKey: "source-q8",
    sourceRelativePath: parts[0].sourceRelativePath,
    questionPaperCdnUrl: parts[0].questionPaperCdnUrl,
    questionPaperFileName: parts[0].questionPaperFileName,
    boardCode: "edexcel",
    subjectSlug: "biology",
    paperCode: "paper-2",
    year: 2022,
    session: "june",
    questionNumber: "8",
    sectionCode: null,
    sectionName: null,
    totalMarks,
    canonicalLeafs: ["biology.topic"],
    parts,
    pages: [],
  };
}

function markSchemeLine(fullText: string, leftText = "") {
  return {
    pageNumber: 12,
    y: 500,
    leftText,
    answerText: "",
    markText: "",
    schemeText: "",
    guidanceText: "",
    fullText,
  };
}

describe("multipart mark scheme splitting", () => {
  it("stops selected parts before unselected siblings and adjacent questions", () => {
    const parts = [sciencePart("a", 1), sciencePart("b", 1)];
    const unit = scienceUnit(parts);
    const pages = [{
      pageNumber: 20,
      text: "8 (a) selected answer 8 (b) selected answer with reference to 1 (a) 8 (c) unselected answer Question 9 (a) adjacent question",
      lines: [],
    }];

    const split = splitMarkSchemePagesByParts(unit, pages);

    expect(split?.slice(0, -1).map((page) => page.text)).toEqual([
      "8 (a) selected answer",
      "8 (b) selected answer with reference to 1 (a)",
    ]);
  });

  it("does not treat an embedded same-question reference as a new part", () => {
    const unit = scienceUnit([sciencePart("a", 1), sciencePart("b", 1)]);
    const pages = [{
      pageNumber: 20,
      text: "8 (a) selected answer 8 (b) compare with 8 (b) in the question (1) AO2 1 Question 8 (c) unselected answer",
      lines: [],
    }];

    const split = splitMarkSchemePagesByParts(unit, pages);

    expect(split?.[1].text).toBe("8 (b) compare with 8 (b) in the question (1) AO2 1");
  });

  it("does not treat a measurement as a question boundary", () => {
    const unit = scienceUnit([sciencePart("a", 1), sciencePart("b", 1)]);
    const pages = [{
      pageNumber: 12,
      text: "8 (a) first answer 8 (b) Conversion of mm to m: 47 (m) Substitution: complete answer 8 (c) unselected answer",
      lines: [
        markSchemeLine("8 (a) first answer", "8 (a)"),
        markSchemeLine("8 (b) Conversion of mm to m:", "8 (b)"),
        markSchemeLine("47 (m)"),
        markSchemeLine("Substitution: complete answer"),
        markSchemeLine("8 (c) unselected answer", "8 (c)"),
      ],
    }];

    const split = splitMarkSchemePagesByParts(unit, pages);

    expect(split?.[1].text).toBe("8 (b) Conversion of mm to m: 47 (m) Substitution: complete answer");
  });
});

describe("generated mark scheme identity", () => {
  it("uses generated order instead of the source question number in total rows", () => {
    expect(formatGeneratedTotalRow(scienceUnit([sciencePart("a", 5)], 5), 4)).toBe("Total for Question 4 is 5 marks");
  });
});

describe("structured mark scheme entries", () => {
  it.each([
    "8 (b)(i) AO2 1 1 50 x 4.2 x 30 (1) 6300 (J) award full marks for the correct answer with no working",
    "8 (b)(i) AO2 2 2 Change the subject of the equation: time = distance / speed (1) Conversion of mm to m: 47 / 1000 = 0.047 m",
  ])("keeps numeric science criteria as ordinary guidance", (text) => {
    const entry = buildStructuredEntry(scienceUnit([sciencePart("b(i)", 3)], 3), text);

    expect(entry.levels).toEqual([]);
    expect(entry.guidance).toContain("AO2");
  });

  it("parses a table only when the source identifies level descriptors", () => {
    const text = "Level Marks Description Level 1 1-2 basic biological understanding Level 2 3-4 detailed biological understanding";

    expect(buildStructuredEntry(scienceUnit([sciencePart("b", 4)], 4), text).levels).toEqual([
      { level: "1", marks: "1-2", description: "basic biological understanding" },
      { level: "2", marks: "3-4", description: "detailed biological understanding" },
    ]);
  });

  it("fails when the extracted row contains guidance for an image-only answer", () => {
    const text = "Question number Answer Mark 8 (a) (1) accept lower case letters AO1 1";

    expect(() => buildStructuredEntry(scienceUnit([sciencePart("a", 1)]), text)).toThrow("image-only or missing answer");
  });

  it("keeps Edexcel Business calculation values out of level descriptors", () => {
    const part = {
      ...sciencePart("c", 2),
      subjectSlug: "business",
      canonicalLeaf: "business.finance",
      promptText: "2 (c) Calculate the total costs for one month.",
    };
    const unit = {
      ...scienceUnit([part]),
      subjectSlug: "business",
      canonicalLeafs: ["business.finance"],
      questionNumber: "2",
    };
    const text = "2(c) Substitution into correct formula: Total Costs = 3 600 + (9 x 340) (1) Answer: 6 660 (1) AO2";

    const entry = buildStructuredEntry(unit, text);

    expect(entry.levels).toEqual([]);
    expect(entry.guidance).toContain("3 600");
    expect(entry.guidance).toContain("6 660");
  });
});

describe("mark scheme prompt stripping", () => {
  it("removes only the matched prefix when source wording is shorter", () => {
    const source = "Describe how the sample was prepared using sterile equipment. award DNA sequence; accept lower case letters";
    const metadataPrompt = "Describe how the sample was prepared using sterile equipment. Include every stage of the laboratory method in your answer.";

    expect(stripMatchedPrompt(source, metadataPrompt, 40)).toBe("award DNA sequence; accept lower case letters");
  });
});
