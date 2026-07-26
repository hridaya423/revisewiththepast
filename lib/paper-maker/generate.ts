import { expandAqaBusinessTopicSelection } from "@/lib/paper-maker/aqa-business";
import { expandAqaEnglishLanguageTopicSelection } from "@/lib/paper-maker/aqa-english-language";
import { expandAqaEnglishLiteratureTopicSelection } from "@/lib/paper-maker/aqa-english-literature";
import {
  expandTopicSelection,
  selectQuestionUnits,
  sortQuestionUnitsForRendering,
  type QuestionMixProfile,
  type QuestionBankPart,
  type QuestionUnit,
} from "@/lib/paper-maker/aqa-geography";
import { buildRealPaperBenchmark, estimateMarksFromTimeMinutes } from "@/lib/paper-maker/benchmarks";
import {
  filterQuestionBankByTier,
  expandCombinedScienceTopicSelection,
  filterCombinedScienceQuestionBankByTier,
  type SubjectTierKey,
} from "@/lib/paper-maker/combined-science";
import { expandEdexcelBusinessTopicSelection } from "@/lib/paper-maker/edexcel-business";
import { expandEdexcelFrenchTopicSelection } from "@/lib/paper-maker/edexcel-french";
import { expandEdexcelMathematicsTopicSelection } from "@/lib/paper-maker/edexcel-mathematics";
import { expandEdexcelSeparateScienceTopicSelection } from "@/lib/paper-maker/edexcel-separate-science";
import { expandOcrComputerScienceTopicSelection } from "@/lib/paper-maker/ocr-computer-science";
import {
  getInsertPageAssetsBySourceRelativePaths,
  getPaperAssetsByBoardSubjectFromConvex,
  getPaperFiguresBySourceRelativePaths,
  getPaperMakerQuestionBankFromConvex,
  getPaperPageLayoutsBySourceRelativePaths,
  getQuestionPageAssetsBySourceRelativePaths,
} from "@/lib/paper-maker/convex";
import { filterUnitsByCopyrightPlaceholders, filterUnitsByDanglingContext, filterUnitsByFigureResolvability } from "@/lib/paper-maker/integrity";
import {
  getLocalFiguresBySource,
  getLocalPageLayoutsBySource,
  isLocalGeometryEnabled,
  overlayQuestionBankWithLocalGeometry,
} from "@/lib/paper-maker/local-geometry";
import { findOrphanStemFigures, type OrphanFigureIssue } from "@/lib/paper-maker/region-render";
import type { GeneratedCoverModel } from "@/lib/paper-maker/cover";
import { estimatePaperTimeMinutes, getCoverExamContext, getPaperMakerSubject, type PaperMakerSubjectDefinition, type PaperMakerSubjectKey } from "@/lib/paper-maker/subjects";
import { buildGeneratedCoverModel } from "@/lib/paper-maker/cover";
import { filterUnitsBySourcePdfRenderability, generateStrictSourcePaperPdf } from "@/lib/paper-maker/pdf";
import { groupQuestionUnitsForSubject } from "@/lib/paper-maker/units";

export class PaperGenerationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PaperGenerationError";
    this.status = status;
  }
}

export type GenerateCustomPaperInput = {
  subjectKey: string;
  subjectTier?: SubjectTierKey;
  selectedTopicNodeIds: string[];
  targetMarks: number;
  questionMix?: QuestionMixProfile;
  requestedTimeMinutes?: number;
  targetMode: "marks" | "time";
  paperCodes: string[];
  maxQuestions?: number;
  excludeSourceQuestionKeys: string[];
  remainingPaperCount: number;
  priorSelectedUnitMarks: number[];
  priorPaperCount: number;
  priorCoveredLeafTopicIds: string[];
  selectAllTopics?: boolean;
  seed?: number;
};

