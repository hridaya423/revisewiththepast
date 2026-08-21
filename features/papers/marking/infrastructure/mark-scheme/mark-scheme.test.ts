import { describe, expect, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import type { QuestionBankPart, QuestionUnit } from "@/shared/domain/paper";
import { getPdfDocument, renderPdfPageToPng } from "@/features/papers/infrastructure/pdfjs-server";
import { buildStructuredEntry, drawOcrMarkSchemeTableRow, drawSelectedAnswerRegion, findAqaNumberedQuestionStartIndex, formatGeneratedTotalRow, getOwnedOcrQuestionNumbers, markSchemeDocumentMatchesUnitIdentity, planSelectedAnswerRegions, resolveMarkSchemeAsset, splitMarkSchemePagesByParts, stripMatchedPrompt } from "./mark-scheme";

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
    const graphicalAnswer = context.getImageData(220, 170, 160, 120).data;
    let darkPixels = 0;
    for (let index = 0; index < graphicalAnswer.length; index += 4) {
      if (graphicalAnswer[index] < 100 && graphicalAnswer[index + 1] < 100 && graphicalAnswer[index + 2] < 100) darkPixels += 1;
    }

    expect(renderedPage.getViewport({ scale: 1 }).height).toBe(188);
    expect(text).not.toContain("neighboring answer");
    expect(darkPixels).toBeGreaterThan(100);
  });
});
