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
  it("starts the first selected part at the target question rather than an earlier bare part", () => {
    const unit = scienceUnit([sciencePart("a", 1), sciencePart("b", 1)]);
    const pages = [{
      pageNumber: 20,
      text: "7 (a) unrelated answer 8 (a) selected answer 8 (b) selected answer",
      lines: [
        markSchemeLine("7 (a) unrelated answer", "7 (a)"),
        markSchemeLine("8 (a) selected answer", "8 (a)"),
        markSchemeLine("8 (b) selected answer", "8 (b)"),
      ],
    }];

    const split = splitMarkSchemePagesByParts(unit, pages);

    expect(split?.slice(0, -1).map((page) => page.text)).toEqual([
      "8 (a) selected answer",
      "8 (b) selected answer",
    ]);
  });

  it("binds a flattened nested part to a source marker with its parent", () => {
    const nestedPart = { ...sciencePart("ii", 2), questionPath: [] };
    const followingPart = { ...sciencePart("d", 6), questionPath: [] };
    const unit = scienceUnit([nestedPart, followingPart]);
    const pages = [{
      pageNumber: 20,
      text: "8 (c) ii selected nested answer 8 (d) selected answer",
      lines: [],
    }];

    const split = splitMarkSchemePagesByParts(unit, pages);

    expect(split?.slice(0, -1).map((page) => page.text)).toEqual([
      "8 (c) ii selected nested answer",
      "8 (d) selected answer",
    ]);
  });

  it("moves source-row text before a displaced marker into the following part", () => {
    const unit = scienceUnit([sciencePart("a", 1), sciencePart("b", 1)]);
    const pages = [{
      pageNumber: 20,
      text: "8 (a) first answer Answers will be credited 8 (b) second answer",
      lines: [
        markSchemeLine("8 (a) first answer", "8 (a)"),
        markSchemeLine("Question Answer Mark"),
        markSchemeLine("number"),
        markSchemeLine("Answers will be credited"),
        markSchemeLine("8 (b)", "8 (b)"),
        markSchemeLine("second answer"),
      ],
    }];

    const split = splitMarkSchemePagesByParts(unit, pages);

    expect(split?.slice(0, -1).map((page) => page.text)).toEqual([
      "8 (a) first answer",
      "Answers will be credited 8 (b) second answer",
    ]);
  });

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

  it("keeps undotted level rows inside dotted numeric question parts", () => {
    const parts = [sciencePart("3", 6), sciencePart("4", 5)].map((part) => ({
      ...part,
      boardCode: "aqa",
      subjectSlug: "business",
      questionNumber: "3",
      questionPath: [part.questionPartNumber ?? ""],
      promptText: `0 3 . ${part.questionPartNumber} Answer the question.`,
    }));
    const unit = {
      ...scienceUnit(parts),
      boardCode: "aqa",
      subjectSlug: "business",
      questionNumber: "3",
    };
    const pages = [{
      pageNumber: 18,
      text: "3.3 selected answer Level Marks Description 3 5-6 detailed analysis 2 3-4 sound analysis 3.4 next answer",
      lines: [
        markSchemeLine("3.3 selected answer", "3.3"),
        markSchemeLine("Level Marks Description"),
        markSchemeLine("3 5-6 detailed analysis"),
        markSchemeLine("2 3-4 sound analysis"),
        markSchemeLine("3.4 next answer", "3.4"),
      ],
    }];

    const split = splitMarkSchemePagesByParts(unit, pages);

    expect(split?.[0].text).toContain("3 5-6 detailed analysis 2 3-4 sound analysis");
  });

  it("accepts undotted numeric part markers outside AQA", () => {
    const parts = [sciencePart("1", 2), sciencePart("2", 3)];
    const unit = scienceUnit(parts);
    const pages = [{
      pageNumber: 18,
      text: "8 1 first answer 8 2 second answer",
      lines: [
        markSchemeLine("8 1 first answer", "8 1"),
        markSchemeLine("8 2 second answer", "8 2"),
      ],
    }];

    expect(splitMarkSchemePagesByParts(unit, pages)?.slice(0, -1).map((page) => page.text)).toEqual([
      "8 1 first answer",
      "8 2 second answer",
    ]);
  });

  it("accepts a first bare continuation after a full target-question marker", () => {
    const unit = scienceUnit([
      { ...sciencePart("ii", 2), questionPath: [] },
      { ...sciencePart("b", 3), questionPath: [] },
    ]);
    const pages = [{
      pageNumber: 18,
      text: "8 (a) (i) unselected answer (ii) selected answer (b) selected answer",
      lines: [
        markSchemeLine("8 (a) (i) unselected answer", "8 (a) (i)"),
        markSchemeLine("(ii) selected answer", "(ii)"),
        markSchemeLine("(b) selected answer", "(b)"),
      ],
    }];

    expect(splitMarkSchemePagesByParts(unit, pages)?.slice(0, -1).map((page) => page.text)).toEqual([
      "(ii) selected answer",
      "(b) selected answer",
    ]);
  });

  it("stops a selected continuation before an unselected bare sibling", () => {
    const unit = scienceUnit([
      { ...sciencePart("ii", 2), questionPath: [] },
      { ...sciencePart("c", 3), questionPath: [] },
    ]);
    const pages = [{
      pageNumber: 18,
      text: "8 (a) (i) unselected answer (ii) selected answer (b) unrelated answer (c) selected answer",
      lines: [
        markSchemeLine("8 (a) (i) unselected answer", "8 (a) (i)"),
        markSchemeLine("(ii) selected answer", "(ii)"),
        markSchemeLine("(b) unrelated answer", "(b)"),
        markSchemeLine("(c) selected answer", "(c)"),
      ],
    }];

    expect(splitMarkSchemePagesByParts(unit, pages)?.[0].text).toBe("(ii) selected answer");
  });
});

describe("generated mark scheme identity", () => {
  it("uses generated order instead of the source question number in total rows", () => {
    expect(formatGeneratedTotalRow(scienceUnit([sciencePart("a", 5)], 5), 4)).toBe("Total for Question 4 is 5 marks");
  });

  it("removes source totals from selected-part guidance", () => {
    const entry = buildStructuredEntry(
      scienceUnit([sciencePart("b", 2)], 2),
      "8 (b) selected answer (2) (Total for question 8 = 9 marks)",
    );

    expect(entry.guidance).toContain("selected answer");
    expect(entry.guidance).not.toContain("Total for question");
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
