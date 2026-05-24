import { NextRequest } from "next/server";

import { expandAqaBusinessTopicSelection } from "@/lib/paper-maker/aqa-business";
import { expandAqaEnglishLanguageTopicSelection } from "@/lib/paper-maker/aqa-english-language";
import { expandAqaEnglishLiteratureTopicSelection } from "@/lib/paper-maker/aqa-english-literature";
import { expandTopicSelection, groupQuestionPartsIntoUnits, selectQuestionUnits } from "@/lib/paper-maker/aqa-geography";
import { buildRealPaperBenchmark, estimateMarksFromTimeMinutes } from "@/lib/paper-maker/benchmarks";
import {
  filterQuestionBankByTier,
  expandCombinedScienceTopicSelection,
  filterCombinedScienceQuestionBankByTier,
  type SubjectTierKey,
} from "@/lib/paper-maker/combined-science";
import { expandEdexcelBusinessTopicSelection } from "@/lib/paper-maker/edexcel-business";
import { expandEdexcelMathematicsTopicSelection } from "@/lib/paper-maker/edexcel-mathematics";
import { expandEdexcelSeparateScienceTopicSelection } from "@/lib/paper-maker/edexcel-separate-science";
import { expandOcrComputerScienceTopicSelection } from "@/lib/paper-maker/ocr-computer-science";
import { getAqaGeographyQuestionBankFromConvex, getPaperAssetsByBoardSubjectFromConvex, getPaperMakerQuestionBankFromConvex, getQuestionPageAssetsBySourceRelativePaths } from "@/lib/paper-maker/convex";
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
  excludeSourceQuestionKeys?: string[];
  remainingPaperCount?: number;
  priorSelectedUnitMarks?: number[];
  priorPaperCount?: number;
  priorCoveredLeafTopicIds?: string[];
};

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

