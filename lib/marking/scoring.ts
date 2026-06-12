import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { OpenRouter } from "@openrouter/sdk";

import { getMarkableUnitsByUnitKeys } from "@/lib/marking/paper-maker";
import { getPdfDocument } from "@/lib/marking/pdfjs-server";
import {
  formatQuestionPathLabel,
  isPartStartLineForPath,
  isSiblingPartStartLine,
  parseQuestionPathFromPrompt,
} from "@/lib/marking/question-path";
import { requiresManualReview } from "@/lib/marking/answer-extraction";
import { getPaperAssetsByBoardSubjectFromConvex } from "@/lib/paper-maker/convex";
import type { PaperMakerSubjectKey } from "@/lib/paper-maker/subjects";

const AI_KEY = process.env.HACKCLUB_AI_API_KEY ?? process.env.OPENROUTER_API_KEY;
const AI_SERVER_URL = process.env.HACKCLUB_AI_API_KEY ? "https://ai.hackclub.com/proxy/v1" : undefined;
const AI_MODEL = process.env.OPENROUTER_MODEL ?? "google/gemini-3.1-flash-lite";

type PositionedPdfItem = {
  text: string;
  x: number;
  y: number;
};

type StructuredPdfLine = {
  pageNumber: number;
  y: number;
  leftText: string;
  answerText: string;
  markText: string;
  schemeText: string;
  guidanceText: string;
  fullText: string;
};

type CachedPdfPage = {
  pageNumber: number;
  text: string;
  lines: StructuredPdfLine[];
};

const PDF_TEXT_CACHE = new Map<string, CachedPdfPage[]>();
const PAPER_ASSET_CACHE = new Map<string, Awaited<ReturnType<typeof getPaperAssetsByBoardSubjectFromConvex>>>();

type SubmissionBundle = {
  submission: {
    boardCode: string;
    subjectSlug: string;
    subjectKey: string;
    tier?: "none" | "foundation" | "higher";
    savedPaperId?: string;
  };
  savedPaperQuestions?: Array<{
    unitKey: string;
    paperCode: string;
    year?: number;
    session?: string;
    questionNumber: string;
    questionPartNumber?: string | null;
    questionPath?: string[];
    totalMarks: number;
    promptText: string;
    contextText?: string | null;
    questionType?: string | null;
    isChoiceQuestion?: boolean;
  }>;
  responses: Array<{
    questionKey: string;
    ocrText: string;
    ocrRawJson?: string;
  }>;
};

export type MarkSchemeSnippet = {
  questionNumber: string;
  questionPartNumber: string | null;
  pageNumbers: number[];
  questionText: string;
  partText: string;
  combinedText: string;
  markSchemeRelativePath: string;
  markSchemeUrl: string;
};

export type AutoScoreResult = {
  awardedMarks: number;
  confidence: number;
  needsReview: boolean;
  rationale: string;
  skipped?: boolean;
  evidence: {
    sourceUnit: {
      unitKey: string;
      sourceRelativePath: string;
      paperCode: string;
      year: number | null;
      session: string | null;
      questionNumber: string;
      questionPartNumber: string | null;
      totalMarks: number;
      promptText: string;
      contextText: string | null;
    };
    markScheme: MarkSchemeSnippet;
    studentOcrText: string;
    markBreakdown?: Array<{
      criterion: string;
      awarded: boolean;
      evidence: string;
    }>;
  };
};

function getClient() {
  if (!AI_KEY) throw new Error("Missing HACKCLUB_AI_API_KEY or OPENROUTER_API_KEY");
  return new OpenRouter({
    apiKey: AI_KEY,
    ...(AI_SERVER_URL ? { serverURL: AI_SERVER_URL } : {}),
  });
}

function normalizeInlineText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function inferTierFromSourceRelativePath(sourceRelativePath: string) {
  const normalized = sourceRelativePath.toLowerCase();
  if (normalized.includes("/foundation/")) return "foundation" as const;
  if (normalized.includes("/higher/")) return "higher" as const;
  return "none" as const;
}

