import { NextRequest } from "next/server";

import { expandAqaBusinessTopicSelection } from "@/lib/paper-maker/aqa-business";
import { expandTopicSelection, groupQuestionPartsIntoUnits, selectQuestionUnits } from "@/lib/paper-maker/aqa-geography";
import { buildRealPaperBenchmark, estimateMarksFromTimeMinutes } from "@/lib/paper-maker/benchmarks";
import {
  expandCombinedScienceTopicSelection,
  filterCombinedScienceQuestionBankByTier,
  type SubjectTierKey,
} from "@/lib/paper-maker/combined-science";
import { getAqaGeographyQuestionBankFromConvex, getPaperMakerQuestionBankFromConvex, getQuestionPageAssetsBySourceRelativePaths } from "@/lib/paper-maker/convex";
import { estimatePaperTimeMinutes, getPaperMakerSubject } from "@/lib/paper-maker/subjects";
import { generateStrictSourcePaperPdf } from "@/lib/paper-maker/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GeneratePaperRequest = {
  subjectKey?: string;
  subjectTier?: SubjectTierKey;
  selectedTopicNodeIds?: string[];
  targetMarks?: number;
  timeMinutes?: number;
  targetMode?: "marks" | "time";
  paperCodes?: string[];
  maxQuestions?: number;
};

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

