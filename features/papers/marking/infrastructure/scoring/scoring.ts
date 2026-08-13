import "server-only";

import { OpenRouter } from "@openrouter/sdk";
import type { FunctionReturnType } from "convex/server";
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { getMarkableUnitsByUnitKeys } from "@/features/papers/infrastructure/paper-maker";
import {
  locateMarkSchemePagesForUnit,
  normalizeQuestionNumber,
  type StructuredPdfLine,
} from "../mark-scheme/mark-scheme";
import {
  formatQuestionPathLabel,
  isPartStartLineForPath,
  isSiblingPartStartLine,
  parseQuestionPathFromPrompt,
} from "../../domain/question-path";
import { requiresManualReview } from "../../domain/answer-extraction";
import { getPaperMakerSubject } from "@/shared/domain/subject-catalog";
import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import { getServerEnvironment } from "@/shared/infrastructure/env/server";
import { normalizeScoreModelResult } from "./model-result";
import { cleanOcrTextForScoring, escapeRegExp, fallbackSlicePartText, formatStructuredLines } from "./text";

export { normalizeScoreModelResult } from "./model-result";

const batchScoreResponseSchema = z.object({
  results: z.array(z.object({
    questionKey: z.string().optional(),
    awardedMarks: z.number().optional(),
    confidence: z.number().optional(),
    needsReview: z.boolean().optional(),
    rationale: z.string().optional(),
    markBreakdown: z.array(z.object({
      criterion: z.string().optional(),
      awarded: z.boolean().optional(),
      evidence: z.string().optional(),
    })).optional(),
  })).optional(),
});

const environment = getServerEnvironment();
const AI_KEY = environment.HACKCLUB_AI_API_KEY ?? environment.OPENROUTER_API_KEY;
const AI_SERVER_URL = environment.HACKCLUB_AI_API_KEY ? "https://ai.hackclub.com/proxy/v1" : undefined;
const AI_MODEL = environment.OPENROUTER_MODEL;

export type SubmissionBundle = NonNullable<FunctionReturnType<typeof api.marking.getMarkingSubmissionBundle>>;

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

function deriveExamLabel(subjectKey: string) {
  const subject = getPaperMakerSubject(subjectKey);
  if (!subject) return "GCSE";
  return `GCSE ${subject.boardLabel} ${subject.coverTitle}`.replace(/\s+/g, " ").trim();
}

function getScoringTier(tier: SubmissionBundle["submission"]["tier"]) {
  return tier === "foundation" || tier === "higher" ? tier : null;
}

function isQuestionStartLine(line: StructuredPdfLine, questionNumber: string) {
  const normalized = line.leftText.toLowerCase();
  const numberMatch = normalized.match(/^(\d+)\b/);
  if (numberMatch && normalizeQuestionNumber(numberMatch[1]) === questionNumber) return true;
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
  return normalizeQuestionNumber(match[1]) !== questionNumber;
}

async function buildMarkSchemeSnippetForUnit(unit: Awaited<ReturnType<typeof getMarkableUnitsByUnitKeys>>[number]) {
  const { markSchemeAsset, collectedPages } = await locateMarkSchemePagesForUnit(unit);
  const targetQuestionNumber = normalizeQuestionNumber(unit.questionNumber);

  const questionPartNumber = unit.parts.length === 1 ? unit.parts[0]?.questionPartNumber ?? null : null;
  const questionPath = parseQuestionPathFromPrompt(
    unit.parts.map((part) => part.promptText).join("\n\n"),
    targetQuestionNumber,
    questionPartNumber,
  );
  const questionLines = collectedPages.flatMap((page) => page.lines);
  const relevantQuestionLines = questionLines.filter((line) => !/^(paper:|question\s+answer\s+mark\s+mark scheme|additional guidance|pmt)$/i.test(line.fullText));
  const questionStartIndex = relevantQuestionLines.findIndex((line) => isQuestionStartLine(line, targetQuestionNumber));
  if (questionStartIndex < 0) {
    throw new Error(`Could not locate question ${targetQuestionNumber} inside the retrieved mark scheme pages.`);
  }
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
    if (startIndex < 0) {
      throw new Error(`Could not locate question part ${formatQuestionPathLabel(targetQuestionNumber, questionPath)} in the mark scheme.`);
    }
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
    if (startIndex < 0) {
      throw new Error(`Could not locate question part (${questionPartNumber}) in the mark scheme.`);
    }
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

  const unit = (await getMarkableUnitsByUnitKeys(
    bundle.submission.subjectKey as PaperMakerSubjectKey,
    [savedPaperQuestion.unitKey],
    getScoringTier(bundle.submission.tier),
  ))[0];
  if (!unit) {
    throw new Error(`Could not resolve source unit for ${savedPaperQuestion.unitKey}`);
  }

  const response = bundle.responses.find((entry) => entry.questionKey === questionKey);
  const rawOcrText = response?.ocrText?.trim() ?? "";
  const hasRawOcrText = rawOcrText.length > 0;

  const markScheme = await buildMarkSchemeSnippetForUnit(unit);
  const alreadyAnswerExtracted = Boolean(response?.ocrRawJson?.includes("answerExtraction"));
  const cleanedOcrText = !hasRawOcrText
    ? ""
    : alreadyAnswerExtracted
      ? response!.ocrText
      : cleanOcrTextForScoring(
        savedPaperQuestion.promptText,
        savedPaperQuestion.contextText ?? null,
        response!.ocrText,
      );
  const scoringOcrText = cleanedOcrText.trim();

  return {
    unit,
    response: {
      questionKey,
      ocrText: scoringOcrText,
      ocrRawJson: response?.ocrRawJson,
    },
    savedPaperQuestion,
    markScheme,
    hasOcrText: scoringOcrText.length > 0,
  };
}