export type GenerateCustomPaperResult = {
  pdfBytes: Uint8Array;
  fileName: string;
  selection: ReturnType<typeof selectQuestionUnits>;
  allUnits: QuestionUnit[];
  resolvedTargetMarks: number;
  timeMinutes: number;
  targetMode: "marks" | "time";
  subject: PaperMakerSubjectDefinition;
  selectedTierHeader: SubjectTierKey | null;
  coverPage: GeneratedCoverModel;
  figureIntegrityIssues: OrphanFigureIssue[];
};

type TierConfig = {
  required: boolean;
  fixedTier?: SubjectTierKey;
  missingTierMessage?: string;
  filter: (bank: QuestionBankPart[], tier: SubjectTierKey) => QuestionBankPart[];
  noTierBankMessage: (tier: SubjectTierKey, subject: PaperMakerSubjectDefinition) => string;
  includeSelectedTierHeader: boolean;
  coverTierLabel: (tier: SubjectTierKey) => string;
};

type SubjectGenerationConfig = {
  tier?: TierConfig;
  expandTopics: (selectedNodeIds: string[], allUnits: QuestionUnit[], subject: PaperMakerSubjectDefinition) => string[];
  prefaceInserts?: (selectedUnits: QuestionUnit[]) => Promise<string[]>;
  messages: {
    selectTopics: string;
    noBank: string;
    noTopicsMapped: string;
    noSelection: (tier: SubjectTierKey | null) => string;
  };
  title: (resolvedTargetMarks: number, tierLabel: string | null) => string;
  fileName: (resolvedTargetMarks: number, tier: SubjectTierKey | null) => string;
};

const SUPPORT_DEPENDENCY_PATTERN = /\bfigure\b|\bstudy\b|\bmap\b|\bdiagram\b|\bgraph\b|\bphoto\b|\bresource\b|\bapparatus\b|\btable\b|\bchart\b|\bmodel\b|\bspectrum\b|\bresults\b/i;
const SUPPORT_LABEL_PATTERN = /\b(figure|resource|map|diagram|graph|photo|photograph|table|chart)\s*([a-z]|\d{1,3})\b/gi;

async function getInsertAssetUrls(
  boardCode: string,
  subjectSlug: string,
  units: QuestionUnit[],
  options?: { sectionCode?: string; requireSupportDependency?: boolean; allowWholeInsertFallback?: boolean },
) {
  const extractSupportLabels = (text: string) => {
    const labels = new Set<string>();
    const lowered = text.toLowerCase();
    let match = SUPPORT_LABEL_PATTERN.exec(lowered);
    while (match) {
      const kind = match[1] === "photograph" ? "photo" : match[1];
      labels.add(`${kind} ${match[2]}`);
      match = SUPPORT_LABEL_PATTERN.exec(lowered);
    }
    SUPPORT_LABEL_PATTERN.lastIndex = 0;
    return labels;
  };

  const assets = await getPaperAssetsByBoardSubjectFromConvex(boardCode, subjectSlug);
  const insertAssets = assets.filter((asset) => asset.kind === "insert");
  const insertAssetPaths = Array.from(new Set(insertAssets.map((asset) => asset.relativePath)));
  const splitInsertAssetsByPath = await getInsertPageAssetsBySourceRelativePaths(insertAssetPaths);
  const urls = new Set<string>();

  for (const unit of units) {
    if (options?.sectionCode && unit.sectionCode !== options.sectionCode) continue;
    if (options?.requireSupportDependency) {
      const searchable = unit.parts
        .map((part) => `${part.promptText ?? ""} ${part.contextText ?? ""}`.trim())
        .join(" ");
      if (!SUPPORT_DEPENDENCY_PATTERN.test(searchable)) continue;
    }
    const year = unit.year;
    const session = unit.session?.toLowerCase();
    if (!year || !session) continue;

    const match = insertAssets.find((asset) => (
      asset.paperCode === unit.paperCode
      && asset.year === year
      && asset.session.toLowerCase() === session
      && asset.cdnUrl
    ));

    const supportLabels = extractSupportLabels(
      unit.parts.map((part) => `${part.promptText ?? ""} ${part.contextText ?? ""}`.trim()).join(" "),
    );

    if (match?.relativePath) {
      const splitPages = splitInsertAssetsByPath.get(match.relativePath) ?? [];
      if (splitPages.length > 0) {
        if (supportLabels.size > 0) {
          for (const splitPage of splitPages) {
            if (/please turn the page over to see the sources/i.test(splitPage.ocrText ?? "")) continue;
            const pageLabels = new Set((splitPage.detectedSupportLabels ?? []).map((label) => label.toLowerCase()));
            if (Array.from(supportLabels).some((label) => pageLabels.has(label))) {
              urls.add(splitPage.cdnUrl);
            }
          }
          continue;
        }
      }
    }

    if (options?.allowWholeInsertFallback && supportLabels.size === 0 && match?.cdnUrl) {
      urls.add(match.cdnUrl);
    }
  }

  return Array.from(urls).sort((a, b) => a.localeCompare(b));
}

