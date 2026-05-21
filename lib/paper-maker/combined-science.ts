import type {
  QuestionBankPart,
  QuestionUnit,
  TopicTreeNode,
  TopicTreeNodeWithCounts,
} from "@/lib/paper-maker/aqa-geography";

export type SubjectTierKey = "foundation" | "higher";

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

function titleCase(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getCombinedScienceSubjectLabel(subjectKey: string) {
  switch (subjectKey) {
    case "biology":
      return "Biology";
    case "chemistry":
      return "Chemistry";
    case "physics":
      return "Physics";
    default:
      return titleCase(subjectKey);
  }
}

function getCombinedScienceTopicLabel(topicKey: string) {
  const labels: Record<string, string> = {
    "animal-coordination": "Animal coordination",
    "cells-control": "Cells and control",
    ecosystems: "Ecosystems",
    "exchange-transport": "Exchange and transport",
    genetics: "Genetics",
    "health-disease": "Health and disease",
    "key-concepts": "Key concepts",
    "natural-selection": "Natural selection and evolution",
    "plant-structures": "Plant structures and functions",
    "chemical-changes": "Chemical changes",
    "extracting-metals": "Extracting metals and equilibria",
    "formulae-equations": "Formulae, equations and hazards",
    "fuels-earth": "Fuels, Earth and atmosphere",
    "groups-periodic": "Groups in the periodic table",
    "rates-energy": "Rates and energy changes",
    "states-matter": "States of matter",
    "conservation-energy": "Conservation of energy",
    "electricity-circuits": "Electricity and circuits",
    "em-induction": "Electromagnetism and induction",
    "energy-forces-work": "Work and energy",
    "forces-effects": "Forces and their effects",
    "forces-matter": "Forces and matter",
    "light-em": "Light and electromagnetic spectrum",
    "magnetism-motor": "Magnetism and motors",
    "motion-forces": "Motion and forces",
    "particle-model": "Particle model",
    radioactivity: "Radioactivity",
    waves: "Waves",
  };

  return labels[topicKey] ?? titleCase(topicKey);
}

function buildTopicIndex(nodes: TopicTreeNode[], map = new Map<string, TopicTreeNode>()) {
  for (const node of nodes) {
    map.set(node.id, node);
    if (node.children) buildTopicIndex(node.children, map);
  }
  return map;
}

export function inferCombinedScienceTierFromPath(sourceRelativePath: string): SubjectTierKey | null {
  const normalizedPath = sourceRelativePath.toLowerCase();
  if (normalizedPath.includes("/foundation/")) return "foundation";
  if (normalizedPath.includes("/higher/")) return "higher";
  return null;
}

export function inferSubjectTierFromPath(sourceRelativePath: string): SubjectTierKey | null {
  return inferCombinedScienceTierFromPath(sourceRelativePath);
}

export function filterQuestionBankByTier(questionBank: QuestionBankPart[], tier: SubjectTierKey) {
  return questionBank.filter((part) => inferSubjectTierFromPath(part.sourceRelativePath) === tier);
}

export function filterUnitsByTier(units: QuestionUnit[], tier: SubjectTierKey) {
  return units.filter((unit) => inferSubjectTierFromPath(unit.sourceRelativePath) === tier);
}

export function countUnitsByTier(units: QuestionUnit[]) {
  return units.reduce(
    (counts, unit) => {
      const tier = inferSubjectTierFromPath(unit.sourceRelativePath);
      if (tier) counts[tier] += 1;
      return counts;
    },
    { foundation: 0, higher: 0 },
  );
}

export function filterCombinedScienceQuestionBankByTier(questionBank: QuestionBankPart[], tier: SubjectTierKey) {
  return filterQuestionBankByTier(questionBank, tier);
}

export function filterCombinedScienceUnitsByTier(units: QuestionUnit[], tier: SubjectTierKey) {
  return filterUnitsByTier(units, tier);
}

export function countCombinedScienceUnitsByTier(units: QuestionUnit[]) {
  return countUnitsByTier(units);
}

export function collectLeafTopicIds(units: QuestionUnit[]) {
  return Array.from(new Set(units.flatMap((unit) => unit.canonicalLeafs))).sort();
}

export function buildCombinedScienceTopicTree(units: QuestionUnit[]): TopicTreeNode[] {
  const leaves = collectLeafTopicIds(units);
  const subjectMap = new Map<string, Map<string, string[]>>();

  for (const leaf of leaves) {
    const [subjectKey, topicKey] = leaf.split(".");
    if (!subjectKey || !topicKey) continue;

    const topicsForSubject = subjectMap.get(subjectKey) ?? new Map<string, string[]>();
    const existingLeaves = topicsForSubject.get(topicKey) ?? [];
    existingLeaves.push(leaf);
    topicsForSubject.set(topicKey, existingLeaves);
    subjectMap.set(subjectKey, topicsForSubject);
  }

  return Array.from(subjectMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subjectKey, topicsForSubject]) => defineNode({
      id: `combined-science-${subjectKey}`,
      label: getCombinedScienceSubjectLabel(subjectKey),
      children: Array.from(topicsForSubject.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([topicKey, leafTopicIds]) => ({
          id: `combined-science-${subjectKey}-${topicKey}`,
          label: getCombinedScienceTopicLabel(topicKey),
          leafTopicIds: leafTopicIds.sort(),
        })),
    }));
}

export function buildCombinedScienceTopicTreeWithCounts(units: QuestionUnit[]): TopicTreeNodeWithCounts[] {
  const tree = buildCombinedScienceTopicTree(units);
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

  return tree.map(attachCounts);
}

export function expandCombinedScienceTopicSelection(selectedNodeIds: string[], units: QuestionUnit[]) {
  const topicIndex = buildTopicIndex(buildCombinedScienceTopicTree(units));
  return Array.from(new Set(selectedNodeIds.flatMap((nodeId) => topicIndex.get(nodeId)?.leafTopicIds ?? [])));
}