function deriveDownloadedPdfPath(relativePath: string) {
  return resolve(process.cwd(), "data", "downloads", ...relativePath.split("/").filter(Boolean));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildStructuredLines(pageNumber: number, items: PositionedPdfItem[]) {
  const grouped = new Map<number, PositionedPdfItem[]>();

  for (const item of items) {
    const bucket = Math.round(item.y / 3) * 3;
    const existing = grouped.get(bucket) ?? [];
    existing.push(item);
    grouped.set(bucket, existing);
  }

  return Array.from(grouped.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([bucketY, bucketItems]) => {
      const sortedItems = [...bucketItems]
        .filter((item) => item.text.trim().length > 0)
        .sort((a, b) => a.x - b.x);

      const leftText = normalizeInlineText(sortedItems.filter((item) => item.x < 120).map((item) => item.text).join(" "));
      const answerText = normalizeInlineText(sortedItems.filter((item) => item.x >= 120 && item.x < 210).map((item) => item.text).join(" "));
      const markText = normalizeInlineText(sortedItems.filter((item) => item.x >= 210 && item.x < 250).map((item) => item.text).join(" "));
      const schemeText = normalizeInlineText(sortedItems.filter((item) => item.x >= 250 && item.x < 560).map((item) => item.text).join(" "));
      const guidanceText = normalizeInlineText(sortedItems.filter((item) => item.x >= 560).map((item) => item.text).join(" "));
      const fullText = normalizeInlineText([leftText, answerText, markText, schemeText, guidanceText].filter(Boolean).join(" "));

      return {
        pageNumber,
        y: bucketY,
        leftText,
        answerText,
        markText,
        schemeText,
        guidanceText,
        fullText,
      } satisfies StructuredPdfLine;
    })
    .filter((line) => line.fullText.length > 0);
}

async function loadPdfTextPages(relativePath: string, remoteUrl: string) {
  if (PDF_TEXT_CACHE.has(relativePath)) return PDF_TEXT_CACHE.get(relativePath)!;

  const localPath = deriveDownloadedPdfPath(relativePath);
  const data = existsSync(localPath)
    ? new Uint8Array(readFileSync(localPath))
    : new Uint8Array(await fetch(remoteUrl).then(async (response) => {
      if (!response.ok) throw new Error(`Failed to load mark scheme PDF (${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    }));

  const document = await getPdfDocument(data);
  const pages: CachedPdfPage[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const positionedItems: PositionedPdfItem[] = textContent.items
      .filter((item) => "str" in item && Array.isArray((item as { transform?: unknown }).transform))
      .map((item) => {
        const textItem = item as { str: string; transform: number[] };
        return {
          text: textItem.str,
          x: textItem.transform[4] ?? 0,
          y: textItem.transform[5] ?? 0,
        };
      });

    pages.push({
      pageNumber,
      text: normalizeInlineText(positionedItems.map((item) => item.text).join(" ")),
      lines: buildStructuredLines(pageNumber, positionedItems),
    });
  }

  PDF_TEXT_CACHE.set(relativePath, pages);
  return pages;
}

function detectPageQuestionNumber(text: string) {
  const headerMatch = text.match(/Additional guidance\s+(\d+)\b/i);
  if (headerMatch) return headerMatch[1];
  const fallbackMatch = text.match(/\b(\d+)\s*\([a-z]\)/i);
  if (fallbackMatch) return fallbackMatch[1];
  return null;
}

function isQuestionStartLine(line: StructuredPdfLine, questionNumber: string) {
  const normalized = line.leftText.toLowerCase();
  const questionPattern = new RegExp(`^${escapeRegExp(questionNumber)}\\b`, "i");
  return questionPattern.test(normalized) || normalized.startsWith(`${questionNumber} (`.toLowerCase());
}

function isPartStartLine(line: StructuredPdfLine, part: string) {
  return new RegExp(`\\(${escapeRegExp(part)}\\)`, "i").test(line.leftText);
}

function isDifferentQuestionLine(line: StructuredPdfLine, questionNumber: string) {
  if (!line.leftText) return false;
  const match = line.leftText.match(/^(\d+)\b/);
  if (!match) return false;
  return match[1] !== questionNumber;
}

function formatStructuredLines(lines: StructuredPdfLine[]) {
  const mergedLines: StructuredPdfLine[] = [];

  for (const line of lines) {
    const previous = mergedLines[mergedLines.length - 1];
    const isContinuation = previous
      && !line.leftText
      && !line.answerText
      && !line.markText
      && Boolean(line.schemeText || line.guidanceText);

    if (isContinuation) {
      previous.schemeText = normalizeInlineText([previous.schemeText, line.schemeText].filter(Boolean).join(" "));
      previous.guidanceText = normalizeInlineText([previous.guidanceText, line.guidanceText].filter(Boolean).join(" "));
      previous.fullText = normalizeInlineText([
        previous.leftText,
        previous.answerText,
        previous.markText,
        previous.schemeText,
        previous.guidanceText,
      ].filter(Boolean).join(" "));
      continue;
    }

    mergedLines.push({ ...line });
  }

  return mergedLines
    .map((line) => {
      const segments = [
        line.leftText ? `Question: ${line.leftText}` : null,
        line.answerText ? `Answer: ${line.answerText}` : null,
        line.markText ? `Marks: ${line.markText}` : null,
        line.schemeText ? `Mark scheme: ${line.schemeText}` : null,
        line.guidanceText ? `Guidance: ${line.guidanceText}` : null,
      ].filter(Boolean);
      return segments.join(" | ");
    })
    .filter(Boolean)
    .join("\n");
}

function fallbackSlicePartText(questionText: string, questionPartNumber: string | null) {
  if (!questionPartNumber) return questionText;
  const normalizedPart = questionPartNumber.trim().toLowerCase();
  const startPattern = new RegExp(`\\(${escapeRegExp(normalizedPart)}\\)`, "i");
  const startMatch = startPattern.exec(questionText);
  if (!startMatch || startMatch.index < 0) return questionText;

  const remainder = questionText.slice(startMatch.index);
  const nextPartMatch = remainder.slice(startMatch[0].length).match(/\([a-z]\)/i);
  if (!nextPartMatch || nextPartMatch.index === undefined) return remainder.trim();
  return remainder.slice(0, startMatch[0].length + nextPartMatch.index).trim();
}

function cleanOcrTextForScoring(promptText: string, contextText: string | null, ocrText: string) {
  const boilerplatePatterns = [
    /^page\s+\d+$/i,
    /^pmt$/i,
    /^do not write.*$/i,
    /^turn over.*$/i,
    /^answer in the spaces provided.*$/i,
    /^total for question.*$/i,
    /^total for paper.*$/i,
    /^paper:\s*1ma1/i,
    /^question\s+answer\s+mark/i,
  ];

  const promptTokens = new Set(normalizeInlineText(`${promptText} ${contextText ?? ""}`).toLowerCase().split(" ").filter((token) => token.length > 2));

  return ocrText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !boilerplatePatterns.some((pattern) => pattern.test(line)))
    .filter((line) => {
      const normalized = normalizeInlineText(line).toLowerCase();
      const tokens = normalized.split(" ").filter((token) => token.length > 2);
      if (tokens.length === 0) return false;
      const overlapCount = tokens.filter((token) => promptTokens.has(token)).length;
      const overlapRatio = overlapCount / tokens.length;
      if (tokens.length <= 12 && overlapRatio >= 0.75) return false;
      return true;
    })
    .join("\n")
    .trim();
}

async function getPaperAssets(boardCode: string, subjectSlug: string) {
  const key = `${boardCode}::${subjectSlug}`;
  if (!PAPER_ASSET_CACHE.has(key)) {
    PAPER_ASSET_CACHE.set(key, await getPaperAssetsByBoardSubjectFromConvex(boardCode, subjectSlug));
  }
  return PAPER_ASSET_CACHE.get(key)!;
}

async function buildMarkSchemeSnippetForUnit(unit: Awaited<ReturnType<typeof getMarkableUnitsByUnitKeys>>[number]) {
  const paperAssets = await getPaperAssets(unit.boardCode, unit.subjectSlug);
  const targetTier = inferTierFromSourceRelativePath(unit.sourceRelativePath);
  const markSchemeAsset = paperAssets.find((asset) => asset.kind === "mark_scheme"
    && asset.paperCode === unit.paperCode
    && asset.year === unit.year
    && asset.session === unit.session
    && asset.tier === targetTier);

  if (!markSchemeAsset) {
    throw new Error(`No mark scheme asset found for ${unit.paperCode} ${unit.year ?? ""} ${unit.session ?? ""}`.trim());
  }

  const pages = await loadPdfTextPages(markSchemeAsset.relativePath, markSchemeAsset.cdnUrl);
  const targetQuestionNumber = unit.questionNumber;
  const collectedPages: CachedPdfPage[] = [];
  let collecting = false;

  for (const page of pages) {
    const pageQuestionNumber = detectPageQuestionNumber(page.text);
    if (!collecting) {
      if (pageQuestionNumber === targetQuestionNumber) {
        collecting = true;
        collectedPages.push(page);
      }
      continue;
    }

    if (pageQuestionNumber && pageQuestionNumber !== targetQuestionNumber) {
      break;
    }
    collectedPages.push(page);
  }

  if (collectedPages.length === 0) {
    throw new Error(`Could not isolate mark scheme text for question ${targetQuestionNumber}`);
  }

  const questionPartNumber = unit.parts[0]?.questionPartNumber ?? null;
  const questionPath = parseQuestionPathFromPrompt(
    unit.parts.map((part) => part.promptText).join("\n\n"),
    targetQuestionNumber,
    questionPartNumber,
  );
  const questionLines = collectedPages.flatMap((page) => page.lines);
  const relevantQuestionLines = questionLines.filter((line) => !/^(paper:|question\s+answer\s+mark\s+mark scheme|additional guidance|pmt)$/i.test(line.fullText));
  const questionStartIndex = relevantQuestionLines.findIndex((line) => isQuestionStartLine(line, targetQuestionNumber));
  const boundedQuestionLines = questionStartIndex >= 0
    ? relevantQuestionLines.slice(questionStartIndex)
    : relevantQuestionLines;

  const trimmedQuestionLines: StructuredPdfLine[] = [];
  for (const line of boundedQuestionLines) {
    if (trimmedQuestionLines.length > 0 && isDifferentQuestionLine(line, targetQuestionNumber)) {
      break;
    }
    trimmedQuestionLines.push(line);
  }

  let partLines = trimmedQuestionLines;
  if (questionPath.length > 0) {
    const startIndex = trimmedQuestionLines.findIndex((line) => isPartStartLineForPath(line.leftText, questionPath));
    if (startIndex >= 0) {
      const collected: StructuredPdfLine[] = [];
      for (let index = startIndex; index < trimmedQuestionLines.length; index += 1) {
        const line = trimmedQuestionLines[index];
        if (index > startIndex && isSiblingPartStartLine(line.leftText, questionPath)) break;
        if (index > startIndex && isDifferentQuestionLine(line, targetQuestionNumber)) break;
        collected.push(line);
      }
      if (collected.length > 0) partLines = collected;
    }
  } else if (questionPartNumber) {
    const startIndex = trimmedQuestionLines.findIndex((line) => isPartStartLine(line, questionPartNumber));
    if (startIndex >= 0) {
      const collected: StructuredPdfLine[] = [];
      for (let index = startIndex; index < trimmedQuestionLines.length; index += 1) {
        const line = trimmedQuestionLines[index];
        if (index > startIndex && line.leftText && /\([a-z]\)/i.test(line.leftText) && !isPartStartLine(line, questionPartNumber)) {
          break;
        }
        if (index > startIndex && isDifferentQuestionLine(line, targetQuestionNumber)) {
          break;
        }
        collected.push(line);
      }
      if (collected.length > 0) {
        partLines = collected;
      }
    }
  }

  const questionText = formatStructuredLines(trimmedQuestionLines).trim();
  const partText = formatStructuredLines(partLines).trim() || fallbackSlicePartText(questionText, questionPartNumber);

  return {
    questionNumber: targetQuestionNumber,
    questionPartNumber,
    pageNumbers: collectedPages.map((page) => page.pageNumber),
    questionText,
    partText,
    combinedText: [questionText, partText !== questionText ? partText : null].filter(Boolean).join("\n\n---\n\n"),
    markSchemeRelativePath: markSchemeAsset.relativePath,
    markSchemeUrl: markSchemeAsset.cdnUrl,
  } satisfies MarkSchemeSnippet;
}

export async function resolveSubmissionQuestionContext(bundle: SubmissionBundle, questionKey: string) {
  const savedPaperQuestion = bundle.savedPaperQuestions?.find((question) => question.unitKey === questionKey);
  if (!savedPaperQuestion) {
    throw new Error("This submission is not linked to a saved generated paper question.");
  }

  const unit = (await getMarkableUnitsByUnitKeys(bundle.submission.subjectKey as PaperMakerSubjectKey, [savedPaperQuestion.unitKey]))[0];
  if (!unit) {
    throw new Error(`Could not resolve source unit for ${savedPaperQuestion.unitKey}`);
  }

  const response = bundle.responses.find((entry) => entry.questionKey === questionKey);
  if (!response?.ocrText?.trim()) {
    throw new Error("OCR text is missing for this question.");
  }

  const markScheme = await buildMarkSchemeSnippetForUnit(unit);
  const alreadyAnswerExtracted = Boolean(response.ocrRawJson?.includes("answerExtraction"));
  const cleanedOcrText = alreadyAnswerExtracted
    ? response.ocrText
    : cleanOcrTextForScoring(
      savedPaperQuestion.promptText,
      savedPaperQuestion.contextText ?? null,
      response.ocrText,
    );

  return {
    unit,
    response: {
      ...response,
      ocrText: cleanedOcrText || response.ocrText,
    },
    savedPaperQuestion,
    markScheme,
  };
}

export async function buildCombinedMarkScheme(bundle: SubmissionBundle) {
  const questions = bundle.savedPaperQuestions ?? [];
  const results = await Promise.all(questions.map(async (question) => {
    try {
      const unit = (await getMarkableUnitsByUnitKeys(bundle.submission.subjectKey as PaperMakerSubjectKey, [question.unitKey]))[0];
      if (!unit) {
        return {
          ok: false as const,
          questionKey: question.unitKey,
          error: `Could not resolve source unit for ${question.unitKey}`,
        };
      }
      const markScheme = await buildMarkSchemeSnippetForUnit(unit);
      const questionPath = question.questionPath
        ?? parseQuestionPathFromPrompt(question.promptText, question.questionNumber, question.questionPartNumber ?? null);
      return {
        ok: true as const,
        questionKey: question.unitKey,
        label: formatQuestionPathLabel(question.questionNumber, questionPath),
        markScheme,
      };
    } catch (error) {
      return {
        ok: false as const,
        questionKey: question.unitKey,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));

  const entries = results.filter((entry): entry is Extract<typeof entry, { ok: true }> => entry.ok);
  const failures = results.filter((entry): entry is Extract<typeof entry, { ok: false }> => !entry.ok);
  return {
    entries,
    failures,
    combinedText: entries.map((entry) => `${entry.label}\n${entry.markScheme.partText}`).join("\n\n================\n\n"),
  };
}

export async function autoScoreMathQuestion(bundle: SubmissionBundle, questionKey: string): Promise<AutoScoreResult> {
  const { unit, response, savedPaperQuestion, markScheme } = await resolveSubmissionQuestionContext(bundle, questionKey);
  if (savedPaperQuestion.isChoiceQuestion || savedPaperQuestion.questionType === "multiple-choice") {
    return {
      awardedMarks: 0,
      confidence: 0,
      needsReview: true,
      skipped: true,
      rationale: "Multiple-choice questions are excluded from AI marking and should use a deterministic answer-detection path or manual review.",
      evidence: {
        sourceUnit: {
          unitKey: unit.unitKey,
          sourceRelativePath: unit.sourceRelativePath,
          paperCode: unit.paperCode,
          year: unit.year,
          session: unit.session,
          questionNumber: unit.questionNumber,
          questionPartNumber: unit.parts[0]?.questionPartNumber ?? null,
          totalMarks: unit.totalMarks,
          promptText: unit.parts.map((part) => part.promptText).join("\n\n"),
          contextText: unit.parts.map((part) => part.contextText ?? "").filter(Boolean).join("\n\n") || null,
        },
        markScheme,
        studentOcrText: response.ocrText,
      },
    };
  }
  const client = getClient();

  const systemPrompt = [
    "You are a cautious GCSE Edexcel Mathematics marker.",
    "Mark only the specific question part requested.",
    "Use the mark scheme excerpt as the authority.",
    "Do not invent unseen working.",
    "If the OCR is unclear, ambiguous, or incomplete, lower confidence and set needsReview true.",
    "Return strict JSON only.",
  ].join(" ");

  const userPrompt = JSON.stringify({
    task: "Mark one Edexcel GCSE Maths response.",
    question: {
      questionNumber: unit.questionNumber,
      questionPartNumber: unit.parts[0]?.questionPartNumber ?? null,
      maxMarks: unit.totalMarks,
      promptText: unit.parts.map((part) => part.promptText).join("\n\n"),
      contextText: unit.parts.map((part) => part.contextText ?? "").filter(Boolean).join("\n\n") || null,
    },
    studentResponse: {
      ocrText: response.ocrText,
    },
    markScheme: {
      relevantPartText: markScheme.partText,
      fullQuestionText: markScheme.questionText,
      pageNumbers: markScheme.pageNumbers,
    },
    outputSchema: {
      awardedMarks: "integer between 0 and maxMarks",
      confidence: "number between 0 and 1",
      needsReview: "boolean",
      rationale: "short plain-English explanation",
      markBreakdown: [
        {
          criterion: "string",
          awarded: "boolean",
          evidence: "short quote or paraphrase from OCR text",
        },
      ],
    },
  }, null, 2);

  const responsePayload = await client.chat.send({
    chatRequest: {
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      responseFormat: { type: "json_object" },
      maxTokens: 1800,
    },
  });

  const content = responsePayload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("The scoring model returned no content.");
  }

  const parsed = JSON.parse(content) as {
    awardedMarks?: number;
    confidence?: number;
    needsReview?: boolean;
    rationale?: string;
    markBreakdown?: Array<{ criterion?: string; awarded?: boolean; evidence?: string }>;
  };

  const awardedMarks = Math.max(0, Math.min(unit.totalMarks, Math.round(parsed.awardedMarks ?? 0)));
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5)));
  const needsReview = parsed.needsReview === true || confidence < 0.65;
  const rationale = typeof parsed.rationale === "string" && parsed.rationale.trim()
    ? parsed.rationale.trim()
    : "Auto-scored against the retrieved mark scheme excerpt.";

  return {
    awardedMarks,
    confidence,
    needsReview,
    rationale,
    evidence: {
      sourceUnit: {
        unitKey: unit.unitKey,
        sourceRelativePath: unit.sourceRelativePath,
        paperCode: unit.paperCode,
        year: unit.year,
        session: unit.session,
        questionNumber: unit.questionNumber,
        questionPartNumber: unit.parts[0]?.questionPartNumber ?? null,
        totalMarks: unit.totalMarks,
        promptText: unit.parts.map((part) => part.promptText).join("\n\n"),
        contextText: unit.parts.map((part) => part.contextText ?? "").filter(Boolean).join("\n\n") || null,
      },
      markScheme,
      studentOcrText: response.ocrText,
      markBreakdown: (parsed.markBreakdown ?? [])
        .map((entry) => ({
          criterion: entry.criterion ?? "criterion",
          awarded: entry.awarded === true,
          evidence: entry.evidence ?? "",
        }))
        .filter((entry) => entry.criterion || entry.evidence),
    },
  };
}

export async function autoScoreMathPaper(bundle: SubmissionBundle) {
  const questions = bundle.savedPaperQuestions ?? [];
  if (questions.length === 0) {
    throw new Error("This submission is not linked to a saved paper.");
  }

  const contexts = await Promise.all(questions.map(async (question) => {
    if (question.isChoiceQuestion || question.questionType === "multiple-choice") {
      return { questionKey: question.unitKey, skipped: true, reason: "Multiple-choice question", context: null };
    }
    if (requiresManualReview(question.promptText, question.contextText ?? null)) {
      return { questionKey: question.unitKey, skipped: true, reason: "Needs manual review (graph, construction, or diagram)", context: null };
    }
    try {
      const context = await resolveSubmissionQuestionContext(bundle, question.unitKey);
      return { questionKey: question.unitKey, skipped: false, reason: null, context };
    } catch (error) {
      return {
        questionKey: question.unitKey,
        skipped: true,
        reason: error instanceof Error ? error.message : String(error),
        context: null,
      };
    }
  }));

  const scoreable = contexts.filter((entry) => !entry.skipped && entry.context) as Array<{ questionKey: string; skipped: false; context: NonNullable<(typeof contexts)[number]["context"]> }>;
  let parsedByQuestionKey = new Map<string, {
    questionKey?: string;
    awardedMarks?: number;
    confidence?: number;
    needsReview?: boolean;
    rationale?: string;
    markBreakdown?: Array<{ criterion?: string; awarded?: boolean; evidence?: string }>;
  }>();

  if (scoreable.length > 0) {
    const client = getClient();
    const payload = scoreable.map(({ questionKey, context }) => ({
      questionKey,
      questionNumber: context.unit.questionNumber,
      questionPartNumber: context.unit.parts[0]?.questionPartNumber ?? null,
      maxMarks: context.unit.totalMarks,
      promptText: context.unit.parts.map((part) => part.promptText).join("\n\n"),
      contextText: context.unit.parts.map((part) => part.contextText ?? "").filter(Boolean).join("\n\n") || null,
      studentResponse: context.response.ocrText,
      markScheme: context.markScheme.partText,
    }));

    const systemPrompt = [
      "You are a cautious GCSE Edexcel Mathematics marker.",
      "Mark a whole paper in one pass.",
      "Every question already has its own relevant mark scheme excerpt.",
      "Do not mix criteria across questions.",
      "Do not invent unseen working.",
      "Return strict JSON only with one result per questionKey.",
    ].join(" ");

    const userPrompt = JSON.stringify({
      task: "Mark this whole Edexcel GCSE Maths paper question-by-question.",
      questions: payload,
      outputSchema: {
        results: payload.map((question) => ({
          questionKey: question.questionKey,
          awardedMarks: "integer between 0 and maxMarks",
          confidence: "number between 0 and 1",
          needsReview: "boolean",
          rationale: "short plain-English explanation",
          markBreakdown: [{ criterion: "string", awarded: "boolean", evidence: "short quote or paraphrase from OCR text" }],
        })),
      },
    }, null, 2);

    const responsePayload = await client.chat.send({
      chatRequest: {
        model: AI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        responseFormat: { type: "json_object" },
        maxTokens: 5000,
      },
    });

    const content = responsePayload?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("The whole-paper scoring model returned no content.");
    }

    const parsed = JSON.parse(content) as {
      results?: Array<{
        questionKey?: string;
        awardedMarks?: number;
        confidence?: number;
        needsReview?: boolean;
        rationale?: string;
        markBreakdown?: Array<{ criterion?: string; awarded?: boolean; evidence?: string }>;
      }>;
    };

    parsedByQuestionKey = new Map((parsed.results ?? []).map((entry) => [entry.questionKey ?? "", entry]));
  }

  return contexts.map((entry) => {
    if (entry.skipped || !entry.context) {
      return {
        questionKey: entry.questionKey,
        reason: entry.reason,
        result: {
          awardedMarks: 0,
          confidence: 0,
          needsReview: true,
          skipped: true,
          rationale: entry.reason || "Question was not eligible for AI scoring.",
          evidence: {
            sourceUnit: {
              unitKey: entry.context?.unit.unitKey ?? entry.questionKey,
              sourceRelativePath: entry.context?.unit.sourceRelativePath ?? "",
              paperCode: entry.context?.unit.paperCode ?? "",
              year: entry.context?.unit.year ?? null,
              session: entry.context?.unit.session ?? null,
              questionNumber: entry.context?.unit.questionNumber ?? "",
              questionPartNumber: entry.context?.unit.parts[0]?.questionPartNumber ?? null,
              totalMarks: entry.context?.unit.totalMarks ?? 0,
              promptText: entry.context?.unit.parts.map((part: { promptText: string }) => part.promptText).join("\n\n") ?? "",
              contextText: entry.context?.unit.parts.map((part: { contextText?: string | null }) => part.contextText ?? "").filter(Boolean).join("\n\n") || null,
            },
            markScheme: entry.context?.markScheme ?? {
              questionNumber: "",
              questionPartNumber: null,
              pageNumbers: [],
              questionText: "",
              partText: "",
              combinedText: "",
              markSchemeRelativePath: "",
              markSchemeUrl: "",
            },
            studentOcrText: entry.context?.response.ocrText ?? "",
          },
        } satisfies AutoScoreResult,
      };
    }

    const modelResult = parsedByQuestionKey.get(entry.questionKey);
    const awardedMarks = Math.max(0, Math.min(entry.context.unit.totalMarks, Math.round(modelResult?.awardedMarks ?? 0)));
    const confidence = Math.max(0, Math.min(1, Number(modelResult?.confidence ?? 0.5)));

    return {
      questionKey: entry.questionKey,
      result: {
        awardedMarks,
        confidence,
        needsReview: modelResult?.needsReview === true || confidence < 0.65,
        rationale: typeof modelResult?.rationale === "string" && modelResult.rationale.trim()
          ? modelResult.rationale.trim()
          : "Auto-scored against the retrieved mark scheme excerpt.",
        evidence: {
          sourceUnit: {
            unitKey: entry.context.unit.unitKey,
            sourceRelativePath: entry.context.unit.sourceRelativePath,
            paperCode: entry.context.unit.paperCode,
            year: entry.context.unit.year,
            session: entry.context.unit.session,
            questionNumber: entry.context.unit.questionNumber,
            questionPartNumber: entry.context.unit.parts[0]?.questionPartNumber ?? null,
            totalMarks: entry.context.unit.totalMarks,
            promptText: entry.context.unit.parts.map((part) => part.promptText).join("\n\n"),
            contextText: entry.context.unit.parts.map((part) => part.contextText ?? "").filter(Boolean).join("\n\n") || null,
          },
          markScheme: entry.context.markScheme,
          studentOcrText: entry.context.response.ocrText,
          markBreakdown: (modelResult?.markBreakdown ?? [])
            .map((breakdown) => ({
              criterion: breakdown.criterion ?? "criterion",
              awarded: breakdown.awarded === true,
              evidence: breakdown.evidence ?? "",
            }))
            .filter((breakdown) => breakdown.criterion || breakdown.evidence),
        },
      } satisfies AutoScoreResult,
    };
  });
}
