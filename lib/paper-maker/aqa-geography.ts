export type BoundingBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type RegionSpan = {
  pageNumber: number;
  yTop: number;
  yBottom: number;
};

export type QuestionBankPart = {
  partKey: string;
  unitKey: string;
  taggedPaperId: string;
  sourceRelativePath: string;
  questionPaperCdnUrl: string | null;
  questionPaperFileName: string | null;
  pageAssetCdnUrls: Array<{ pageNumber: number; cdnUrl: string | null }>;
  boardCode: string;
  subjectSlug: string;
  paperCode: string;
  year: number | null;
  session: string | null;
  questionId: string;
  questionNumber: string;
  questionPartNumber: string | null;
  sectionCode: string | null;
  sectionName: string | null;
  marks: number | null;
  canonicalLeaf: string;
  promptText: string;
  contextText: string | null;
  pageNumber: number;
  pageNumbers: number[];
  bbox: BoundingBox | null;
  regionSpans?: RegionSpan[] | null;
  stemSpans?: RegionSpan[] | null;
  referencedFigures?: string[];
  regionVersion?: string;
  sourceMode: string;
  assetIds: string[];
  questionType?: string | null;
  isChoiceQuestion?: boolean;
  choiceGroupId?: string | null;
  choiceGroupType?: string | null;
  choiceSiblingQuestionIds?: string[];
};

export type SourcePageAsset = {
  sourceRelativePath: string;
  pageNumber: number;
  cdnUrl: string;
  fileName: string;
  relativePath: string;
};

export type TopicTreeNode = {
  id: string;
  label: string;
  leafTopicIds: string[];
  children?: TopicTreeNode[];
};

export type TopicTreeNodeWithCounts = Omit<TopicTreeNode, "children"> & {
  questionUnitCount: number;
  children?: TopicTreeNodeWithCounts[];
};

export type QuestionUnitPage = {
  pageNumber: number;
  parts: QuestionBankPart[];
  bboxUnion: BoundingBox | null;
};

export type QuestionUnit = {
  unitKey: string;
  groupUnitKey: string;
  sourceQuestionKey: string;
  sourceRelativePath: string;
  questionPaperCdnUrl: string | null;
  questionPaperFileName: string | null;
  boardCode: string;
  subjectSlug: string;
  paperCode: string;
  year: number | null;
  session: string | null;
  questionNumber: string;
  sectionCode: string | null;
  sectionName: string | null;
  totalMarks: number;
  canonicalLeafs: string[];
  parts: QuestionBankPart[];
  pages: QuestionUnitPage[];
};

type SelectQuestionUnitsInput = {
  units: QuestionUnit[];
  selectedLeafTopicIds: string[];
  targetMarks: number;
  paperCodes?: string[];
  maxQuestions?: number;
  tolerance?: number;
  excludedSourceQuestionKeys?: string[];
  remainingPaperCount?: number;
  priorSelectedUnitMarks?: number[];
  priorPaperCount?: number;
  priorCoveredLeafTopicIds?: string[];
  rng?: () => number;
};

type MutableTopicNode = Omit<TopicTreeNode, "leafTopicIds"> & { leafTopicIds?: string[] };

function defineNode(node: MutableTopicNode): TopicTreeNode {
  if (node.children && node.children.length > 0) {
    const children = node.children.map(defineNode);
    return {
      id: node.id,
      label: node.label,
      children,
      leafTopicIds: Array.from(new Set(children.flatMap((child) => child.leafTopicIds))),
    };
  }

  return {
    id: node.id,
    label: node.label,
    leafTopicIds: node.leafTopicIds ?? [],
  };
}