export async function buildCombinedMarkScheme(bundle: SubmissionBundle) {
  const questions = bundle.savedPaperQuestions ?? [];
  const results = await Promise.all(questions.map(async (question) => {
    try {
      const unit = (await getMarkableUnitsByUnitKeys(
        bundle.submission.subjectKey as PaperMakerSubjectKey,
        [question.unitKey],
        getScoringTier(bundle.submission.tier),
      ))[0];
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
  const { unit, response, savedPaperQuestion, markScheme, hasOcrText } = await resolveSubmissionQuestionContext(bundle, questionKey);

  const buildSkipped = (rationale: string): AutoScoreResult => ({
    awardedMarks: 0,
    confidence: 0,
    needsReview: true,
    skipped: true,
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
        contextText: unit.parts.flatMap((part) => part.contextText ? [part.contextText] : []).join("\n\n") || null,
      },
      markScheme,
      studentOcrText: response.ocrText,
    },
  });

  if (savedPaperQuestion.isChoiceQuestion || savedPaperQuestion.questionType === "multiple-choice") {
    return buildSkipped("Multiple-choice questions are excluded from AI marking and should use a deterministic answer-detection path or manual review.");
  }
  if (requiresManualReview(savedPaperQuestion.promptText, savedPaperQuestion.contextText ?? null)) {
    return buildSkipped("This question needs manual review because it depends on a graph, construction, or diagram.");
  }
  if (!hasOcrText) {
    return buildSkipped("No student answer was detected for this question. Check the script pages and mark manually.");
  }
  const client = getClient();
  const examLabel = deriveExamLabel(bundle.submission.subjectKey);

  const systemPrompt = [
    `You are a cautious ${examLabel} marker.`,
    "Mark only the specific question part requested.",
    "Use the mark scheme excerpt as the authority.",
    "Do not invent unseen working.",
    "If the OCR is unclear, ambiguous, or incomplete, lower confidence and set needsReview true.",
    "Return strict JSON only.",
  ].join(" ");

  const userPrompt = JSON.stringify({
    task: `Mark one ${examLabel} response.`,
    question: {
      questionNumber: unit.questionNumber,
      questionPartNumber: unit.parts[0]?.questionPartNumber ?? null,
      maxMarks: unit.totalMarks,
      promptText: unit.parts.map((part) => part.promptText).join("\n\n"),
      contextText: unit.parts.flatMap((part) => part.contextText ? [part.contextText] : []).join("\n\n") || null,
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

  const parsed = JSON.parse(content) as Parameters<typeof normalizeScoreModelResult>[0];
  const score = normalizeScoreModelResult(parsed, unit.totalMarks);

  return {
    awardedMarks: score.awardedMarks,
    confidence: score.confidence,
    needsReview: score.needsReview,
    rationale: score.rationale,
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
        contextText: unit.parts.flatMap((part) => part.contextText ? [part.contextText] : []).join("\n\n") || null,
      },
      markScheme,
      studentOcrText: response.ocrText,
      markBreakdown: score.markBreakdown,
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
      if (!context.hasOcrText) {
        return {
          questionKey: question.unitKey,
          skipped: true,
          reason: "No student answer was detected for this question. Check the script pages and mark manually.",
          context,
        };
      }
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
      contextText: context.unit.parts.flatMap((part) => part.contextText ? [part.contextText] : []).join("\n\n") || null,
      studentResponse: context.response.ocrText,
      markScheme: context.markScheme.partText,
    }));

    const examLabel = deriveExamLabel(bundle.submission.subjectKey);
    const systemPrompt = [
      `You are a cautious ${examLabel} marker.`,
      "Mark a whole paper in one pass.",
      "Every question already has its own relevant mark scheme excerpt.",
      "Do not mix criteria across questions.",
      "Do not invent unseen working.",
      "Return strict JSON only with one result per questionKey.",
    ].join(" ");

    const userPrompt = JSON.stringify({
      task: `Mark this whole ${examLabel} paper question-by-question.`,
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

    const parsed = batchScoreResponseSchema.parse(JSON.parse(content));

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
              contextText: entry.context?.unit.parts.flatMap((part: { contextText?: string | null }) => part.contextText ? [part.contextText] : []).join("\n\n") || null,
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
    const score = normalizeScoreModelResult(modelResult, entry.context.unit.totalMarks);

    return {
      questionKey: entry.questionKey,
      result: {
        awardedMarks: score.awardedMarks,
        confidence: score.confidence,
        needsReview: score.needsReview,
        rationale: score.rationale,
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
            contextText: entry.context.unit.parts.flatMap((part) => part.contextText ? [part.contextText] : []).join("\n\n") || null,
          },
          markScheme: entry.context.markScheme,
          studentOcrText: entry.context.response.ocrText,
          markBreakdown: score.markBreakdown,
        },
      } satisfies AutoScoreResult,
    };
  });
}