function capitalizeTier(tier: SubjectTierKey) {
  return tier[0].toUpperCase() + tier.slice(1);
}

function getFirstRenderedPage(unit: QuestionUnit) {
  return unit.pages.reduce((min, page) => Math.min(min, page.pageNumber), Number.POSITIVE_INFINITY);
}

function sortBusinessSelectedUnitsForRendering(units: QuestionUnit[]) {
  units.sort((left, right) => {
    if (left.sourceRelativePath !== right.sourceRelativePath) {
      return left.sourceRelativePath.localeCompare(right.sourceRelativePath, undefined, { numeric: true });
    }
    const leftPage = getFirstRenderedPage(left);
    const rightPage = getFirstRenderedPage(right);
    if (leftPage !== rightPage) return leftPage - rightPage;
    if ((left.sectionCode ?? "") !== (right.sectionCode ?? "")) {
      return (left.sectionCode ?? "").localeCompare(right.sectionCode ?? "");
    }
    return left.questionNumber.localeCompare(right.questionNumber, undefined, { numeric: true });
  });
}

const SUBJECT_GENERATION_CONFIGS: Partial<Record<PaperMakerSubjectKey, SubjectGenerationConfig>> = {
  "aqa-geography": {
    expandTopics: (ids) => expandTopicSelection(ids),
    prefaceInserts: (selectedUnits) => getInsertAssetUrls("aqa", "geography", selectedUnits, { requireSupportDependency: true }),
    messages: {
      selectTopics: "Select at least one topic.",
      noBank: "No tagged AQA Geography question bank is available in Convex.",
      noTopicsMapped: "The selected topics do not map to any question-bank topics.",
      noSelection: () => "No source-page questions matched the selected topics and filters.",
    },
    title: (marks) => `AQA Geography Custom Paper (${marks} marks target)`,
    fileName: (marks) => `aqa-geography-custom-paper-${marks}m.pdf`,
  },
  "edexcel-combined-science": {
    tier: {
      required: true,
      missingTierMessage: "Select Foundation or Higher for Combined Science.",
      filter: filterCombinedScienceQuestionBankByTier,
      noTierBankMessage: (tier) => `No tagged ${tier} Combined Science questions are available.`,
      includeSelectedTierHeader: true,
      coverTierLabel: capitalizeTier,
    },
    expandTopics: (ids, allUnits) => expandCombinedScienceTopicSelection(ids, allUnits),
    messages: {
      selectTopics: "Select at least one Combined Science topic.",
      noBank: "No tagged Edexcel Combined Science question bank is available in Convex.",
      noTopicsMapped: "The selected Combined Science topics do not map to any question-bank topics.",
      noSelection: (tier) => `No ${tier} source-page questions matched the selected papers and filters.`,
    },
    title: (marks, tierLabel) => `Edexcel Combined Science ${tierLabel} Custom Paper (${marks} marks target)`,
    fileName: (marks, tier) => `edexcel-combined-science-${tier}-${marks}m.pdf`,
  },
  "edexcel-biology": makeSeparateScienceConfig("biology"),
  "edexcel-chemistry": makeSeparateScienceConfig("chemistry"),
  "edexcel-physics": makeSeparateScienceConfig("physics"),
  "edexcel-french-reading": {
    tier: {
      required: true,
      missingTierMessage: "Select Foundation or Higher for French Reading.",
      filter: filterQuestionBankByTier,
      noTierBankMessage: (tier) => `No tagged ${tier} Edexcel French reading questions are available.`,
      includeSelectedTierHeader: true,
      coverTierLabel: capitalizeTier,
    },
    expandTopics: (ids) => expandEdexcelFrenchTopicSelection(ids),
    messages: {
      selectTopics: "Select at least one French topic.",
      noBank: "No tagged Edexcel French question bank is available in Convex.",
      noTopicsMapped: "The selected French topics do not map to any question-bank topics.",
      noSelection: (tier) => `No ${tier} source-page French reading questions matched the selected topics and filters.`,
    },
    title: (marks, tierLabel) => `Edexcel French Reading ${tierLabel} Custom Paper (${marks} marks target)`,
    fileName: (marks, tier) => `edexcel-french-reading-${tier}-${marks}m.pdf`,
  },
  "aqa-business": {
    expandTopics: (ids) => expandAqaBusinessTopicSelection(ids),
    messages: {
      selectTopics: "Select at least one Business topic.",
      noBank: "No tagged AQA Business question bank is available in Convex.",
      noTopicsMapped: "The selected Business topics do not map to any question-bank topics.",
      noSelection: () => "No source-page Business questions matched the selected topics and filters.",
    },
    title: (marks) => `AQA Business Custom Paper (${marks} marks target)`,
    fileName: (marks) => `aqa-business-custom-paper-${marks}m.pdf`,
  },
  "edexcel-business": {
    expandTopics: (ids) => expandEdexcelBusinessTopicSelection(ids),
    messages: {
      selectTopics: "Select at least one Business topic.",
      noBank: "No tagged Edexcel Business question bank is available in Convex.",
      noTopicsMapped: "The selected Business topics do not map to any question-bank topics.",
      noSelection: () => "No source-page Business questions matched the selected topics and filters.",
    },
    title: (marks) => `Edexcel Business Custom Paper (${marks} marks target)`,
    fileName: (marks) => `edexcel-business-custom-paper-${marks}m.pdf`,
  },
  "aqa-english-language": {
    expandTopics: (ids) => expandAqaEnglishLanguageTopicSelection(ids),
    prefaceInserts: (selectedUnits) => getInsertAssetUrls("aqa", "english-language", selectedUnits, { sectionCode: "A", allowWholeInsertFallback: true }),
    messages: {
      selectTopics: "Select at least one English Language topic.",
      noBank: "No tagged AQA English Language question bank is available in Convex.",
      noTopicsMapped: "The selected English Language topics do not map to any question-bank topics.",
      noSelection: () => "No source-page English Language questions matched the selected topics and filters.",
    },
    title: (marks) => `AQA English Language Custom Paper (${marks} marks target)`,
    fileName: (marks) => `aqa-english-language-custom-paper-${marks}m.pdf`,
  },
  "aqa-english-literature": {
    expandTopics: (ids) => expandAqaEnglishLiteratureTopicSelection(ids),
    messages: {
      selectTopics: "Select at least one English Literature topic.",
      noBank: "No tagged AQA English Literature question bank is available in Convex.",
      noTopicsMapped: "The selected English Literature topics do not map to any question-bank topics.",
      noSelection: () => "No source-page English Literature questions matched the selected topics and filters.",
    },
    title: (marks) => `AQA English Literature Custom Paper (${marks} marks target)`,
    fileName: (marks) => `aqa-english-literature-custom-paper-${marks}m.pdf`,
  },
  "edexcel-mathematics-higher": {
    tier: {
      required: false,
      fixedTier: "higher",
      filter: filterQuestionBankByTier,
      noTierBankMessage: () => "No tagged Higher Edexcel Maths questions are available.",
      includeSelectedTierHeader: false,
      coverTierLabel: capitalizeTier,
    },
    expandTopics: (ids) => expandEdexcelMathematicsTopicSelection(ids),
    messages: {
      selectTopics: "Select at least one Maths topic.",
      noBank: "No tagged Edexcel Maths question bank is available in Convex.",
      noTopicsMapped: "The selected Maths topics do not map to any question-bank topics.",
      noSelection: () => "No source-page Higher Maths questions matched the selected topics and filters.",
    },
    title: (marks) => `Edexcel Mathematics Higher Custom Paper (${marks} marks target)`,
    fileName: (marks) => `edexcel-mathematics-higher-custom-paper-${marks}m.pdf`,
  },
  "ocr-computer-science": {
    expandTopics: (ids) => expandOcrComputerScienceTopicSelection(ids),
    messages: {
      selectTopics: "Select at least one Computer Science topic.",
      noBank: "No tagged OCR Computer Science question bank is available in Convex.",
      noTopicsMapped: "The selected Computer Science topics do not map to any question-bank topics.",
      noSelection: () => "No source-page Computer Science questions matched the selected topics and filters.",
    },
    title: (marks) => `OCR Computer Science Custom Paper (${marks} marks target)`,
    fileName: (marks) => `ocr-computer-science-custom-paper-${marks}m.pdf`,
  },
};

