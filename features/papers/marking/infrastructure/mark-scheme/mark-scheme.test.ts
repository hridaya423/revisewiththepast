import { describe, expect, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { QuestionBankPart, QuestionUnit } from "@/shared/domain/paper";
import { getPdfDocument, renderPdfPageToPng } from "@/features/papers/infrastructure/pdfjs-server";
import { assembleMarkSchemePdf, buildStructuredEntry, collectedPagesMatchUnit, drawOcrMarkSchemeTableRow, drawSelectedAnswerRegion, findAqaNumberedQuestionStartIndex, formatGeneratedTotalRow, getOwnedOcrQuestionNumbers, loadMarkSchemeTextPages, markSchemeDocumentMatchesUnitIdentity, narrowAqaNumberedQuestionPages, planSelectedAnswerRegions, regionPacksBelow, resolveMarkSchemeAsset, selectedAnswerRegionBounds, splitMarkSchemePagesByParts, stripMatchedPrompt, trimMixedQuestionPages, trimPageToQuestionRange } from "./mark-scheme";

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
  it("loads a local mark scheme before validating its unused fallback URL", async () => {
    const directory = join(process.cwd(), "data", "downloads", ".mark-scheme-test");
    const relativePath = ".mark-scheme-test/local.pdf";
    mkdirSync(directory, { recursive: true });
    const document = await PDFDocument.create();
    document.addPage([200, 200]);
    writeFileSync(join(directory, "local.pdf"), await document.save());

    try {
      await expect(loadMarkSchemeTextPages(relativePath, "https://qualifications.pearson.com/mark-scheme.pdf"))
        .resolves.toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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

  it("rejects an Edexcel mark scheme from a different qualification", () => {
    const unit = {
      boardCode: "edexcel",
      subjectSlug: "combined-science",
    };

    expect(markSchemeDocumentMatchesUnitIdentity(unit, [{
      pageNumber: 1,
      text: "Pearson Edexcel GCSE In Biology (1BI0) Paper 2H",
      lines: [],
    }])).toBe(false);
    expect(markSchemeDocumentMatchesUnitIdentity(unit, [{
      pageNumber: 1,
      text: "Pearson Edexcel GCSE In Combined Science (1SC0) Paper 2BH",
      lines: [],
    }])).toBe(true);
  });
});

describe("mark scheme question ownership", () => {
  it("isolates an AQA whole-question mark scheme without a part number", () => {
    const part = {
      ...sciencePart("a", 12),
      boardCode: "aqa",
      subjectSlug: "geography",
      questionNumber: "3",
      questionPartNumber: null,
      questionPath: [],
    } satisfies QuestionBankPart;
    const unit = {
      ...scienceUnit([part], 12),
      boardCode: "aqa",
      subjectSlug: "geography",
      questionNumber: "3",
    };
    const pages = [
      { pageNumber: 11, text: "general guidance", lines: [] },
      { pageNumber: 12, text: "03 Whole question answer", lines: [{ ...markSchemeLine("03 Whole question answer"), pageNumber: 12, answerText: "03" }] },
      { pageNumber: 13, text: "Indicative content continues", lines: [] },
      { pageNumber: 14, text: "04 Next question", lines: [{ ...markSchemeLine("04 Next question"), pageNumber: 14, answerText: "04" }] },
    ];

    expect(narrowAqaNumberedQuestionPages(unit, pages).map((page) => page.pageNumber)).toEqual([12, 13]);
  });

  it("keeps a compact Edexcel question marker when trimming a mixed page", () => {
    const page = {
      pageNumber: 6,
      text: "2a first answer 2 (b) i second answer",
      lines: [
        markSchemeLine("2a first answer", "2a"),
        markSchemeLine("2 (b) i second answer", "2 (b) i"),
      ],
    };

    expect(trimPageToQuestionRange(page, "2").lines[0]?.leftText).toBe("2a");
  });

  it("ends the trim at a later question row whose Qu and Answer cells merged", () => {
    const page = {
      pageNumber: 6,
      pageHeight: 595,
      text: "1 (a) answer (b) answer 2 answer 3 answer",
      lines: [
        { ...markSchemeLine("Question Answer Mark Mark scheme Additional guidance", "Question"), y: 498 },
        { ...markSchemeLine("1 (a) 1.765(2...) M1 for fully evaluating", "1 (a)"), y: 486 },
        { ...markSchemeLine("(b) 1.6 B1 for 1.6 oe", "(b)"), y: 390 },
        { ...markSchemeLine("2 2 × 2 × 3 × 5 M1 for a complete method", "2 2 × 2 × 3 × 5"), y: 366 },
        { ...markSchemeLine("3 No with reason C1 for No and valid reason", "3 No with reason"), y: 282 },
      ],
    };

    const trimmed = trimPageToQuestionRange(page, "1");
    expect(trimmed.lines.map((line) => line.y)).toEqual([486, 390]);
    expect(trimmed.regionBottom).toBe((390 + 366) / 2);
    expect(trimmed.regionTop).toBe(498 + 20);
  });

  it("excludes a trailing publisher footer from the region bounds", () => {
    const page = {
      pageNumber: 6,
      pageHeight: 595,
      text: "1 (a) answer Pearson Education Limited. Registered company number 872828",
      lines: [
        { ...markSchemeLine("1 (a) 1.765(2...) M1 for fully evaluating", "1 (a)"), y: 486 },
        { ...markSchemeLine("Pearson Education Limited. Registered company number 872828 with its registered office at 80 Strand, London, WC2R 0RL", ""), y: 30 },
      ],
    };

    const trimmed = trimPageToQuestionRange(page, "1");
    expect(trimmed.lines).toHaveLength(1);
    // Region bottom hugs the answer row — not the footer line at page bottom.
    expect(trimmed.regionBottom).toBe(486 - 8);
  });

  it("cuts a continuation page at a different question's start", () => {
    const page = {
      pageNumber: 7,
      pageHeight: 595,
      text: "9(e) Pasteur (1) SECTION B 10 Normally I go on holiday (7)",
      lines: [
        { ...markSchemeLine("9(e) Pasteur (1)", "9(e)"), y: 500 },
        { ...markSchemeLine("SECTION B", ""), y: 450 },
        { ...markSchemeLine("10 Normally I go on holiday with my family (7)", "10"), y: 400 },
        { ...markSchemeLine("Pearson Education Limited. Registered company number 872828", ""), y: 30 },
      ],
    };

    const trimmed = trimPageToQuestionRange(page, "9");
    // 9(e) tail row survives; SECTION B header is furniture-free prose between
    // the questions; the "10" row starts a different question — region ends.
    expect(trimmed.lines.map((line) => line.y)).toEqual([500, 450]);
    expect(trimmed.regionBottom).toBe((450 + 400) / 2);
  });

  it("cuts a continuation page at a foreign question row when the Qu column never resolved", () => {
    // Edexcel French mark schemes defeat column inference — leftText is empty
    // and the question number only survives in fullText. A row that leads with
    // a number and ends in a mark is a question row ("10 Normally… (7)");
    // level bands ("7 The meaning…") end in prose and are not.
    const page = {
      pageNumber: 8,
      pageHeight: 595,
      text: "9(e) Pasteur (1) 10 Normally I go on holiday (7) 7 The meaning of the passage",
      lines: [
        { ...markSchemeLine("9(e) Pasteur (1)", ""), y: 500 },
        { ...markSchemeLine("10 Normally I go on holiday with my family (7)", ""), y: 400 },
        { ...markSchemeLine("7 The meaning of the passage is fully communicated.", ""), y: 300 },
      ],
    };

    const trimmed = trimPageToQuestionRange(page, "9");
    expect(trimmed.lines.map((line) => line.y)).toEqual([500]);
    expect(trimmed.regionBottom).toBe((500 + 400) / 2);
  });

  it("keeps text-only narrowed pages untouched", () => {
    // narrowAqaNumberedQuestionPages emits scoped text with no lines — the
    // continuation path must not treat them as foreign content and wipe text.
    const page = {
      pageNumber: 0,
      pageHeight: 595,
      text: "scoped guidance for the unit",
      lines: [],
    };
    expect(trimPageToQuestionRange(page, "2")).toBe(page);
  });

  it("empties a continuation page owned entirely by a different question", () => {
    const page = {
      pageNumber: 9,
      pageHeight: 595,
      text: "10 (a) answer Pearson Education Limited. Registered company number 872828",
      lines: [
        { ...markSchemeLine("10 (a) answer", "10 (a)"), y: 500 },
        { ...markSchemeLine("Pearson Education Limited. Registered company number 872828", ""), y: 30 },
      ],
    };

    const trimmed = trimPageToQuestionRange(page, "9");
    expect(trimmed.lines).toHaveLength(0);
    expect(trimmed.regionTop).toBeUndefined();
  });

  it("does not end an AQA trim on decimal-led or mark-count rows", () => {
    const page = {
      pageNumber: 19,
      text: "3.4 prompt 68.26 x 0.08 (1) = 5.46m (1) 3.5 prompt 4 marks for calculation. answer",
      lines: [
        markSchemeLine("3.4 The UK population is forecasted to be 68.26m in 2023."),
        markSchemeLine("Answer = 5.46m (2)", "Answer = 5.46m"),
        markSchemeLine("68.26 x 0.08 (1) = 5.46m (1)", "68.26 x 0.08 (1) = 5.46m (1)"),
        markSchemeLine("3.5 Using Item D, calculate the average rate of return"),
        markSchemeLine("4 marks for calculation.", "4 marks for calculation."),
        markSchemeLine("Answer = 30% (4)", "Answer = 30%"),
        markSchemeLine("4.1 Next question", ""),
      ],
    };

    const trimmed = trimPageToQuestionRange(page, "3", { aqaDottedLabels: true });
    expect(trimmed.lines).toHaveLength(6);
    expect(trimmed.lines.at(-1)?.fullText).toBe("Answer = 30% (4)");
  });

  it("preserves Edexcel Science reading-order text while trimming crop lines", () => {
    const unit = scienceUnit([
      sciencePart("a", 1),
      { ...sciencePart("ii", 1), questionPath: ["b", "ii"] },
    ]);
    const page = {
      pageNumber: 6,
      text: "8(a) first answer 8 (b) (ii) second answer 9(a) unrelated answer",
      lines: [
        markSchemeLine("8 (a) first answer", "8 (a)"),
        markSchemeLine("8 (b) (1) AO2 (ii) second answer", "8 (b)"),
        markSchemeLine("9 (a) unrelated answer", "9 (a)"),
      ],
    };

    const [trimmed] = trimMixedQuestionPages(unit, [page]);

    expect(trimmed.text).toBe(page.text);
    expect(trimmed.lines).toHaveLength(2);
  });

  it("does not treat a level row as an AQA question-part start", () => {
    const genuineLine = markSchemeLine("02 9 Plants and animals need special adaptations", "");
    genuineLine.answerText = genuineLine.fullText;
    const pages = [
      {
        pageNumber: 11,
        text: "An answer is limited to Level 2. 9 Level Marks Description",
        lines: [markSchemeLine("2 9 Level Marks Description", "")],
      },
      {
        pageNumber: 20,
        text: "02 9 Plants and animals need special adaptations",
        lines: [genuineLine],
      },
    ];

    expect(findAqaNumberedQuestionStartIndex(pages, "2", "9")).toBe(1);
  });

  it("finds an AQA question-part marker in the extracted answer column", () => {
    const line = markSchemeLine("01 7 State two ways that planning might help", "");
    line.answerText = "01 7 State two ways that planning might help";

    expect(findAqaNumberedQuestionStartIndex([{
      pageNumber: 9,
      text: line.fullText,
      lines: [line],
    }], "1", "7")).toBe(0);
  });

  it("finds an AQA question-part marker in the full extracted line", () => {
    const line = markSchemeLine("1.1 A - Commission", "");

    expect(findAqaNumberedQuestionStartIndex([{
      pageNumber: 4,
      text: line.fullText,
      lines: [line],
    }], "1", "1")).toBe(0);
  });

  it("isolates an AQA lettered sub-part row disambiguated by prompt text", () => {
    const part = {
      ...sciencePart("b", 1),
      boardCode: "aqa",
      subjectSlug: "geography",
      questionNumber: "4",
      questionPartNumber: "b",
      questionPath: ["b"],
      promptText: "(b) Give one reason why your chosen question might provide useful information for the visitor survey. [1 mark]",
    } satisfies QuestionBankPart;
    const unit = {
      ...scienceUnit([part], 1),
      boardCode: "aqa",
      subjectSlug: "geography",
      questionNumber: "4",
    };
    const row = (label: string, guidance: string) => {
      const line = markSchemeLine(`${label} ${guidance}`, "");
      line.answerText = label;
      return line;
    };
    const pages = [{
      pageNumber: 15,
      text: [
        "04 3(a) Suggest one additional question which could be included on the visitor survey.",
        "Credit any valid additional idea.",
        "04 3(b) Give one reason why your chosen question might provide useful information for the visitor survey.",
        "Credit any valid reason which is clearly linked to part (a).",
        "04 4(a) Suggest a more appropriate method for presenting the data shown in Figure 6.",
        "Eg. Bar graph/chart",
        "04 4(b) Give a reason for your choice.",
        "Link to chosen method",
        "04 5 What is the total environmental quality score?",
      ].join(" "),
      lines: [
        row("04 3(a)", "Suggest one additional question which could be included on the visitor survey."),
        row("04 3(b)", "Give one reason why your chosen question might provide useful information for the visitor survey."),
        row("04 4(a)", "Suggest a more appropriate method for presenting the data shown in Figure 6."),
        row("04 4(b)", "Give a reason for your choice."),
        row("04 5", "What is the total environmental quality score?"),
      ],
    }];

    const narrowed = narrowAqaNumberedQuestionPages(unit, pages);

    expect(narrowed).toHaveLength(1);
    expect(narrowed[0].text).toContain("04 3(b) Give one reason why your chosen question");
    expect(narrowed[0].text).toContain("clearly linked to part (a)");
    expect(narrowed[0].text).not.toContain("4(a)");
    expect(narrowed[0].text).not.toContain("4(b)");
  });

  it("maps an AQA numeric part onto its parenthesized first sub-part row", () => {
    const part = {
      ...sciencePart("4", 1),
      boardCode: "aqa",
      subjectSlug: "geography",
      questionNumber: "4",
      questionPartNumber: "4",
      questionPath: ["4"],
      promptText: "0 4 . 4 (a) Suggest a more appropriate method for presenting the data shown in Figure 6. [1 mark]",
    } satisfies QuestionBankPart;
    const unit = {
      ...scienceUnit([part], 1),
      boardCode: "aqa",
      subjectSlug: "geography",
      questionNumber: "4",
    };
    const pages = [{
      pageNumber: 16,
      text: [
        "04 4(a) Suggest a more appropriate method for presenting the data shown in Figure 6.",
        "Eg. Bar graph/chart",
        "04 4(b) Give a reason for your choice.",
        "Link to chosen method",
      ].join(" "),
      lines: [
        { ...markSchemeLine("04 4(a) Suggest a more appropriate method", ""), answerText: "04 4(a)" },
        { ...markSchemeLine("04 4(b) Give a reason for your choice.", ""), answerText: "04 4(b)" },
      ],
    }];

    const narrowed = narrowAqaNumberedQuestionPages(unit, pages);

    expect(narrowed).toHaveLength(1);
    expect(narrowed[0].text).toContain("04 4(a) Suggest a more appropriate method");
    expect(narrowed[0].text).not.toContain("4(b)");
  });

  it("retains explicitly embedded OCR source questions as owned", () => {
    const unit = {
      ...scienceUnit([{
        ...sciencePart("ii", 10),
        questionNumber: "5",
        promptText: "Describe one benefit. [2] 6* A shopping centre uses facial recognition. Discuss. [8]",
      }], 10),
      questionNumber: "5",
    };

    expect(getOwnedOcrQuestionNumbers(unit)).toEqual(new Set(["5", "6"]));
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
  it("accepts a complete multipart split when the trimmed top marker is displaced", () => {
    const unit = scienceUnit([sciencePart("a", 1), sciencePart("b", 1)]);
    const pages = [{
      pageNumber: 20,
      text: "number guidance 8(a) first answer 8(b) second answer",
      lines: [],
    }];

    expect(collectedPagesMatchUnit(unit, pages)).toBe(true);
  });

  it.each(["Q8c", "*8(c)"])("splits prefixed Edexcel Science marker %s", (marker) => {
    const unit = scienceUnit([sciencePart("a", 1), sciencePart("c", 1)]);
    const pages = [{
      pageNumber: 20,
      text: `8(a) first answer ${marker} second answer`,
      lines: [],
    }];

    expect(splitMarkSchemePagesByParts(unit, pages)?.slice(0, -1).map((page) => page.text)).toEqual([
      "8(a) first answer",
      `${marker} second answer`,
    ]);
  });

  it("matches an omitted first nested-part marker to its parent", () => {
    const firstPart = { ...sciencePart("a", 1), questionPath: ["a"] };
    const nestedFirstPart = { ...sciencePart("i", 1), questionPath: ["b", "i"] };
    const nestedSecondPart = { ...sciencePart("ii", 1), questionPath: ["b", "ii"] };
    const pages = [{
      pageNumber: 20,
      text: "8(a) first answer 8(b) nested first answer 8(b)(ii) nested second answer",
      lines: [],
    }];

    expect(splitMarkSchemePagesByParts(scienceUnit([firstPart, nestedFirstPart, nestedSecondPart]), pages)?.slice(0, -1).map((page) => page.text)).toEqual([
      "8(a) first answer",
      "8(b) nested first answer",
      "8(b)(ii) nested second answer",
    ]);
  });

  it("splits compact Edexcel Science question markers", () => {
    const unit = scienceUnit([sciencePart("a", 1), sciencePart("b", 1)]);
    const pages = [{
      pageNumber: 20,
      text: "8a first answer 8 (b) second answer",
      lines: [],
    }];

    expect(splitMarkSchemePagesByParts(unit, pages)?.slice(0, -1).map((page) => page.text)).toEqual([
      "8a first answer",
      "8 (b) second answer",
    ]);
  });

  it("ignores zero-mark context parts when splitting", () => {
    const contextPart = { ...sciencePart("a", 0), partKey: "q4-a-context", promptText: "SECTION B Read the extract.", questionNumber: "4" };
    const realPartA = { ...sciencePart("a", 2), questionNumber: "4", promptText: "SECTION B Read the extract. 4 (a) Outline one way." };
    const unit = { ...scienceUnit([contextPart, realPartA, { ...sciencePart("b", 6), questionNumber: "4" }]), questionNumber: "4" };
    const pages = [{
      pageNumber: 9,
      text: "4(a) linked points answer (2) 4(b) indicative content answer (6)",
      lines: [],
    }];

    const segments = splitMarkSchemePagesByParts(unit, pages);
    expect(segments?.slice(0, -1).map((page) => page.text)).toEqual([
      "4(a) linked points answer (2)",
      "4(b) indicative content answer (6)",
    ]);
    expect(segments?.[0].unit?.parts[0].promptText).toBe("4 (a) Outline one way.");
  });

  it("splits compact nested Edexcel Science question paths", () => {
    const firstPart = { ...sciencePart("a", 1), questionPath: ["a"] };
    const nestedPart = { ...sciencePart("iii", 1), questionPath: ["c", "iii"] };
    const pages = [{
      pageNumber: 20,
      text: "8a first answer 8ciii nested answer",
      lines: [],
    }];

    expect(splitMarkSchemePagesByParts(scienceUnit([firstPart, nestedPart]), pages)?.slice(0, -1).map((page) => page.text)).toEqual([
      "8a first answer",
      "8ciii nested answer",
    ]);
  });

  it("splits grouped nested Edexcel Science question paths", () => {
    const firstPart = { ...sciencePart("a", 1), questionPath: ["a"] };
    const nestedFirstPart = { ...sciencePart("i", 1), questionPath: ["b", "i"] };
    const nestedSecondPart = { ...sciencePart("ii", 1), questionPath: ["b", "ii"] };
    const pages = [{
      pageNumber: 20,
      text: "8(a) first answer 8(bi) nested first answer 8bii nested second answer",
      lines: [],
    }];

    expect(splitMarkSchemePagesByParts(scienceUnit([firstPart, nestedFirstPart, nestedSecondPart]), pages)?.slice(0, -1).map((page) => page.text)).toEqual([
      "8(a) first answer",
      "8(bi) nested first answer",
      "8bii nested second answer",
    ]);
  });

  it("preserves Edexcel Science source-reading order when paths omit parents", () => {
    const parts = [
      { ...sciencePart("a", 1), questionPath: ["a"] },
      { ...sciencePart("ii", 1), questionPath: ["ii"] },
      { ...sciencePart("iii", 1), questionPath: ["iii"] },
      { ...sciencePart("b", 1), questionPath: ["b"] },
      { ...sciencePart("i", 1), questionPath: ["c", "i"] },
      { ...sciencePart("ii", 1), partKey: "q8-c-ii", questionPath: ["c", "ii"] },
    ];
    const pages = [{
      pageNumber: 20,
      text: "8(a)(i) first 8(a)(ii) second 8(a)(iii) third 8(b) fourth 8(c)(i) fifth 8(c)(ii) sixth",
      lines: [],
    }];

    expect(splitMarkSchemePagesByParts(scienceUnit(parts), pages)?.slice(0, -1).map((page) => page.text)).toEqual([
      "8(a)(i) first",
      "8(a)(ii) second",
      "8(a)(iii) third",
      "8(b) fourth",
      "8(c)(i) fifth",
      "8(c)(ii) sixth",
    ]);
  });

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
    expect(formatGeneratedTotalRow(scienceUnit([sciencePart("a", 1)], 1), 4)).toBe("Total for Question 4 is 1 mark");
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

  it("matches prompts split mid-word by pdf.js spacing artefacts", () => {
    const guidance = "Figure 2 shows the data. (b) Using the information in Figure 2, iden tify what percentage of entrepreneurs were in the same age range. • 7(b) 10% (1)";
    const prompt = "Using the information in Figure 2, identify what percentage of entrepreneurs were in the same age range";

    expect(stripMatchedPrompt(guidance, prompt, 50)).toBe("• 7(b) 10% (1)");
  });

  it("leaves text untouched when the prompt does not appear", () => {
    expect(stripMatchedPrompt("award one mark for a correct step", "Different question entirely", 50))
      .toBe("award one mark for a correct step");
  });
});

describe("OCR mark scheme layout", () => {
  it("wraps guidance within the guidance column without dropping words", async () => {
    const outputDoc = await PDFDocument.create();
    const regular = await outputDoc.embedFont(StandardFonts.Helvetica);
    const bold = await outputDoc.embedFont(StandardFonts.HelveticaBold);
    const unit = {
      ...scienceUnit([{ ...sciencePart("a", 1), subjectSlug: "computer-science" }]),
      subjectSlug: "computer-science",
    };
    const guidance = "Accept a detailed explanation that identifies every required validation step before processing continues safely";

    drawOcrMarkSchemeTableRow(outputDoc, null, {
      unit,
      order: 1,
      text: `8 (a) ${guidance}`,
    }, { regular, bold });

    const pdf = await getPdfDocument((await outputDoc.save()).slice());
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const guidanceLeft = 34 + 92 + 414 + 48 + 8;
    const guidanceItems = content.items.filter((item) => (
      "str" in item
      && "transform" in item
      && item.str !== "Guidance"
      && item.transform[4] >= guidanceLeft
      && item.transform[5] < 520
    ));
    const guidanceRight = guidanceLeft + (841.89 - 68 - 92 - 414 - 48) - 12;
    const extracted = guidanceItems.flatMap((item) => "str" in item ? [item.str] : []).join(" ").replace(/\s+/g, " ").trim();

    expect(extracted).toBe(guidance);
    expect(guidanceItems.every((item) => "transform" in item && "width" in item && item.transform[4] + item.width <= guidanceRight)).toBe(true);
  });
});

describe("selected source answer regions", () => {
  it("plans distinct answer regions once when selected units share a physical page", () => {
    const page = {
      pageNumber: 0,
      sourcePageNumber: 12,
      text: "selected answer",
      lines: [],
      pageWidth: 595,
      pageHeight: 842,
    };

    expect(planSelectedAnswerRegions([
      { unitKey: "first", assetPath: "scheme.pdf", page: { ...page, regionTop: 720, regionBottom: 510 } },
      { unitKey: "second", assetPath: "scheme.pdf", page: { ...page, regionTop: 500, regionBottom: 280 } },
      { unitKey: "duplicate-first", assetPath: "scheme.pdf", page: { ...page, regionTop: 720, regionBottom: 510 } },
    ])).toEqual([
      { assetPath: "scheme.pdf", sourcePageNumber: 12, top: 720, bottom: 510, unitKeys: ["first", "duplicate-first"] },
      { assetPath: "scheme.pdf", sourcePageNumber: 12, top: 500, bottom: 280, unitKeys: ["second"] },
    ]);
  });

  it("extends an answer crop down to the following question boundary", () => {
    expect(planSelectedAnswerRegions([{
      unitKey: "selected",
      assetPath: "scheme.pdf",
      page: {
        pageNumber: 0,
        sourcePageNumber: 12,
        text: "selected answer",
        lines: [],
        pageWidth: 595,
        pageHeight: 842,
        regionTop: 720,
        regionBottom: 612,
        regionNextBottom: 508,
      },
    }])).toEqual([{
      assetPath: "scheme.pdf",
      sourcePageNumber: 12,
      top: 720,
      bottom: 508,
      unitKeys: ["selected"],
    }]);
  });

  it("derives answer bounds from selected lines rather than the preceding page row", () => {
    expect(selectedAnswerRegionBounds(
      [{ ...markSchemeLine("2 (a) selected"), y: 700 }, { ...markSchemeLine("answer guidance"), y: 620 }],
      842,
      { ...markSchemeLine("3 (a) next question"), y: 500 },
    )).toEqual({ regionTop: 708, regionBottom: 560, regionNextBottom: 560 });
  });

  it("bounds mid-gap to the previous row and keeps a column-header row above the selection", () => {
    const header = { ...markSchemeLine("Question Answer Mark scheme Additional guidance"), leftText: "Question", y: 760 };
    const selected = [{ ...markSchemeLine("2 (a) selected"), y: 700 }, { ...markSchemeLine("answer guidance"), y: 620 }];
    expect(selectedAnswerRegionBounds(selected, 842, null, header))
      .toEqual({ regionTop: 780, regionBottom: 612, regionNextBottom: undefined });
    const sibling = { ...markSchemeLine("1 (b) previous part"), y: 760 };
    expect(selectedAnswerRegionBounds(selected, 842, null, sibling))
      .toEqual({ regionTop: 730, regionBottom: 612, regionNextBottom: undefined });
  });

  it("validates the short 2024 Chemistry q7(b) answer region", async () => {
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    const page = source.addPage([841.68, 595.44]);
    page.drawText("7(b) (2) 3 correct scores 2", { x: 24, y: 477, size: 10, font });
    page.drawText("AO1 1 1 or 2 correct scores 1", { x: 24, y: 465, size: 10, font });
    const pdfJsDoc = await getPdfDocument((await source.save()).slice());
    const output = await PDFDocument.create();
    const labelFont = await output.embedFont(StandardFonts.HelveticaBold);

    await expect(drawSelectedAnswerRegion(output, pdfJsDoc, {
      assetPath: "2024-chemistry-paper-2-foundation-mark-scheme.pdf",
      sourcePageNumber: 1,
      top: 485,
      bottom: 457,
      unitKeys: ["q7"],
    }, "Q4", labelFont)).resolves.toBeDefined();
  });

  it("preserves a graphical answer while excluding the neighboring answer", async () => {
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    const page = source.addPage([300, 400]);
    page.drawText("5 (a) selected graphical answer", { x: 24, y: 320, size: 12, font });
    page.drawCircle({ x: 150, y: 250, size: 34, borderColor: rgb(0, 0, 0), borderWidth: 3 });
    page.drawLine({ start: { x: 116, y: 250 }, end: { x: 184, y: 250 }, thickness: 3, color: rgb(0, 0, 0) });
    page.drawText("6 (a) neighboring answer", { x: 24, y: 110, size: 12, font });
    const sourceBytes = await source.save();
    const pdfJsDoc = await getPdfDocument(sourceBytes.slice());
    const output = await PDFDocument.create();
    const labelFont = await output.embedFont(StandardFonts.HelveticaBold);

    await drawSelectedAnswerRegion(output, pdfJsDoc, {
      assetPath: "scheme.pdf",
      sourcePageNumber: 1,
      top: 350,
      bottom: 180,
      unitKeys: ["selected"],
    }, "Q1", labelFont);

    const rendered = await getPdfDocument((await output.save()).slice());
    const renderedPage = await rendered.getPage(1);
    const text = (await renderedPage.getTextContent()).items.flatMap((item) => "str" in item ? [item.str] : []).join(" ");
    const image = await loadImage(await renderPdfPageToPng(rendered, 1, 2));
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const graphicalAnswer = context.getImageData(770, 225, 150, 150).data;
    let darkPixels = 0;
    for (let index = 0; index < graphicalAnswer.length; index += 4) {
      if (graphicalAnswer[index] < 100 && graphicalAnswer[index + 1] < 100 && graphicalAnswer[index + 2] < 100) darkPixels += 1;
    }

    expect(renderedPage.getViewport({ scale: 1 })).toMatchObject({ width: 841.89, height: 595.28 });
    expect(text).not.toContain("neighboring answer");
    expect(darkPixels).toBeGreaterThan(100);
  });

  it("packs a tall region under a lone row when the shrink is mild", () => {
    expect(regionPacksBelow(517, 494)).toBe(true);
    expect(regionPacksBelow(517, 517)).toBe(true);
    expect(regionPacksBelow(560, 494)).toBe(false);
    expect(regionPacksBelow(43, 43)).toBe(true);
    expect(regionPacksBelow(43, 30)).toBe(true);
    expect(regionPacksBelow(43, 20)).toBe(false);
    expect(regionPacksBelow(517, 0)).toBe(false);
  });
});

describe("mark scheme document", () => {
  it("uses A4 pages without generator metadata", async () => {
    const result = await assembleMarkSchemePdf([]);
    const document = await PDFDocument.load(result.bytes, { updateMetadata: false });

    expect(document.getPages().map((page) => page.getSize())).toEqual([{ width: 595.28, height: 841.89 }]);
    expect(document.getTitle()).toBe("GCSE Mark Scheme");
    expect(document.getCreator()).toBeUndefined();
    expect(document.getProducer()).toBeUndefined();
  });
});