async function getInsertAssetUrls(
  boardCode: string,
  subjectSlug: string,
  units: ReturnType<typeof groupQuestionPartsIntoUnits>,
  options?: { sectionCode?: string },
) {
  const assets = await getPaperAssetsByBoardSubjectFromConvex(boardCode, subjectSlug);
  const insertAssets = assets.filter((asset) => asset.kind === "insert");
  const urls = new Set<string>();

  for (const unit of units) {
    if (options?.sectionCode && unit.sectionCode !== options.sectionCode) continue;
    const year = unit.year;
    const session = unit.session?.toLowerCase();
    if (!year || !session) continue;

    const match = insertAssets.find((asset) => (
      asset.paperCode === unit.paperCode
      && asset.year === year
      && asset.session.toLowerCase() === session
      && asset.cdnUrl
    ));

    if (match?.cdnUrl) {
      urls.add(match.cdnUrl);
    }
  }

  return Array.from(urls).sort((a, b) => a.localeCompare(b));
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
  const excludeSourceQuestionKeys = Array.isArray(body.excludeSourceQuestionKeys)
    ? body.excludeSourceQuestionKeys.filter((value): value is string => typeof value === "string")
    : [];
  const priorSelectedUnitMarks = Array.isArray(body.priorSelectedUnitMarks)
    ? body.priorSelectedUnitMarks.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    : [];
  const priorPaperCount = typeof body.priorPaperCount === "number" && Number.isFinite(body.priorPaperCount)
    ? Math.max(0, Math.min(2, Math.round(body.priorPaperCount)))
    : 0;
  const priorCoveredLeafTopicIds = Array.isArray(body.priorCoveredLeafTopicIds)
    ? body.priorCoveredLeafTopicIds.filter((value): value is string => typeof value === "string")
    : [];
  const remainingPaperCount = typeof body.remainingPaperCount === "number" && Number.isFinite(body.remainingPaperCount)
    ? Math.max(1, Math.min(3, Math.round(body.remainingPaperCount)))
    : 1;

  const subject = getPaperMakerSubject(subjectKey);
  if (!subject) {
    return badRequest("Unknown subject selection.");
  }

  if (!subject.generationEnabled) {
    return badRequest(`${subject.label} is not enabled for generation yet.`, 501);
  }

  try {

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
      excludedSourceQuestionKeys: excludeSourceQuestionKeys,
      remainingPaperCount,
      priorSelectedUnitMarks,
      priorPaperCount,
      priorCoveredLeafTopicIds,
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
      prefaceSourcePdfs: await getInsertAssetUrls("aqa", "geography", selection.selectedUnits),
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
        "X-Covered-Leaf-Topic-Ids": encodeURIComponent(selection.coveredLeafTopicIds.join("\n")),
        "X-Time-Minutes": String(timeMinutes),
        "X-Target-Mode": targetMode,
        "X-Selected-Source-Question-Keys": encodeURIComponent(selection.selectedUnits.map((unit) => unit.sourceQuestionKey).join("\n")),
        "X-Selected-Unit-Marks": encodeURIComponent(selection.selectedUnits.map((unit) => String(unit.totalMarks)).join("\n")),
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
      excludedSourceQuestionKeys: excludeSourceQuestionKeys,
      remainingPaperCount,
      priorSelectedUnitMarks,
      priorPaperCount,
      priorCoveredLeafTopicIds,
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
        "X-Covered-Leaf-Topic-Ids": encodeURIComponent(selection.coveredLeafTopicIds.join("\n")),
        "X-Selected-Tier": subjectTier,
        "X-Time-Minutes": String(timeMinutes),
        "X-Target-Mode": targetMode,
        "X-Selected-Source-Question-Keys": encodeURIComponent(selection.selectedUnits.map((unit) => unit.sourceQuestionKey).join("\n")),
        "X-Selected-Unit-Marks": encodeURIComponent(selection.selectedUnits.map((unit) => String(unit.totalMarks)).join("\n")),
      },
    });
  }

  if (subject.key === "edexcel-biology" || subject.key === "edexcel-chemistry" || subject.key === "edexcel-physics") {
    if (!subjectTier) {
      return badRequest(`Select Foundation or Higher for ${subject.coverTitle}.`);
    }
    if (selectedTopicNodeIds.length === 0) {
      return badRequest(`Select at least one ${subject.coverTitle} topic.`);
    }

    const questionBank = await getPaperMakerQuestionBankFromConvex(subject.boardCode, subject.subjectSlug);
    if (questionBank.length === 0) {
      return badRequest(`No tagged Edexcel ${subject.coverTitle} question bank is available in Convex.`, 500);
    }

    const tierQuestionBank = filterQuestionBankByTier(questionBank, subjectTier);
    if (tierQuestionBank.length === 0) {
      return badRequest(`No tagged ${subjectTier} Edexcel ${subject.coverTitle} questions are available.`, 500);
    }

    const selectedLeafTopicIds = expandEdexcelSeparateScienceTopicSelection(subject.subjectSlug as "biology" | "chemistry" | "physics", selectedTopicNodeIds);
    if (selectedLeafTopicIds.length === 0) {
      return badRequest(`The selected ${subject.coverTitle} topics do not map to any question-bank topics.`);
    }

    const allUnits = groupQuestionPartsIntoUnits(tierQuestionBank);
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
      excludedSourceQuestionKeys: excludeSourceQuestionKeys,
      remainingPaperCount,
      priorSelectedUnitMarks,
      priorPaperCount,
      priorCoveredLeafTopicIds,
    });

    if (selection.selectedUnits.length === 0) {
      return badRequest(`No ${subjectTier} source-page ${subject.coverTitle} questions matched the selected papers and filters.`);
    }

    const pageAssetsBySource = await getQuestionPageAssetsBySourceRelativePaths(
      selection.selectedUnits.map((unit) => unit.sourceRelativePath),
    );

    const tierLabel = subjectTier[0].toUpperCase() + subjectTier.slice(1);
    const pdfBytes = await generateStrictSourcePaperPdf({
      title: `Edexcel ${subject.coverTitle} ${tierLabel} Custom Paper (${resolvedTargetMarks} marks target)`,
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
        "Content-Disposition": `attachment; filename="edexcel-${subject.subjectSlug}-${subjectTier}-${resolvedTargetMarks}m.pdf"`,
        "X-Question-Count": String(selection.selectedUnits.length),
        "X-Total-Marks": String(selection.totalMarks),
        "X-Resolved-Target-Marks": String(resolvedTargetMarks),
        "X-Covered-Topics": String(selection.coveredLeafTopicIds.length),
        "X-Covered-Leaf-Topic-Ids": encodeURIComponent(selection.coveredLeafTopicIds.join("\n")),
        "X-Selected-Tier": subjectTier,
        "X-Time-Minutes": String(timeMinutes),
        "X-Target-Mode": targetMode,
        "X-Selected-Source-Question-Keys": encodeURIComponent(selection.selectedUnits.map((unit) => unit.sourceQuestionKey).join("\n")),
        "X-Selected-Unit-Marks": encodeURIComponent(selection.selectedUnits.map((unit) => String(unit.totalMarks)).join("\n")),
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
      excludedSourceQuestionKeys: excludeSourceQuestionKeys,
      remainingPaperCount,
      priorSelectedUnitMarks,
      priorPaperCount,
      priorCoveredLeafTopicIds,
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
        "X-Covered-Leaf-Topic-Ids": encodeURIComponent(selection.coveredLeafTopicIds.join("\n")),
        "X-Time-Minutes": String(timeMinutes),
        "X-Target-Mode": targetMode,
        "X-Selected-Source-Question-Keys": encodeURIComponent(selection.selectedUnits.map((unit) => unit.sourceQuestionKey).join("\n")),
        "X-Selected-Unit-Marks": encodeURIComponent(selection.selectedUnits.map((unit) => String(unit.totalMarks)).join("\n")),
      },
    });
  }

  if (subject.key === "edexcel-business") {
    if (selectedTopicNodeIds.length === 0) {
      return badRequest("Select at least one Business topic.");
    }

    const questionBank = await getPaperMakerQuestionBankFromConvex(subject.boardCode, subject.subjectSlug);
    if (questionBank.length === 0) {
      return badRequest("No tagged Edexcel Business question bank is available in Convex.", 500);
    }

    const selectedLeafTopicIds = expandEdexcelBusinessTopicSelection(selectedTopicNodeIds);
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
      excludedSourceQuestionKeys: excludeSourceQuestionKeys,
      remainingPaperCount,
      priorSelectedUnitMarks,
      priorPaperCount,
      priorCoveredLeafTopicIds,
    });

    if (selection.selectedUnits.length === 0) {
      return badRequest("No source-page Business questions matched the selected topics and filters.");
    }

    const pageAssetsBySource = await getQuestionPageAssetsBySourceRelativePaths(
      selection.selectedUnits.map((unit) => unit.sourceRelativePath),
    );

    const pdfBytes = await generateStrictSourcePaperPdf({
      title: `Edexcel Business Custom Paper (${resolvedTargetMarks} marks target)`,
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
        "Content-Disposition": `attachment; filename="edexcel-business-custom-paper-${resolvedTargetMarks}m.pdf"`,
        "X-Question-Count": String(selection.selectedUnits.length),
        "X-Total-Marks": String(selection.totalMarks),
        "X-Resolved-Target-Marks": String(resolvedTargetMarks),
        "X-Covered-Topics": String(selection.coveredLeafTopicIds.length),
        "X-Covered-Leaf-Topic-Ids": encodeURIComponent(selection.coveredLeafTopicIds.join("\n")),
        "X-Time-Minutes": String(timeMinutes),
        "X-Target-Mode": targetMode,
        "X-Selected-Source-Question-Keys": encodeURIComponent(selection.selectedUnits.map((unit) => unit.sourceQuestionKey).join("\n")),
        "X-Selected-Unit-Marks": encodeURIComponent(selection.selectedUnits.map((unit) => String(unit.totalMarks)).join("\n")),
      },
    });
  }

  if (subject.key === "aqa-english-language") {
    if (selectedTopicNodeIds.length === 0) {
      return badRequest("Select at least one English Language topic.");
    }

    const questionBank = await getPaperMakerQuestionBankFromConvex(subject.boardCode, subject.subjectSlug);
    if (questionBank.length === 0) {
      return badRequest("No tagged AQA English Language question bank is available in Convex.", 500);
    }

    const selectedLeafTopicIds = expandAqaEnglishLanguageTopicSelection(selectedTopicNodeIds);
    if (selectedLeafTopicIds.length === 0) {
      return badRequest("The selected English Language topics do not map to any question-bank topics.");
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
      excludedSourceQuestionKeys: excludeSourceQuestionKeys,
      remainingPaperCount,
      priorSelectedUnitMarks,
      priorPaperCount,
      priorCoveredLeafTopicIds,
    });

    if (selection.selectedUnits.length === 0) {
      return badRequest("No source-page English Language questions matched the selected topics and filters.");
    }

    const pageAssetsBySource = await getQuestionPageAssetsBySourceRelativePaths(
      selection.selectedUnits.map((unit) => unit.sourceRelativePath),
    );

    const pdfBytes = await generateStrictSourcePaperPdf({
      title: `AQA English Language Custom Paper (${resolvedTargetMarks} marks target)`,
      selectedUnits: selection.selectedUnits,
      allUnits,
      pageAssetsBySource,
        prefaceSourcePdfs: await getInsertAssetUrls("aqa", "english-language", selection.selectedUnits, { sectionCode: "A" }),
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
        "Content-Disposition": `attachment; filename="aqa-english-language-custom-paper-${resolvedTargetMarks}m.pdf"`,
        "X-Question-Count": String(selection.selectedUnits.length),
        "X-Total-Marks": String(selection.totalMarks),
        "X-Resolved-Target-Marks": String(resolvedTargetMarks),
        "X-Covered-Topics": String(selection.coveredLeafTopicIds.length),
        "X-Covered-Leaf-Topic-Ids": encodeURIComponent(selection.coveredLeafTopicIds.join("\n")),
        "X-Time-Minutes": String(timeMinutes),
        "X-Target-Mode": targetMode,
        "X-Selected-Source-Question-Keys": encodeURIComponent(selection.selectedUnits.map((unit) => unit.sourceQuestionKey).join("\n")),
        "X-Selected-Unit-Marks": encodeURIComponent(selection.selectedUnits.map((unit) => String(unit.totalMarks)).join("\n")),
      },
    });
  }

  if (subject.key === "aqa-english-literature") {
    if (selectedTopicNodeIds.length === 0) {
      return badRequest("Select at least one English Literature topic.");
    }

    const questionBank = await getPaperMakerQuestionBankFromConvex(subject.boardCode, subject.subjectSlug);
    if (questionBank.length === 0) {
      return badRequest("No tagged AQA English Literature question bank is available in Convex.", 500);
    }

    const selectedLeafTopicIds = expandAqaEnglishLiteratureTopicSelection(selectedTopicNodeIds);
    if (selectedLeafTopicIds.length === 0) {
      return badRequest("The selected English Literature topics do not map to any question-bank topics.");
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
      excludedSourceQuestionKeys: excludeSourceQuestionKeys,
      remainingPaperCount,
      priorSelectedUnitMarks,
      priorPaperCount,
      priorCoveredLeafTopicIds,
    });

    if (selection.selectedUnits.length === 0) {
      return badRequest("No source-page English Literature questions matched the selected topics and filters.");
    }

    const pageAssetsBySource = await getQuestionPageAssetsBySourceRelativePaths(
      selection.selectedUnits.map((unit) => unit.sourceRelativePath),
    );

    const pdfBytes = await generateStrictSourcePaperPdf({
      title: `AQA English Literature Custom Paper (${resolvedTargetMarks} marks target)`,
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
        "Content-Disposition": `attachment; filename="aqa-english-literature-custom-paper-${resolvedTargetMarks}m.pdf"`,
        "X-Question-Count": String(selection.selectedUnits.length),
        "X-Total-Marks": String(selection.totalMarks),
        "X-Resolved-Target-Marks": String(resolvedTargetMarks),
        "X-Covered-Topics": String(selection.coveredLeafTopicIds.length),
        "X-Covered-Leaf-Topic-Ids": encodeURIComponent(selection.coveredLeafTopicIds.join("\n")),
        "X-Time-Minutes": String(timeMinutes),
        "X-Target-Mode": targetMode,
        "X-Selected-Source-Question-Keys": encodeURIComponent(selection.selectedUnits.map((unit) => unit.sourceQuestionKey).join("\n")),
        "X-Selected-Unit-Marks": encodeURIComponent(selection.selectedUnits.map((unit) => String(unit.totalMarks)).join("\n")),
      },
    });
  }

  if (subject.key === "edexcel-mathematics-higher") {
    if (selectedTopicNodeIds.length === 0) {
      return badRequest("Select at least one Maths topic.");
    }

    const questionBank = await getPaperMakerQuestionBankFromConvex(subject.boardCode, subject.subjectSlug);
    if (questionBank.length === 0) {
      return badRequest("No tagged Edexcel Maths question bank is available in Convex.", 500);
    }

    const higherQuestionBank = filterQuestionBankByTier(questionBank, "higher");
    if (higherQuestionBank.length === 0) {
      return badRequest("No tagged Higher Edexcel Maths questions are available.", 500);
    }

    const selectedLeafTopicIds = expandEdexcelMathematicsTopicSelection(selectedTopicNodeIds);
    if (selectedLeafTopicIds.length === 0) {
      return badRequest("The selected Maths topics do not map to any question-bank topics.");
    }

    const allUnits = groupQuestionPartsIntoUnits(higherQuestionBank);
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
      excludedSourceQuestionKeys: excludeSourceQuestionKeys,
      remainingPaperCount,
      priorSelectedUnitMarks,
      priorPaperCount,
      priorCoveredLeafTopicIds,
    });

    if (selection.selectedUnits.length === 0) {
      return badRequest("No source-page Higher Maths questions matched the selected topics and filters.");
    }

    const pageAssetsBySource = await getQuestionPageAssetsBySourceRelativePaths(
      selection.selectedUnits.map((unit) => unit.sourceRelativePath),
    );

    const pdfBytes = await generateStrictSourcePaperPdf({
      title: `Edexcel Mathematics Higher Custom Paper (${resolvedTargetMarks} marks target)`,
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
        tierLabel: "Higher",
      },
    });
    const timeMinutes = targetMode === "time"
      ? (requestedTimeMinutes ?? estimatePaperTimeMinutes(subject.recommendedMinutesPerMark, selection.totalMarks))
      : estimatePaperTimeMinutes(benchmark.averageMinutesPerMark ?? subject.recommendedMinutesPerMark, selection.totalMarks);

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="edexcel-mathematics-higher-custom-paper-${resolvedTargetMarks}m.pdf"`,
        "X-Question-Count": String(selection.selectedUnits.length),
        "X-Total-Marks": String(selection.totalMarks),
        "X-Resolved-Target-Marks": String(resolvedTargetMarks),
        "X-Covered-Topics": String(selection.coveredLeafTopicIds.length),
        "X-Covered-Leaf-Topic-Ids": encodeURIComponent(selection.coveredLeafTopicIds.join("\n")),
        "X-Time-Minutes": String(timeMinutes),
        "X-Target-Mode": targetMode,
        "X-Selected-Source-Question-Keys": encodeURIComponent(selection.selectedUnits.map((unit) => unit.sourceQuestionKey).join("\n")),
        "X-Selected-Unit-Marks": encodeURIComponent(selection.selectedUnits.map((unit) => String(unit.totalMarks)).join("\n")),
      },
    });
  }

  if (subject.key === "ocr-computer-science") {
    if (selectedTopicNodeIds.length === 0) {
      return badRequest("Select at least one Computer Science topic.");
    }

    const questionBank = await getPaperMakerQuestionBankFromConvex(subject.boardCode, subject.subjectSlug);
    if (questionBank.length === 0) {
      return badRequest("No tagged OCR Computer Science question bank is available in Convex.", 500);
    }

    const selectedLeafTopicIds = expandOcrComputerScienceTopicSelection(selectedTopicNodeIds);
    if (selectedLeafTopicIds.length === 0) {
      return badRequest("The selected Computer Science topics do not map to any question-bank topics.");
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
      excludedSourceQuestionKeys: excludeSourceQuestionKeys,
      remainingPaperCount,
      priorSelectedUnitMarks,
      priorPaperCount,
      priorCoveredLeafTopicIds,
    });

    if (selection.selectedUnits.length === 0) {
      return badRequest("No source-page Computer Science questions matched the selected topics and filters.");
    }

    const pageAssetsBySource = await getQuestionPageAssetsBySourceRelativePaths(
      selection.selectedUnits.map((unit) => unit.sourceRelativePath),
    );

    const pdfBytes = await generateStrictSourcePaperPdf({
      title: `OCR Computer Science Custom Paper (${resolvedTargetMarks} marks target)`,
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
        "Content-Disposition": `attachment; filename="ocr-computer-science-custom-paper-${resolvedTargetMarks}m.pdf"`,
        "X-Question-Count": String(selection.selectedUnits.length),
        "X-Total-Marks": String(selection.totalMarks),
        "X-Resolved-Target-Marks": String(resolvedTargetMarks),
        "X-Covered-Topics": String(selection.coveredLeafTopicIds.length),
        "X-Covered-Leaf-Topic-Ids": encodeURIComponent(selection.coveredLeafTopicIds.join("\n")),
        "X-Time-Minutes": String(timeMinutes),
        "X-Target-Mode": targetMode,
        "X-Selected-Source-Question-Keys": encodeURIComponent(selection.selectedUnits.map((unit) => unit.sourceQuestionKey).join("\n")),
        "X-Selected-Unit-Marks": encodeURIComponent(selection.selectedUnits.map((unit) => String(unit.totalMarks)).join("\n")),
      },
    });
  }

    return badRequest(`Generation is not implemented for ${subject.label}.`, 501);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Paper generation failed", {
      subjectKey,
      subjectTier,
      targetMode,
      targetMarks,
      requestedTimeMinutes,
      paperCodes,
      selectedTopicNodeIdsCount: selectedTopicNodeIds.length,
      remainingPaperCount,
      priorPaperCount,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return new Response(`Failed to generate paper: ${message}`, { status: 500 });
  }
}