function makeSeparateScienceConfig(subjectSlug: "biology" | "chemistry" | "physics"): SubjectGenerationConfig {
  const coverTitle = subjectSlug[0].toUpperCase() + subjectSlug.slice(1);
  return {
    tier: {
      required: true,
      missingTierMessage: `Select Foundation or Higher for ${coverTitle}.`,
      filter: filterQuestionBankByTier,
      noTierBankMessage: (tier) => `No tagged ${tier} Edexcel ${coverTitle} questions are available.`,
      includeSelectedTierHeader: true,
      coverTierLabel: capitalizeTier,
    },
    expandTopics: (ids) => expandEdexcelSeparateScienceTopicSelection(subjectSlug, ids),
    messages: {
      selectTopics: `Select at least one ${coverTitle} topic.`,
      noBank: `No tagged Edexcel ${coverTitle} question bank is available in Convex.`,
      noTopicsMapped: `The selected ${coverTitle} topics do not map to any question-bank topics.`,
      noSelection: (tier) => `No ${tier} source-page ${coverTitle} questions matched the selected papers and filters.`,
    },
    title: (marks, tierLabel) => `Edexcel ${coverTitle} ${tierLabel} Custom Paper (${marks} marks target)`,
    fileName: (marks, tier) => `edexcel-${subjectSlug}-${tier}-${marks}m.pdf`,
  };
}