export async function POST(request: NextRequest) {
  let body: GeneratePaperRequest;
  try {
    body = (await request.json()) as GeneratePaperRequest;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const selectedTopicNodeIds = Array.isArray(body.selectedTopicNodeIds)
    ? body.selectedTopicNodeIds.filter((value): value is string => typeof value === "string")
    : [];
  const subjectKey = typeof body.subjectKey === "string" ? body.subjectKey : "aqa-geography";
  const paperCodes = Array.isArray(body.paperCodes)
    ? body.paperCodes.filter((value): value is string => typeof value === "string")
    : [];
  const subjectTier = body.subjectTier === "foundation" || body.subjectTier === "higher"
    ? body.subjectTier
    : undefined;
  const requestedTimeMinutes = typeof body.timeMinutes === "number" && Number.isFinite(body.timeMinutes)
    ? Math.max(15, Math.min(300, Math.round(body.timeMinutes)))
    : undefined;
  const targetMode = body.targetMode === "time" ? "time" : "marks";
  const targetMarks = typeof body.targetMarks === "number" && Number.isFinite(body.targetMarks)
    ? Math.max(1, Math.min(200, Math.round(body.targetMarks)))
    : 40;
  const maxQuestions = typeof body.maxQuestions === "number" && Number.isFinite(body.maxQuestions)
    ? Math.max(1, Math.min(40, Math.round(body.maxQuestions)))
    : undefined;

  const subject = getPaperMakerSubject(subjectKey);
  if (!subject) {
    return badRequest("Unknown subject selection.");
  }

  if (!subject.generationEnabled) {
    return badRequest(`${subject.label} is not enabled for generation yet.`, 501);
  }

  if (subject.key === "aqa-geography") {
    if (selectedTopicNodeIds.length === 0) {
      return badRequest("Select at least one topic.");
    }

    const questionBank = await getAqaGeographyQuestionBankFromConvex();
    if (questionBank.length === 0) {
      return badRequest("No tagged AQA Geography question bank is available in Convex.", 500);
    }

    const selectedLeafTopicIds = expandTopicSelection(selectedTopicNodeIds);
    if (selectedLeafTopicIds.length === 0) {
      return badRequest("The selected topics do not map to any question-bank topics.");
    }

    const allUnits = groupQuestionPartsIntoUnits(questionBank);
    const filteredBenchmarkUnits = allUnits.filter((unit) => paperCodes.length === 0 || paperCodes.includes(unit.paperCode));
    const benchmark = buildRealPaperBenchmark(filteredBenchmarkUnits);
    const resolvedTargetMarks = targetMode === "time"
      ? estimateMarksFromTimeMinutes(
          requestedTimeMinutes ?? estimatePaperTimeMinutes(subject.recommendedMinutesPerMark, targetMarks),
          benchmark.averageMinutesPerMark,
          subject.recommendedMinutesPerMark,
        )
      : targetMarks;
    const selection = selectQuestionUnits({
      units: allUnits,
      selectedLeafTopicIds,
      targetMarks: resolvedTargetMarks,
      paperCodes,
      maxQuestions,
      tolerance: 7,
    });

    if (selection.selectedUnits.length === 0) {
      return badRequest("No source-page questions matched the selected topics and filters.");
    }

    const pageAssetsBySource = await getQuestionPageAssetsBySourceRelativePaths(
      selection.selectedUnits.map((unit) => unit.sourceRelativePath),
    );

    const pdfBytes = await generateStrictSourcePaperPdf({
      title: `AQA Geography Custom Paper (${resolvedTargetMarks} marks target)`,
      selectedUnits: selection.selectedUnits,
      allUnits,
      pageAssetsBySource,
      coverPage: {
        boardLabel: subject.boardLabel,
        subjectLabel: subject.coverTitle,
        codeLabel: subject.codeLabel,
        totalMarks: selection.totalMarks,
        timeMinutes: targetMode === "time"
          ? (requestedTimeMinutes ?? estimatePaperTimeMinutes(subject.recommendedMinutesPerMark, selection.totalMarks))
          : estimatePaperTimeMinutes(benchmark.averageMinutesPerMark ?? subject.recommendedMinutesPerMark, selection.totalMarks),
        paperLabels: subject.paperOptions.filter((paper) => paperCodes.length === 0 || paperCodes.includes(paper.code)).map((paper) => paper.label),
      },
    });
    const timeMinutes = targetMode === "time"
      ? (requestedTimeMinutes ?? estimatePaperTimeMinutes(subject.recommendedMinutesPerMark, selection.totalMarks))
      : estimatePaperTimeMinutes(benchmark.averageMinutesPerMark ?? subject.recommendedMinutesPerMark, selection.totalMarks);

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="aqa-geography-custom-paper-${resolvedTargetMarks}m.pdf"`,
        "X-Question-Count": String(selection.selectedUnits.length),
        "X-Total-Marks": String(selection.totalMarks),
        "X-Resolved-Target-Marks": String(resolvedTargetMarks),
        "X-Covered-Topics": String(selection.coveredLeafTopicIds.length),
        "X-Time-Minutes": String(timeMinutes),
        "X-Target-Mode": targetMode,
      },
    });
  }

  if (subject.key === "edexcel-combined-science") {
    if (!subjectTier) {
      return badRequest("Select Foundation or Higher for Combined Science.");
    }
    if (selectedTopicNodeIds.length === 0) {
      return badRequest("Select at least one Combined Science topic.");
    }

    const questionBank = await getPaperMakerQuestionBankFromConvex(subject.boardCode, subject.subjectSlug);
    if (questionBank.length === 0) {
      return badRequest("No tagged Edexcel Combined Science question bank is available in Convex.", 500);
    }

    const tierQuestionBank = filterCombinedScienceQuestionBankByTier(questionBank, subjectTier);
    if (tierQuestionBank.length === 0) {
      return badRequest(`No tagged ${subjectTier} Combined Science questions are available.`, 500);
    }

    const allUnits = groupQuestionPartsIntoUnits(tierQuestionBank);
    const selectedLeafTopicIds = expandCombinedScienceTopicSelection(selectedTopicNodeIds, allUnits);
    if (selectedLeafTopicIds.length === 0) {
      return badRequest("The selected Combined Science topics do not map to any question-bank topics.");
    }
    const filteredBenchmarkUnits = allUnits.filter((unit) => paperCodes.length === 0 || paperCodes.includes(unit.paperCode));
    const benchmark = buildRealPaperBenchmark(filteredBenchmarkUnits);
    const resolvedTargetMarks = targetMode === "time"
      ? estimateMarksFromTimeMinutes(
          requestedTimeMinutes ?? estimatePaperTimeMinutes(subject.recommendedMinutesPerMark, targetMarks),
          benchmark.averageMinutesPerMark,
          subject.recommendedMinutesPerMark,
        )
      : targetMarks;
    const selection = selectQuestionUnits({
      units: allUnits,
      selectedLeafTopicIds,
      targetMarks: resolvedTargetMarks,
      paperCodes,
      maxQuestions,
      tolerance: 7,
    });

    if (selection.selectedUnits.length === 0) {
      return badRequest(`No ${subjectTier} source-page questions matched the selected papers and filters.`);
    }

    const pageAssetsBySource = await getQuestionPageAssetsBySourceRelativePaths(
      selection.selectedUnits.map((unit) => unit.sourceRelativePath),
    );

    const tierLabel = subjectTier[0].toUpperCase() + subjectTier.slice(1);
    const pdfBytes = await generateStrictSourcePaperPdf({
      title: `Edexcel Combined Science ${tierLabel} Custom Paper (${resolvedTargetMarks} marks target)`,
      selectedUnits: selection.selectedUnits,
      allUnits,
      pageAssetsBySource,
      coverPage: {
        boardLabel: subject.boardLabel,
        subjectLabel: subject.coverTitle,
        codeLabel: subject.codeLabel,
        totalMarks: selection.totalMarks,
        timeMinutes: targetMode === "time"
          ? (requestedTimeMinutes ?? estimatePaperTimeMinutes(subject.recommendedMinutesPerMark, selection.totalMarks))
          : estimatePaperTimeMinutes(benchmark.averageMinutesPerMark ?? subject.recommendedMinutesPerMark, selection.totalMarks),
        paperLabels: subject.paperOptions.filter((paper) => paperCodes.length === 0 || paperCodes.includes(paper.code)).map((paper) => paper.label),
        tierLabel,
      },
    });
    const timeMinutes = targetMode === "time"
      ? (requestedTimeMinutes ?? estimatePaperTimeMinutes(subject.recommendedMinutesPerMark, selection.totalMarks))
      : estimatePaperTimeMinutes(benchmark.averageMinutesPerMark ?? subject.recommendedMinutesPerMark, selection.totalMarks);

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="edexcel-combined-science-${subjectTier}-${resolvedTargetMarks}m.pdf"`,
        "X-Question-Count": String(selection.selectedUnits.length),
        "X-Total-Marks": String(selection.totalMarks),
        "X-Resolved-Target-Marks": String(resolvedTargetMarks),
        "X-Covered-Topics": String(selection.coveredLeafTopicIds.length),
        "X-Selected-Tier": subjectTier,
        "X-Time-Minutes": String(timeMinutes),
        "X-Target-Mode": targetMode,
      },
    });
  }

  if (subject.key === "aqa-business") {
    if (selectedTopicNodeIds.length === 0) {
      return badRequest("Select at least one Business topic.");
    }

    const questionBank = await getPaperMakerQuestionBankFromConvex(subject.boardCode, subject.subjectSlug);
    if (questionBank.length === 0) {
      return badRequest("No tagged AQA Business question bank is available in Convex.", 500);
    }

    const selectedLeafTopicIds = expandAqaBusinessTopicSelection(selectedTopicNodeIds);
    if (selectedLeafTopicIds.length === 0) {
      return badRequest("The selected Business topics do not map to any question-bank topics.");
    }

    const allUnits = groupQuestionPartsIntoUnits(questionBank);
    const filteredBenchmarkUnits = allUnits.filter((unit) => paperCodes.length === 0 || paperCodes.includes(unit.paperCode));
    const benchmark = buildRealPaperBenchmark(filteredBenchmarkUnits);
    const resolvedTargetMarks = targetMode === "time"
      ? estimateMarksFromTimeMinutes(
          requestedTimeMinutes ?? estimatePaperTimeMinutes(subject.recommendedMinutesPerMark, targetMarks),
          benchmark.averageMinutesPerMark,
          subject.recommendedMinutesPerMark,
        )
      : targetMarks;
    const selection = selectQuestionUnits({
      units: allUnits,
      selectedLeafTopicIds,
      targetMarks: resolvedTargetMarks,
      paperCodes,
      maxQuestions,
      tolerance: 7,
    });

    if (selection.selectedUnits.length === 0) {
      return badRequest("No source-page Business questions matched the selected topics and filters.");
    }

    const pageAssetsBySource = await getQuestionPageAssetsBySourceRelativePaths(
      selection.selectedUnits.map((unit) => unit.sourceRelativePath),
    );

    const pdfBytes = await generateStrictSourcePaperPdf({
      title: `AQA Business Custom Paper (${resolvedTargetMarks} marks target)`,
      selectedUnits: selection.selectedUnits,
      allUnits,
      pageAssetsBySource,
      coverPage: {
        boardLabel: subject.boardLabel,
        subjectLabel: subject.coverTitle,
        codeLabel: subject.codeLabel,
        totalMarks: selection.totalMarks,
        timeMinutes: targetMode === "time"
          ? (requestedTimeMinutes ?? estimatePaperTimeMinutes(subject.recommendedMinutesPerMark, selection.totalMarks))
          : estimatePaperTimeMinutes(benchmark.averageMinutesPerMark ?? subject.recommendedMinutesPerMark, selection.totalMarks),
        paperLabels: subject.paperOptions.filter((paper) => paperCodes.length === 0 || paperCodes.includes(paper.code)).map((paper) => paper.label),
      },
    });
    const timeMinutes = targetMode === "time"
      ? (requestedTimeMinutes ?? estimatePaperTimeMinutes(subject.recommendedMinutesPerMark, selection.totalMarks))
      : estimatePaperTimeMinutes(benchmark.averageMinutesPerMark ?? subject.recommendedMinutesPerMark, selection.totalMarks);

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="aqa-business-custom-paper-${resolvedTargetMarks}m.pdf"`,
        "X-Question-Count": String(selection.selectedUnits.length),
        "X-Total-Marks": String(selection.totalMarks),
        "X-Resolved-Target-Marks": String(resolvedTargetMarks),
        "X-Covered-Topics": String(selection.coveredLeafTopicIds.length),
        "X-Time-Minutes": String(timeMinutes),
        "X-Target-Mode": targetMode,
      },
    });
  }

  return badRequest(`Generation is not implemented for ${subject.label}.`, 501);
}