export const AQA_GEOGRAPHY_TOPIC_TREE: TopicTreeNode[] = [
  defineNode({
    id: "natural-hazards-group",
    label: "The Challenge of Natural Hazards",
    children: [
      { id: "natural-hazards", label: "Natural Hazards", leafTopicIds: ["natural-hazards.overview"] },
      {
        id: "tectonic-hazards",
        label: "Tectonic Hazards",
        leafTopicIds: ["tectonic-hazards.plate-margins", "tectonic-hazards.effects-responses", "tectonic-hazards.management"],
      },
      {
        id: "weather-hazards",
        label: "Weather Hazards",
        leafTopicIds: ["weather-hazards.global-circulation", "weather-hazards.tropical-storms", "weather-hazards.uk-extreme-weather"],
      },
      {
        id: "climate-change",
        label: "Climate Change",
        leafTopicIds: ["climate-change.evidence-causes", "climate-change.effects-management"],
      },
    ],
  }),
  defineNode({
    id: "living-world-group",
    label: "The Living World",
    children: [
      { id: "ecosystems", label: "Ecosystems", leafTopicIds: ["living-world.ecosystems"] },
      {
        id: "tropical-rainforests",
        label: "Tropical Rainforests",
        leafTopicIds: ["living-world.tropical-rainforests.characteristics", "living-world.tropical-rainforests.deforestation"],
      },
      {
        id: "hot-deserts",
        label: "Hot Deserts",
        leafTopicIds: ["living-world.hot-deserts.characteristics", "living-world.hot-deserts.development-desertification"],
      },
      {
        id: "cold-environments",
        label: "Cold Environments",
        leafTopicIds: ["living-world.cold-environments.characteristics", "living-world.cold-environments.development-conservation"],
      },
    ],
  }),
  defineNode({
    id: "physical-landscapes-group",
    label: "Physical Landscapes in the UK",
    children: [
      {
        id: "coastal-landscapes",
        label: "Coastal Landscapes in the UK",
        leafTopicIds: ["coasts.processes", "coasts.management"],
      },
      {
        id: "river-landscapes",
        label: "River Landscapes in the UK",
        leafTopicIds: ["rivers.profiles-and-processes", "rivers.flood-risk-management"],
      },
      {
        id: "glacial-landscapes",
        label: "Glacial Landscapes in the UK",
        leafTopicIds: ["glacial-landscapes.processes-and-landforms", "glacial-landscapes.management"],
      },
    ],
  }),
  defineNode({
    id: "urban-issues-group",
    label: "Urban Issues & Challenges",
    children: [
      { id: "global-urbanisation", label: "Global Urbanisation", leafTopicIds: ["urban-issues.global-urbanisation"] },
      { id: "lic-nee-city", label: "LIC/NEE City", leafTopicIds: ["urban-issues.lic-nee-city"] },
      { id: "uk-city", label: "UK City", leafTopicIds: ["urban-issues.uk-city"] },
      { id: "urban-strategies", label: "Urban Strategies", leafTopicIds: ["urban-issues.strategies"] },
    ],
  }),
  defineNode({
    id: "changing-economic-world-group",
    label: "The Changing Economic World",
    children: [
      { id: "development-gap", label: "Development Gap", leafTopicIds: ["changing-economic-world.development-gap"] },
      { id: "reducing-gap", label: "Reducing the Development Gap", leafTopicIds: ["changing-economic-world.reducing-gap"] },
      { id: "nee-case-study", label: "LIC/NEE Case Study", leafTopicIds: ["changing-economic-world.nee-case-study"] },
      { id: "uk-economy", label: "UK Economy", leafTopicIds: ["changing-economic-world.uk-economy"] },
    ],
  }),
  defineNode({
    id: "resource-management-group",
    label: "The Challenge of Resource Management",
    children: [
      { id: "resource-overview", label: "Resource Management Overview", leafTopicIds: ["resource-management.overview"] },
      { id: "resource-food", label: "Food", leafTopicIds: ["resource-management.food"] },
      { id: "resource-water", label: "Water", leafTopicIds: ["resource-management.water"] },
      { id: "resource-energy", label: "Energy", leafTopicIds: ["resource-management.energy"] },
    ],
  }),
  defineNode({
    id: "issue-evaluation-group",
    label: "Issues Evaluation",
    children: [
      { id: "issue-evaluation-physical", label: "Physical Context", leafTopicIds: ["applications.issue-evaluation.physical"] },
      { id: "issue-evaluation-human", label: "Human Context", leafTopicIds: ["applications.issue-evaluation.human"] },
      { id: "issue-evaluation-synoptic", label: "Synoptic Links", leafTopicIds: ["applications.issue-evaluation.synoptic"] },
    ],
  }),
  defineNode({
    id: "fieldwork-group",
    label: "Fieldwork",
    children: [
      { id: "fieldwork-design", label: "Question Design", leafTopicIds: ["applications.fieldwork-question-design"] },
      { id: "fieldwork-collection", label: "Data Collection", leafTopicIds: ["applications.fieldwork-data-collection"] },
      { id: "fieldwork-presentation", label: "Data Presentation", leafTopicIds: ["applications.fieldwork-presentation"] },
      { id: "fieldwork-analysis", label: "Analysis", leafTopicIds: ["applications.fieldwork-analysis"] },
      { id: "fieldwork-evaluation", label: "Evaluation", leafTopicIds: ["applications.fieldwork-evaluation"] },
    ],
  }),
];

function unionBoundingBoxes(boxes: BoundingBox[]) {
  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
  };
}