export function createSeededRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function generateCustomPaper(input: GenerateCustomPaperInput): Promise<GenerateCustomPaperResult> {
  const subject = getPaperMakerSubject(input.subjectKey);
  if (!subject) {
    throw new PaperGenerationError("Unknown subject selection.");
  }
  if (!subject.generationEnabled) {
    throw new PaperGenerationError(`${subject.label} is not enabled for generation yet.`, 501);
  }

  const config = SUBJECT_GENERATION_CONFIGS[subject.key];
  if (!config) {
    throw new PaperGenerationError(`Generation is not implemented for ${subject.label}.`, 501);
  }

  const tier: SubjectTierKey | null = config.tier
    ? (config.tier.fixedTier ?? input.subjectTier ?? null)
    : null;
  if (config.tier?.required && !tier) {
    throw new PaperGenerationError(
      config.tier.missingTierMessage ?? `Select Foundation or Higher for ${subject.coverTitle}.`,
    );
  }

  if (!input.selectAllTopics && input.selectedTopicNodeIds.length === 0) {
    throw new PaperGenerationError(config.messages.selectTopics);
  }

  const questionBank = await getPaperMakerQuestionBankFromConvex(subject.boardCode, subject.subjectSlug);
  if (questionBank.length === 0) {
    throw new PaperGenerationError(config.messages.noBank, 500);
  }
  if (isLocalGeometryEnabled()) {
    overlayQuestionBankWithLocalGeometry(questionBank);
  }

  let effectiveBank = questionBank;
  if (config.tier && tier) {
    effectiveBank = config.tier.filter(questionBank, tier);
    if (effectiveBank.length === 0) {
      throw new PaperGenerationError(config.tier.noTierBankMessage(tier, subject), 500);
    }
  }

  let allUnits = groupQuestionUnitsForSubject(subject.key, effectiveBank);
  allUnits = filterUnitsByCopyrightPlaceholders(allUnits).kept;
  const selectedLeafTopicIds = input.selectAllTopics
    ? Array.from(new Set(allUnits.flatMap((unit) => unit.canonicalLeafs)))
    : config.expandTopics(input.selectedTopicNodeIds, allUnits, subject);
  if (selectedLeafTopicIds.length === 0) {
    throw new PaperGenerationError(config.messages.noTopicsMapped);
  }

  const filteredBenchmarkUnits = allUnits.filter((unit) => input.paperCodes.length === 0 || input.paperCodes.includes(unit.paperCode));
  const benchmark = buildRealPaperBenchmark(filteredBenchmarkUnits);
  const resolvedTargetMarks = input.targetMode === "time"
    ? estimateMarksFromTimeMinutes(
        input.requestedTimeMinutes ?? estimatePaperTimeMinutes(subject.recommendedMinutesPerMark, input.targetMarks),
        benchmark.averageMinutesPerMark,
        subject.recommendedMinutesPerMark,
      )
    : input.targetMarks;

  const regionMode = (process.env.PAPER_MAKER_REGION_MODE ?? "auto") !== "legacy" && subject.key !== "edexcel-combined-science";
  let figuresBySource: Awaited<ReturnType<typeof getPaperFiguresBySourceRelativePaths>> | undefined;
  let pageLayoutsBySource: Awaited<ReturnType<typeof getPaperPageLayoutsBySourceRelativePaths>> | undefined;
  let selectableUnits = allUnits;
  let pageAssetsBySource: Awaited<ReturnType<typeof getQuestionPageAssetsBySourceRelativePaths>> | undefined;
  if (regionMode) {
    const candidateSourcePaths = Array.from(new Set(allUnits.map((unit) => unit.sourceRelativePath)));
    [figuresBySource, pageLayoutsBySource] = isLocalGeometryEnabled()
      ? [getLocalFiguresBySource(candidateSourcePaths), getLocalPageLayoutsBySource(candidateSourcePaths)]
      : await Promise.all([
          getPaperFiguresBySourceRelativePaths(candidateSourcePaths),
          getPaperPageLayoutsBySourceRelativePaths(candidateSourcePaths),
        ]);
    const gate = filterUnitsByFigureResolvability(allUnits, {
      figuresBySource,
      pageLayoutsBySource,
      subjectUsesInserts: Boolean(config.prefaceInserts),
    });
    const contextGate = filterUnitsByDanglingContext(gate.kept, { pageLayoutsBySource });
    selectableUnits = contextGate.kept;
    const eligibleUnits = selectableUnits.filter((unit) => {
      if (input.paperCodes.length > 0 && !input.paperCodes.includes(unit.paperCode)) return false;
      if (input.excludeSourceQuestionKeys.includes(unit.sourceQuestionKey)) return false;
      return unit.canonicalLeafs.some((leafId) => selectedLeafTopicIds.includes(leafId));
    });
    const eligibleSourcePaths = Array.from(new Set(eligibleUnits.map((unit) => unit.sourceRelativePath)));
    pageAssetsBySource = await getQuestionPageAssetsBySourceRelativePaths(eligibleSourcePaths);
    const sourceGate = await filterUnitsBySourcePdfRenderability(eligibleUnits, {
      pageAssetsBySource,
      figuresBySource,
      pageLayoutsBySource,
      regionMode,
    });
    if (sourceGate.excluded.length > 0) {
      const renderableUnitKeys = new Set(sourceGate.kept.map((unit) => unit.unitKey));
      selectableUnits = selectableUnits.filter((unit) => !eligibleUnits.includes(unit) || renderableUnitKeys.has(unit.unitKey));
    }
  }

  const selection = selectQuestionUnits({
    units: selectableUnits,
    selectedLeafTopicIds,
    targetMarks: resolvedTargetMarks,
    questionMix: input.questionMix,
    paperCodes: input.paperCodes,
    maxQuestions: input.maxQuestions,
    tolerance: 7,
    excludedSourceQuestionKeys: input.excludeSourceQuestionKeys,
    remainingPaperCount: input.remainingPaperCount,
    priorSelectedUnitMarks: input.priorSelectedUnitMarks,
    priorPaperCount: input.priorPaperCount,
    priorCoveredLeafTopicIds: input.priorCoveredLeafTopicIds,
    rng: typeof input.seed === "number" ? createSeededRng(input.seed) : undefined,
  });

  if (selection.selectedUnits.length === 0) {
    throw new PaperGenerationError(config.messages.noSelection(tier));
  }

  if (subject.key === "aqa-business" || subject.key === "edexcel-business") sortBusinessSelectedUnitsForRendering(selection.selectedUnits);
  else sortQuestionUnitsForRendering(selection.selectedUnits);

  const selectedSourcePaths = selection.selectedUnits.map((unit) => unit.sourceRelativePath);
  pageAssetsBySource ??= await getQuestionPageAssetsBySourceRelativePaths(selectedSourcePaths);

  const figureIntegrityIssues: OrphanFigureIssue[] = [];
  if (figuresBySource && pageLayoutsBySource) {
    for (const unit of selection.selectedUnits) {
      const figures = figuresBySource.get(unit.sourceRelativePath) ?? [];
      if (figures.length === 0) continue;
      const layoutByPage = new Map(
        (pageLayoutsBySource.get(unit.sourceRelativePath) ?? []).map((layout) => [layout.pageNumber, layout]),
      );
      figureIntegrityIssues.push(...findOrphanStemFigures(unit, layoutByPage, figures));
    }
  }

  const coverTierLabel = config.tier && tier ? config.tier.coverTierLabel(tier) : null;
  const timeMinutes = input.targetMode === "time"
    ? (input.requestedTimeMinutes ?? estimatePaperTimeMinutes(subject.recommendedMinutesPerMark, selection.totalMarks))
    : estimatePaperTimeMinutes(benchmark.averageMinutesPerMark ?? subject.recommendedMinutesPerMark, selection.totalMarks);

  const selectedPapers = subject.paperOptions.filter((paper) => input.paperCodes.length === 0 || input.paperCodes.includes(paper.code));
  const examContext = getCoverExamContext(subject, selectedPapers);
  const coverPage = buildGeneratedCoverModel({
    subject,
    tierLabel: coverTierLabel,
    selectedUnits: selection.selectedUnits,
    selectedPapers,
    timeMinutes,
    examContext,
  });

  const pdfBytes = await generateStrictSourcePaperPdf({
    title: config.title(resolvedTargetMarks, coverTierLabel),
    selectedUnits: selection.selectedUnits,
    allUnits,
    pageAssetsBySource,
    figuresBySource,
    pageLayoutsBySource,
    regionMode,
    prefaceSourcePdfs: config.prefaceInserts ? await config.prefaceInserts(selection.selectedUnits) : undefined,
    coverPage,
  });

  return {
    pdfBytes,
    fileName: config.fileName(resolvedTargetMarks, tier),
    selection,
    allUnits,
    resolvedTargetMarks,
    timeMinutes,
    targetMode: input.targetMode,
    subject,
    selectedTierHeader: config.tier?.includeSelectedTierHeader && tier ? tier : null,
    coverPage,
    figureIntegrityIssues,
  };
}