function parseDeclaredQuestionNumber(questionNumber: string) {
  const parsed = Number.parseInt(questionNumber, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractPromptQuestionNumber(promptText: string) {
  const match = promptText.match(/\b0?\s*([0-9]{1,2})\s*\.\s*([0-9][0-9\s]*)\b/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasQuestionNumberMismatch(part: QuestionBankPart) {
  const declared = parseDeclaredQuestionNumber(part.questionNumber);
  if (declared === null) return false;
  const promptDerived = extractPromptQuestionNumber(part.promptText);
  if (promptDerived === null) return false;
  return declared !== promptDerived;
}

function buildTopicIndex(nodes: TopicTreeNode[], map = new Map<string, TopicTreeNode>()) {
  for (const node of nodes) {
    map.set(node.id, node);
    if (node.children) buildTopicIndex(node.children, map);
  }
  return map;
}

function getMarkCategory(totalMarks: number) {
  if (totalMarks <= 2) return "low" as const;
  if (totalMarks <= 5) return "medium" as const;
  return "high" as const;
}

function buildStableSourceQuestionKey(part: QuestionBankPart) {
  return [
    part.boardCode,
    part.subjectSlug,
    part.paperCode,
    part.year ?? "-",
    part.session ?? "-",
    part.sectionCode ?? "-",
    `q${part.questionNumber}`,
  ].join("::");
}

function isLikelyBrokenMathematicsUnit(unit: QuestionUnit) {
  if (unit.subjectSlug !== "mathematics") return false;
  if (unit.parts.length > 1) return false;
  const part = unit.parts[0];
  if (!part?.questionPartNumber) return false;
  if (unit.totalMarks > 12) return true;
  return unit.totalMarks > 6 && part.promptText.trim().length < 80;
}

const TOPIC_INDEX = buildTopicIndex(AQA_GEOGRAPHY_TOPIC_TREE);

export function expandTopicSelection(selectedNodeIds: string[]) {
  return Array.from(new Set(selectedNodeIds.flatMap((nodeId) => TOPIC_INDEX.get(nodeId)?.leafTopicIds ?? [])));
}

export function groupQuestionPartsIntoUnits(questionParts: QuestionBankPart[]): QuestionUnit[] {
  const units = new Map<string, QuestionUnit>();
  const relatedPartsByGroupUnitKey = new Map<string, QuestionBankPart[]>();

  for (const part of questionParts) {
    if ((part.marks ?? 0) <= 0) continue;
    if (hasQuestionNumberMismatch(part)) continue;

    const relatedParts = relatedPartsByGroupUnitKey.get(part.unitKey) ?? [];
    relatedParts.push(part);
    relatedPartsByGroupUnitKey.set(part.unitKey, relatedParts);

    const existing = units.get(part.partKey) ?? {
      unitKey: part.partKey,
      groupUnitKey: part.unitKey,
      sourceQuestionKey: buildStableSourceQuestionKey(part),
      sourceRelativePath: part.sourceRelativePath,
      questionPaperCdnUrl: part.questionPaperCdnUrl,
      questionPaperFileName: part.questionPaperFileName,
      boardCode: part.boardCode,
      subjectSlug: part.subjectSlug,
      paperCode: part.paperCode,
      year: part.year,
      session: part.session,
      questionNumber: part.questionNumber,
      sectionCode: part.sectionCode,
      sectionName: part.sectionName,
      totalMarks: 0,
      canonicalLeafs: [],
      parts: [],
      pages: [],
    };

    existing.parts.push(part);
    existing.totalMarks += part.marks ?? 0;
    existing.canonicalLeafs = Array.from(new Set([...existing.canonicalLeafs, part.canonicalLeaf]));
    units.set(part.partKey, existing);
  }

  const comparePartOrder = (left: QuestionBankPart, right: QuestionBankPart) => {
    if (left.pageNumber !== right.pageNumber) return left.pageNumber - right.pageNumber;
    if ((left.questionPartNumber ?? "") !== (right.questionPartNumber ?? "")) {
      return (left.questionPartNumber ?? "").localeCompare(right.questionPartNumber ?? "", undefined, { numeric: true });
    }
    return left.questionId.localeCompare(right.questionId, undefined, { numeric: true });
  };

  const getMathematicsRelevantParts = (unit: QuestionUnit) => {
    if (unit.subjectSlug !== "mathematics") return unit.parts;

    const currentPart = unit.parts[0];
    if (!currentPart?.questionPartNumber) return unit.parts;
    if (!/part\s*\([a-z]\)|your answer to part|this graph|this equation|this table|this shape|the graph|the equation/i.test(currentPart.promptText)) {
      return unit.parts;
    }

    const relatedParts = [...(relatedPartsByGroupUnitKey.get(unit.groupUnitKey) ?? unit.parts)].sort(comparePartOrder);
    const currentIndex = relatedParts.findIndex((part) => part.partKey === currentPart.partKey);
    if (currentIndex <= 0) return unit.parts;

    const previousPart = relatedParts[currentIndex - 1];
    return previousPart ? [previousPart, currentPart] : unit.parts;
  };

  for (const unit of units.values()) {
    const pageMap = new Map<number, QuestionBankPart[]>();
    for (const part of getMathematicsRelevantParts(unit)) {
      for (const pageNumber of part.pageNumbers) {
        const parts = pageMap.get(pageNumber) ?? [];
        parts.push(part);
        pageMap.set(pageNumber, parts);
      }
    }

    unit.pages = Array.from(pageMap.entries())
      .map(([pageNumber, parts]) => {
        const boxes = parts.map((part) => part.bbox).filter((bbox): bbox is BoundingBox => bbox !== null);
        return {
          pageNumber,
          parts,
          bboxUnion: boxes.length > 0 ? unionBoundingBoxes(boxes) : null,
        };
      })
      .sort((a, b) => a.pageNumber - b.pageNumber);
  }

  return Array.from(units.values()).sort((a, b) => {
    if ((a.totalMarks ?? 0) !== (b.totalMarks ?? 0)) return (a.totalMarks ?? 0) - (b.totalMarks ?? 0);
    if (a.paperCode !== b.paperCode) return a.paperCode.localeCompare(b.paperCode, undefined, { numeric: true });
    if ((a.sectionCode ?? "") !== (b.sectionCode ?? "")) return (a.sectionCode ?? "").localeCompare(b.sectionCode ?? "");
    if (a.questionNumber !== b.questionNumber) return a.questionNumber.localeCompare(b.questionNumber, undefined, { numeric: true });
    return (b.year ?? 0) - (a.year ?? 0);
  });
}

export function buildTopicTreeWithCounts(units: QuestionUnit[]): TopicTreeNodeWithCounts[] {
  const countByLeaf = new Map<string, number>();
  for (const unit of units) {
    for (const leaf of unit.canonicalLeafs) {
      countByLeaf.set(leaf, (countByLeaf.get(leaf) ?? 0) + 1);
    }
  }

  const attachCounts = (node: TopicTreeNode): TopicTreeNodeWithCounts => ({
    ...node,
    questionUnitCount: node.leafTopicIds.reduce((sum, leafId) => sum + (countByLeaf.get(leafId) ?? 0), 0),
    children: node.children?.map(attachCounts),
  });

  return AQA_GEOGRAPHY_TOPIC_TREE.map(attachCounts);
}

export function groupQuestionUnitsBySourceQuestion(units: QuestionUnit[]): QuestionUnit[] {
  const groupedParts = new Map<string, QuestionBankPart[]>();

  for (const unit of units) {
    const parts = groupedParts.get(unit.sourceQuestionKey) ?? [];
    parts.push(...unit.parts);
    groupedParts.set(unit.sourceQuestionKey, parts);
  }

  const grouped: QuestionUnit[] = [];
  for (const [sourceQuestionKey, rawParts] of groupedParts.entries()) {
    const parts = [...rawParts].sort((left, right) => {
      if (left.pageNumber !== right.pageNumber) return left.pageNumber - right.pageNumber;
      if ((left.questionPartNumber ?? "") !== (right.questionPartNumber ?? "")) {
        return (left.questionPartNumber ?? "").localeCompare(right.questionPartNumber ?? "", undefined, { numeric: true });
      }
      return left.questionId.localeCompare(right.questionId, undefined, { numeric: true });
    });
    const first = parts[0];
    if (!first) continue;

    const pageMap = new Map<number, QuestionBankPart[]>();
    for (const part of parts) {
      for (const pageNumber of part.pageNumbers) {
        const pageParts = pageMap.get(pageNumber) ?? [];
        pageParts.push(part);
        pageMap.set(pageNumber, pageParts);
      }
    }

    grouped.push({
      unitKey: first.unitKey,
      groupUnitKey: first.unitKey,
      sourceQuestionKey,
      sourceRelativePath: first.sourceRelativePath,
      questionPaperCdnUrl: first.questionPaperCdnUrl,
      questionPaperFileName: first.questionPaperFileName,
      boardCode: first.boardCode,
      subjectSlug: first.subjectSlug,
      paperCode: first.paperCode,
      year: first.year,
      session: first.session,
      questionNumber: first.questionNumber,
      sectionCode: first.sectionCode,
      sectionName: first.sectionName,
      totalMarks: parts.reduce((sum, part) => sum + (part.marks ?? 0), 0),
      canonicalLeafs: Array.from(new Set(parts.map((part) => part.canonicalLeaf))),
      parts,
      pages: Array.from(pageMap.entries())
        .map(([pageNumber, pageParts]) => {
          const boxes = pageParts.map((part) => part.bbox).filter((bbox): bbox is BoundingBox => bbox !== null);
          return {
            pageNumber,
            parts: pageParts,
            bboxUnion: boxes.length > 0 ? unionBoundingBoxes(boxes) : null,
          };
        })
        .sort((left, right) => left.pageNumber - right.pageNumber),
    });
  }

  return grouped.sort((a, b) => {
    if (a.totalMarks !== b.totalMarks) return a.totalMarks - b.totalMarks;
    if (a.paperCode !== b.paperCode) return a.paperCode.localeCompare(b.paperCode, undefined, { numeric: true });
    if ((a.sectionCode ?? "") !== (b.sectionCode ?? "")) return (a.sectionCode ?? "").localeCompare(b.sectionCode ?? "");
    if (a.questionNumber !== b.questionNumber) return a.questionNumber.localeCompare(b.questionNumber, undefined, { numeric: true });
    return (b.year ?? 0) - (a.year ?? 0);
  });
}

export function selectQuestionUnits({ units, selectedLeafTopicIds, targetMarks, paperCodes, maxQuestions, tolerance = 7, excludedSourceQuestionKeys = [], remainingPaperCount = 1, priorSelectedUnitMarks = [], priorPaperCount = 0, priorCoveredLeafTopicIds = [], rng = Math.random }: SelectQuestionUnitsInput) {
  const selectedLeafSet = new Set(selectedLeafTopicIds);
  const allowedPaperCodes = paperCodes && paperCodes.length > 0 ? new Set(paperCodes) : null;
  const excludedSourceQuestionKeySet = new Set(excludedSourceQuestionKeys);
  const candidates = units.filter((unit) => {
    if (!unit.questionPaperCdnUrl) return false;
    if (isLikelyBrokenMathematicsUnit(unit)) return false;
    if (allowedPaperCodes && !allowedPaperCodes.has(unit.paperCode)) return false;
    if (excludedSourceQuestionKeySet.has(unit.sourceQuestionKey)) return false;
    return unit.canonicalLeafs.some((leaf) => selectedLeafSet.has(leaf));
  });
  const safeTolerance = Math.max(3, Math.min(12, tolerance));
  const minimumAcceptableMarks = Math.max(0, targetMarks - safeTolerance);
  const maximumAcceptableMarks = targetMarks + safeTolerance;
  const futurePaperCount = Math.max(0, remainingPaperCount - 1);
  const multiPaperSpreadMultiplier = remainingPaperCount > 1
    ? Math.min(2.2, 1 + (futurePaperCount * 0.45) + (priorPaperCount > 0 ? 0.2 : 0))
    : 1;
  const priorMarkBucketCounts = priorSelectedUnitMarks.reduce((map, marks) => {
    map.set(marks, (map.get(marks) ?? 0) + 1);
    return map;
  }, new Map<number, number>());
  const priorMarkCategoryCounts = priorSelectedUnitMarks.reduce((map, marks) => {
    const category = getMarkCategory(marks);
    map.set(category, (map.get(category) ?? 0) + 1);
    return map;
  }, new Map<"low" | "medium" | "high", number>());
  const candidateMarkCategoryCounts = candidates.reduce((map, unit) => {
    const category = getMarkCategory(unit.totalMarks);
    map.set(category, (map.get(category) ?? 0) + 1);
    return map;
  }, new Map<"low" | "medium" | "high", number>());
  const candidateCountsByLeaf = candidates.reduce((map, unit) => {
    for (const leaf of unit.canonicalLeafs) {
      if (!selectedLeafSet.has(leaf)) continue;
      map.set(leaf, (map.get(leaf) ?? 0) + 1);
    }
    return map;
  }, new Map<string, number>());
  const priorCoveredLeafCounts = priorCoveredLeafTopicIds.reduce((map, leaf) => {
    if (!selectedLeafSet.has(leaf)) return map;
    map.set(leaf, (map.get(leaf) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  const averageUnitMarks = candidates.length > 0
    ? candidates.reduce((sum, unit) => sum + unit.totalMarks, 0) / candidates.length
    : 0;
  const estimatedQuestionCount = Math.max(4, Math.min(12, Math.round(targetMarks / Math.max(1.5, averageUnitMarks || 3))));
  const desiredCategoryCounts = (() => {
    const counts = new Map<"low" | "medium" | "high", number>([
      ["low", 0],
      ["medium", 0],
      ["high", 0],
    ]);
    if (estimatedQuestionCount <= 0) return counts;

    const totalCandidateCount = Math.max(1, candidates.length);
    const baseLow = (candidateMarkCategoryCounts.get("low") ?? 0) / totalCandidateCount;
    const baseMedium = (candidateMarkCategoryCounts.get("medium") ?? 0) / totalCandidateCount;
    const baseHigh = (candidateMarkCategoryCounts.get("high") ?? 0) / totalCandidateCount;
    const lowRatio = Math.min(0.38, Math.max(0.18, baseLow));
    const mediumRatio = Math.min(0.62, Math.max(0.38, baseMedium || 0.5));
    const highRatio = Math.min(0.28, Math.max(0.08, baseHigh || 0.12));
    const ratioTotal = lowRatio + mediumRatio + highRatio;
    counts.set("low", Math.round((estimatedQuestionCount * lowRatio) / ratioTotal));
    counts.set("medium", Math.round((estimatedQuestionCount * mediumRatio) / ratioTotal)); 
    counts.set("high", Math.round((estimatedQuestionCount * highRatio) / ratioTotal));

    let allocated = (counts.get("low") ?? 0) + (counts.get("medium") ?? 0) + (counts.get("high") ?? 0);
    while (allocated < estimatedQuestionCount) {
      counts.set("medium", (counts.get("medium") ?? 0) + 1);
      allocated += 1;
    }
    while (allocated > estimatedQuestionCount) {
      if ((counts.get("low") ?? 0) > 0) {
        counts.set("low", (counts.get("low") ?? 0) - 1);
      } else if ((counts.get("high") ?? 0) > 0) {
        counts.set("high", (counts.get("high") ?? 0) - 1);
      } else {
        counts.set("medium", Math.max(0, (counts.get("medium") ?? 0) - 1));
      }
      allocated -= 1;
    }
    return counts;
  })();

  const finalizeSelection = (selected: QuestionUnit[], currentMarks: number) => {
    const finalCoveredLeafs = new Set<string>();
    for (const unit of selected) {
      for (const leaf of unit.canonicalLeafs) {
        if (selectedLeafSet.has(leaf)) finalCoveredLeafs.add(leaf);
      }
    }

    return {
      selectedUnits: [...selected].sort((a, b) => {
        if (a.totalMarks !== b.totalMarks) return a.totalMarks - b.totalMarks;
        if (a.paperCode !== b.paperCode) return a.paperCode.localeCompare(b.paperCode, undefined, { numeric: true });
        return a.questionNumber.localeCompare(b.questionNumber, undefined, { numeric: true });
      }),
      totalMarks: currentMarks,
      coveredLeafTopicIds: Array.from(finalCoveredLeafs),
      requestedLeafTopicIds: Array.from(selectedLeafSet),
    };
  };

  const runGreedySelection = (mode: "balanced" | "marks") => {
    const selected: QuestionUnit[] = [];
    const coveredLeafs = new Set<string>();
    const sourcePaperCounts = new Map<string, number>();
    const sourceQuestionCounts = new Map<string, number>();
    const selectedYearCounts = new Map<number, number>();
    const selectedMarkBucketCounts = new Map<number, number>();
    const selectedMarkCategoryCounts = new Map<"low" | "medium" | "high", number>();
    const selectedPageKeys = new Set<string>();
    const remaining = new Set(candidates.map((unit) => unit.unitKey));
    const overshootAllowance = safeTolerance;
    let currentMarks = 0;

    const getRemainingCandidateMarks = () => candidates.reduce((sum, unit) => (
      remaining.has(unit.unitKey) ? sum + unit.totalMarks : sum
    ), 0);

    const getFutureSetPenalty = (unit: QuestionUnit) => {
      if (futurePaperCount <= 0) return 0;
      const remainingCandidateMarks = getRemainingCandidateMarks();
      const remainingAfterPick = Math.max(0, remainingCandidateMarks - unit.totalMarks);
      const desiredFutureMarks = targetMarks * futurePaperCount;
      const futureShortfall = Math.max(0, desiredFutureMarks - remainingAfterPick);
      if (futureShortfall <= 0) return 0;

      const progress = targetMarks > 0 ? currentMarks / targetMarks : 0;
      const progressMultiplier = progress < 0.5 ? 1.15 : progress < 0.85 ? 0.85 : 0.45;
      return futureShortfall * progressMultiplier;
    };

    const getBucketPreferenceBonus = (unit: QuestionUnit) => {
      const progress = targetMarks > 0 ? currentMarks / targetMarks : 0;
      if (mode === "marks") {
        if (progress < 0.4) {
          if (unit.totalMarks >= 8) return 180;
          if (unit.totalMarks >= 5) return 110;
          if (unit.totalMarks <= 2) return -140;
          return 20;
        }
        if (progress < 0.8) {
          if (unit.totalMarks >= 6 && unit.totalMarks <= 10) return 90;
          if (unit.totalMarks <= 2) return -70;
          return 30;
        }
        if (unit.totalMarks <= 2) return 30;
        if (unit.totalMarks <= 5) return 70;
        return -10;
      }

      if (progress < 0.3) {
        if (unit.totalMarks <= 3) return 220;
        if (unit.totalMarks <= 6) return 80;
        return -80;
      }
      if (progress < 0.75) {
        if (unit.totalMarks <= 3) return 40;
        if (unit.totalMarks <= 6) return 180;
        return 30;
      }
      if (unit.totalMarks <= 3) return -20;
      if (unit.totalMarks <= 6) return 60;
      return 150;
    };

    const getEffectiveLeafCoverageCount = (leaf: string) => {
      const priorCount = priorCoveredLeafCounts.get(leaf) ?? 0;
      return priorCount + (coveredLeafs.has(leaf) ? 1 : 0);
    };

    const getMinimumLeafCoverageCount = () => {
      let minimumCoverage = Number.POSITIVE_INFINITY;

      for (const leaf of selectedLeafSet) {
        minimumCoverage = Math.min(minimumCoverage, getEffectiveLeafCoverageCount(leaf));
      }

      return Number.isFinite(minimumCoverage) ? minimumCoverage : 0;
    };

    const getLeafScarcityWeight = (leaf: string) => {
      const candidateCount = candidateCountsByLeaf.get(leaf) ?? 1;
      if (candidateCount <= 2) return 1.65;
      if (candidateCount <= 4) return 1.35;
      if (candidateCount <= 8) return 1.15;
      return 1;
    };

    const addUnit = (unit: QuestionUnit) => {
      selected.push(unit);
      currentMarks += unit.totalMarks;
      sourcePaperCounts.set(unit.sourceRelativePath, (sourcePaperCounts.get(unit.sourceRelativePath) ?? 0) + 1);
      sourceQuestionCounts.set(unit.sourceQuestionKey, (sourceQuestionCounts.get(unit.sourceQuestionKey) ?? 0) + 1);
      if (typeof unit.year === "number") {
        selectedYearCounts.set(unit.year, (selectedYearCounts.get(unit.year) ?? 0) + 1);
      }
      selectedMarkBucketCounts.set(unit.totalMarks, (selectedMarkBucketCounts.get(unit.totalMarks) ?? 0) + 1);
      const markCategory = getMarkCategory(unit.totalMarks);
      selectedMarkCategoryCounts.set(markCategory, (selectedMarkCategoryCounts.get(markCategory) ?? 0) + 1);
      for (const page of unit.pages) {
        selectedPageKeys.add(`${unit.sourceRelativePath}::${page.pageNumber}`);
      }
      for (const leaf of unit.canonicalLeafs) {
        if (selectedLeafSet.has(leaf)) coveredLeafs.add(leaf);
      }
      remaining.delete(unit.unitKey);
    };

    const scoreUnit = (unit: QuestionUnit) => {
      const matchedLeafs = unit.canonicalLeafs.filter((leaf) => selectedLeafSet.has(leaf));
      const newLeafs = matchedLeafs.filter((leaf) => !coveredLeafs.has(leaf));
      const minimumLeafCoverageCount = getMinimumLeafCoverageCount();
      const crossPaperNewLeafs = newLeafs.filter((leaf) => (priorCoveredLeafCounts.get(leaf) ?? 0) === 0);
      const lowestCoverageLeafs = newLeafs.filter((leaf) => getEffectiveLeafCoverageCount(leaf) === minimumLeafCoverageCount);
      const lowCoverageSpreadBonus = lowestCoverageLeafs.reduce((sum, leaf) => sum + getLeafScarcityWeight(leaf), 0);
      const crossPaperNoveltyBonus = crossPaperNewLeafs.reduce((sum, leaf) => sum + getLeafScarcityWeight(leaf), 0);
      const repeatedRunLeafPenalty = matchedLeafs.reduce((sum, leaf) => {
        const effectiveCoverageCount = getEffectiveLeafCoverageCount(leaf);
        return sum + Math.max(0, effectiveCoverageCount - minimumLeafCoverageCount);
      }, 0);
      const samePaperPenalty = (sourcePaperCounts.get(unit.sourceRelativePath) ?? 0);
      const sameQuestionPenalty = (sourceQuestionCounts.get(unit.sourceQuestionKey) ?? 0);
      const pageOverlapCount = unit.pages.reduce((sum, page) => {
        const pageKey = `${unit.sourceRelativePath}::${page.pageNumber}`;
        return sum + (selectedPageKeys.has(pageKey) ? 1 : 0);
      }, 0);
      const remainingMarks = Math.max(0, targetMarks - currentMarks);
      const nextMarks = currentMarks + unit.totalMarks;
      const nextDelta = Math.abs(targetMarks - nextMarks);
      const currentDelta = Math.abs(targetMarks - currentMarks);
      const deltaImprovement = currentDelta - nextDelta;
      const overshoot = Math.max(0, nextMarks - maximumAcceptableMarks);
      const sourcePaperUsageCount = sourcePaperCounts.get(unit.sourceRelativePath) ?? 0;
      const yearUsageCount = typeof unit.year === "number" ? (selectedYearCounts.get(unit.year) ?? 0) : 0;
      const priorMarkUsageCount = priorMarkBucketCounts.get(unit.totalMarks) ?? 0;
      const currentMarkUsageCount = selectedMarkBucketCounts.get(unit.totalMarks) ?? 0;
      const markCategory = getMarkCategory(unit.totalMarks);
      const priorMarkCategoryUsageCount = priorMarkCategoryCounts.get(markCategory) ?? 0;
      const currentMarkCategoryUsageCount = selectedMarkCategoryCounts.get(markCategory) ?? 0;
      const sourcePaperSpreadBonus = Math.max(0, 4 - sourcePaperUsageCount) * (mode === "marks" ? 7 : 10);
      const yearSpreadBonus = typeof unit.year === "number"
        ? Math.max(0, 4 - yearUsageCount) * (mode === "marks" ? 6 : 8)
        : 0;
      const markBucketPenalty = (priorMarkUsageCount * (mode === "marks" ? 14 : 10)) + (currentMarkUsageCount * (mode === "marks" ? 18 : 12));
      const markCategoryPenalty = (priorMarkCategoryUsageCount * (mode === "marks" ? 18 : 14)) + (currentMarkCategoryUsageCount * (mode === "marks" ? 24 : 18));
      const randomTieBreaker = rng() * 0.2;
      const futureSetPenalty = getFutureSetPenalty(unit);
      const isMaths = unit.subjectSlug === "mathematics";
      const desiredCategoryCount = desiredCategoryCounts.get(markCategory) ?? 0;
      const projectedCategoryCount = currentMarkCategoryUsageCount + 1;
      const priorAverageCategoryCount = priorPaperCount > 0 ? priorMarkCategoryUsageCount / priorPaperCount : 0;
      const categoryQuotaBonus = projectedCategoryCount <= desiredCategoryCount
        ? (desiredCategoryCount - currentMarkCategoryUsageCount) * (isMaths ? 26 : 10)
        : -((projectedCategoryCount - desiredCategoryCount) * (isMaths ? 42 : 14));
      const crossPaperCategoryPenalty = Math.max(0, projectedCategoryCount - Math.max(desiredCategoryCount, Math.ceil(priorAverageCategoryCount))) * (isMaths ? 18 : 8);
      const tinyPenalty = remainingMarks > 30
        ? (unit.totalMarks <= 2 ? (isMaths ? 170 : 110) : unit.totalMarks <= 4 ? (isMaths ? 55 : 40) : 0)
        : remainingMarks > 18
          ? (unit.totalMarks <= 2 ? (isMaths ? 100 : 70) : 0)
          : unit.totalMarks <= 2
            ? (isMaths ? 18 : 10)
            : 0;
      const bucketBonus = getBucketPreferenceBonus(unit);

      if (mode === "marks") {
        const fitBonus = Math.min(unit.totalMarks, remainingMarks) * 20;
        return (deltaImprovement * 260)
          + fitBonus
          + (newLeafs.length * 90)
          + (matchedLeafs.length * 14)
          + (lowCoverageSpreadBonus * 135 * multiPaperSpreadMultiplier)
          + (crossPaperNoveltyBonus * 80 * multiPaperSpreadMultiplier)
          + bucketBonus
          + sourcePaperSpreadBonus
          + yearSpreadBonus
          + categoryQuotaBonus
          + randomTieBreaker
          - markBucketPenalty
          - markCategoryPenalty
          - crossPaperCategoryPenalty
          - (futureSetPenalty * 18)
          - (overshoot * 180)
          - (samePaperPenalty * 20)
          - (sameQuestionPenalty * 900)
          - (pageOverlapCount * 260)
          - (repeatedRunLeafPenalty * 45 * multiPaperSpreadMultiplier)
          - tinyPenalty;
      }

      const marksFitBonus = unit.totalMarks <= remainingMarks ? unit.totalMarks * 3 : Math.max(0, 25 - Math.max(0, nextMarks - targetMarks) * 3);
      return (newLeafs.length * 1000)
        + (matchedLeafs.length * 120)
        + (lowCoverageSpreadBonus * 260 * multiPaperSpreadMultiplier)
        + (crossPaperNoveltyBonus * 180 * multiPaperSpreadMultiplier)
        + marksFitBonus
        + bucketBonus
        + sourcePaperSpreadBonus
        + yearSpreadBonus
        + categoryQuotaBonus
        + randomTieBreaker
        - markBucketPenalty
        - markCategoryPenalty
        - crossPaperCategoryPenalty
        - (futureSetPenalty * 14)
        - (samePaperPenalty * 40)
        - (sameQuestionPenalty * 600)
        - (pageOverlapCount * 1200)
        - (repeatedRunLeafPenalty * 120 * multiPaperSpreadMultiplier)
        - (unit.totalMarks <= 2 ? 20 : 0);
    };

    while (remaining.size > 0) {
      if (maxQuestions && selected.length >= maxQuestions) break;

      let bestUnit: QuestionUnit | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      const remainingMarks = targetMarks - currentMarks;
      const eligibleCandidates = candidates.filter((unit) => {
        if (!remaining.has(unit.unitKey)) return false;
        if (sourceQuestionCounts.has(unit.sourceQuestionKey)) return false;
        if (currentMarks === 0) return true;
        return unit.totalMarks <= remainingMarks + overshootAllowance;
      });

      const noPageReuseCandidates = eligibleCandidates.filter((unit) =>
        unit.pages.every((page) => !selectedPageKeys.has(`${unit.sourceRelativePath}::${page.pageNumber}`)));

      const candidatePool = noPageReuseCandidates.length > 0
        ? noPageReuseCandidates
        : eligibleCandidates.length > 0
          ? eligibleCandidates
          : candidates.filter((unit) => remaining.has(unit.unitKey) && !sourceQuestionCounts.has(unit.sourceQuestionKey));

      for (const unit of candidatePool) {
        const score = scoreUnit(unit);
        if (score > bestScore) {
          bestScore = score;
          bestUnit = unit;
        }
      }

      if (!bestUnit) break;
      if (mode === "marks") {
        const bestNextDelta = Math.abs(targetMarks - (currentMarks + bestUnit.totalMarks));
        const currentDelta = Math.abs(targetMarks - currentMarks);
        if (bestNextDelta > currentDelta && currentMarks >= minimumAcceptableMarks) {
          break;
        }
      } else if (bestScore < 0 && currentMarks >= minimumAcceptableMarks) {
        break;
      }

      addUnit(bestUnit);

      if (currentMarks >= targetMarks) {
        break;
      }
    }

    while (remaining.size > 0 && currentMarks < minimumAcceptableMarks) {
      if (maxQuestions && selected.length >= maxQuestions) break;

      let bestFillUnit: QuestionUnit | null = null;
      let bestFillScore = Number.NEGATIVE_INFINITY;

      for (const unit of candidates) {
        if (!remaining.has(unit.unitKey)) continue;
        if (sourceQuestionCounts.has(unit.sourceQuestionKey)) continue;

        const nextMarks = currentMarks + unit.totalMarks;
        const nextDelta = Math.abs(targetMarks - nextMarks);
        const currentDelta = Math.abs(targetMarks - currentMarks);
        const improvesDelta = nextDelta < currentDelta;
        const pageOverlapCount = unit.pages.reduce((sum, page) => (
          selectedPageKeys.has(`${unit.sourceRelativePath}::${page.pageNumber}`) ? sum + 1 : sum
        ), 0);
        const matchedLeafs = unit.canonicalLeafs.filter((leaf) => selectedLeafSet.has(leaf));
        const newLeafs = matchedLeafs.filter((leaf) => !coveredLeafs.has(leaf));
        const minimumLeafCoverageCount = getMinimumLeafCoverageCount();
        const crossPaperNewLeafs = newLeafs.filter((leaf) => (priorCoveredLeafCounts.get(leaf) ?? 0) === 0);
        const lowestCoverageLeafs = newLeafs.filter((leaf) => getEffectiveLeafCoverageCount(leaf) === minimumLeafCoverageCount);
        const hardOvershootPenalty = nextMarks > maximumAcceptableMarks ? (nextMarks - maximumAcceptableMarks) * (mode === "marks" ? 220 : 140) : 0;
        const softSamePaperPenalty = (sourcePaperCounts.get(unit.sourceRelativePath) ?? 0) * (mode === "marks" ? 12 : 18);
        const pageOverlapPenalty = pageOverlapCount * (mode === "marks" ? 120 : 90);
        const noveltyBonus = newLeafs.length * (mode === "marks" ? 10 : 18);
        const lowCoverageSpreadBonus = lowestCoverageLeafs.reduce((sum, leaf) => sum + getLeafScarcityWeight(leaf), 0);
        const crossPaperNoveltyBonus = crossPaperNewLeafs.reduce((sum, leaf) => sum + getLeafScarcityWeight(leaf), 0);
        const repeatedRunLeafPenalty = matchedLeafs.reduce((sum, leaf) => {
          const effectiveCoverageCount = getEffectiveLeafCoverageCount(leaf);
          return sum + Math.max(0, effectiveCoverageCount - minimumLeafCoverageCount);
        }, 0);
        const sourcePaperUsageCount = sourcePaperCounts.get(unit.sourceRelativePath) ?? 0;
        const yearUsageCount = typeof unit.year === "number" ? (selectedYearCounts.get(unit.year) ?? 0) : 0;
        const priorMarkUsageCount = priorMarkBucketCounts.get(unit.totalMarks) ?? 0;
        const currentMarkUsageCount = selectedMarkBucketCounts.get(unit.totalMarks) ?? 0;
        const markCategory = getMarkCategory(unit.totalMarks);
        const priorMarkCategoryUsageCount = priorMarkCategoryCounts.get(markCategory) ?? 0;
        const currentMarkCategoryUsageCount = selectedMarkCategoryCounts.get(markCategory) ?? 0;
        const sourcePaperSpreadBonus = Math.max(0, 4 - sourcePaperUsageCount) * (mode === "marks" ? 5 : 8);
        const yearSpreadBonus = typeof unit.year === "number"
          ? Math.max(0, 4 - yearUsageCount) * (mode === "marks" ? 4 : 6)
          : 0;
        const markBucketPenalty = (priorMarkUsageCount * (mode === "marks" ? 10 : 8)) + (currentMarkUsageCount * (mode === "marks" ? 14 : 10));
        const markCategoryPenalty = (priorMarkCategoryUsageCount * (mode === "marks" ? 10 : 8)) + (currentMarkCategoryUsageCount * (mode === "marks" ? 14 : 10));
        const randomTieBreaker = rng() * 0.2;
        const futureSetPenalty = getFutureSetPenalty(unit);
        const isMaths = unit.subjectSlug === "mathematics";
        const desiredCategoryCount = desiredCategoryCounts.get(markCategory) ?? 0;
        const projectedCategoryCount = currentMarkCategoryUsageCount + 1;
        const priorAverageCategoryCount = priorPaperCount > 0 ? priorMarkCategoryUsageCount / priorPaperCount : 0;
        const categoryQuotaBonus = projectedCategoryCount <= desiredCategoryCount
          ? (desiredCategoryCount - currentMarkCategoryUsageCount) * (isMaths ? 18 : 8)
          : -((projectedCategoryCount - desiredCategoryCount) * (isMaths ? 28 : 12));
        const crossPaperCategoryPenalty = Math.max(0, projectedCategoryCount - Math.max(desiredCategoryCount, Math.ceil(priorAverageCategoryCount))) * (isMaths ? 12 : 6);
        const score = (improvesDelta ? (mode === "marks" ? 900 : 600) : 0)
          - (nextDelta * (mode === "marks" ? 42 : 32))
          - hardOvershootPenalty
          - softSamePaperPenalty
          - pageOverlapPenalty
          + noveltyBonus
          + (lowCoverageSpreadBonus * (mode === "marks" ? 60 : 100) * multiPaperSpreadMultiplier)
          + (crossPaperNoveltyBonus * (mode === "marks" ? 35 : 70) * multiPaperSpreadMultiplier)
          + sourcePaperSpreadBonus
          + yearSpreadBonus
          + categoryQuotaBonus
          + randomTieBreaker
          - markBucketPenalty
          - markCategoryPenalty
          - crossPaperCategoryPenalty
          - (repeatedRunLeafPenalty * (mode === "marks" ? 20 : 40) * multiPaperSpreadMultiplier)
          - (futureSetPenalty * 8);

        if (score > bestFillScore) {
          bestFillScore = score;
          bestFillUnit = unit;
        }
      }

      if (!bestFillUnit) break;

      const prospectiveMarks = currentMarks + bestFillUnit.totalMarks;
      if (prospectiveMarks > maximumAcceptableMarks && currentMarks >= minimumAcceptableMarks) break;

      addUnit(bestFillUnit);
    }

    if (currentMarks > maximumAcceptableMarks) {
      let bestTrimIndex = -1;
      let bestTrimDelta = Math.abs(currentMarks - targetMarks);
      for (const [index, unit] of selected.entries()) {
        const trimmedMarks = currentMarks - unit.totalMarks;
        const delta = Math.abs(trimmedMarks - targetMarks);
        if (trimmedMarks >= minimumAcceptableMarks && delta < bestTrimDelta) {
          bestTrimDelta = delta;
          bestTrimIndex = index;
        }
      }

      if (bestTrimIndex >= 0) {
        const [removed] = selected.splice(bestTrimIndex, 1);
        currentMarks -= removed.totalMarks;
      }
    }

    return finalizeSelection(selected, currentMarks);
  };

  const compareSelections = (
    left: ReturnType<typeof finalizeSelection>,
    right: ReturnType<typeof finalizeSelection>,
  ) => {
    const leftInRange = left.totalMarks >= minimumAcceptableMarks && left.totalMarks <= maximumAcceptableMarks;
    const rightInRange = right.totalMarks >= minimumAcceptableMarks && right.totalMarks <= maximumAcceptableMarks;
    if (leftInRange !== rightInRange) return leftInRange ? -1 : 1;

    const leftDelta = Math.abs(targetMarks - left.totalMarks);
    const rightDelta = Math.abs(targetMarks - right.totalMarks);
    if (leftInRange && rightInRange && Math.abs(leftDelta - rightDelta) <= 2) {
      if (left.coveredLeafTopicIds.length !== right.coveredLeafTopicIds.length) {
        return right.coveredLeafTopicIds.length - left.coveredLeafTopicIds.length;
      }
    }
    if (leftDelta !== rightDelta) return leftDelta - rightDelta;
    if (left.totalMarks !== right.totalMarks) return right.totalMarks - left.totalMarks;
    if (left.coveredLeafTopicIds.length !== right.coveredLeafTopicIds.length) {
      return right.coveredLeafTopicIds.length - left.coveredLeafTopicIds.length;
    }
    return left.selectedUnits.length - right.selectedUnits.length;
  };

  const attempts = [runGreedySelection("balanced"), runGreedySelection("marks")];
  attempts.sort(compareSelections);
  return attempts[0] ?? finalizeSelection([], 0);
}
