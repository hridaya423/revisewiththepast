import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { BoundingBox, QuestionBankPart, QuestionUnit, TopicTreeNode, TopicTreeNodeWithCounts } from "@/lib/paper-maker/aqa-geography";

type TaxonomyTopic = {
  id: string;
  parentId: string | null;
  label: string;
  kind: "branch" | "leaf";
  paperCodes?: string[];
};

type Taxonomy = {
  topics: TaxonomyTopic[];
};

let cachedTree: TopicTreeNode[] | null = null;
let cachedIndex: Map<string, TopicTreeNode> | null = null;

function loadBusinessTaxonomy() {
  const filePath = resolve(process.cwd(), "config/edexcel-business/taxonomy.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as Taxonomy;
}

function buildNode(topic: TaxonomyTopic, byParent: Map<string | null, TaxonomyTopic[]>): TopicTreeNode {
  const children = (byParent.get(topic.id) ?? []).map((child) => buildNode(child, byParent));
  if (children.length > 0) {
    return {
      id: topic.id,
      label: topic.label,
      children,
      leafTopicIds: Array.from(new Set(children.flatMap((child) => child.leafTopicIds))),
    };
  }

  return {
    id: topic.id,
    label: topic.label,
    leafTopicIds: [topic.id],
  };
}

function buildTopicIndex(nodes: TopicTreeNode[], map = new Map<string, TopicTreeNode>()) {
  for (const node of nodes) {
    map.set(node.id, node);
    if (node.children) buildTopicIndex(node.children, map);
  }
  return map;
}

export function getEdexcelBusinessTopicTree() {
  if (cachedTree) return cachedTree;

  const taxonomy = loadBusinessTaxonomy();
  const byParent = new Map<string | null, TaxonomyTopic[]>();
  for (const topic of taxonomy.topics) {
    const entries = byParent.get(topic.parentId) ?? [];
    entries.push(topic);
    byParent.set(topic.parentId, entries);
  }

  const rootNodes = (byParent.get(null) ?? []).map((topic) => buildNode(topic, byParent));
  cachedTree = rootNodes;
  cachedIndex = buildTopicIndex(rootNodes);
  return rootNodes;
}

export function expandEdexcelBusinessTopicSelection(selectedNodeIds: string[]) {
  const index = cachedIndex ?? buildTopicIndex(getEdexcelBusinessTopicTree());
  return Array.from(new Set(selectedNodeIds.flatMap((nodeId) => index.get(nodeId)?.leafTopicIds ?? [])));
}

export function buildEdexcelBusinessTopicTreeWithCounts(units: QuestionUnit[]): TopicTreeNodeWithCounts[] {
  const tree = getEdexcelBusinessTopicTree();
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

function compareBusinessPartOrder(left: QuestionBankPart, right: QuestionBankPart) {
  if (left.pageNumber !== right.pageNumber) return left.pageNumber - right.pageNumber;
  if ((left.questionPartNumber ?? "") !== (right.questionPartNumber ?? "")) {
    return (left.questionPartNumber ?? "").localeCompare(right.questionPartNumber ?? "", undefined, { numeric: true });
  }
  return left.questionId.localeCompare(right.questionId, undefined, { numeric: true });
}

function unionBusinessBoxes(boxes: BoundingBox[]) {
  return boxes.reduce((acc, box) => ({
    x0: Math.min(acc.x0, box.x0),
    y0: Math.min(acc.y0, box.y0),
    x1: Math.max(acc.x1, box.x1),
    y1: Math.max(acc.y1, box.y1),
  }));
}

function makeSectionContextPart(anchor: QuestionBankPart): QuestionBankPart | null {
  if (!anchor.stemSpans || anchor.stemSpans.length === 0) return null;
  return {
    ...anchor,
    partKey: `${anchor.partKey}::section-context`,
    marks: 0,
    promptText: anchor.contextText ?? anchor.promptText,
    pageNumbers: Array.from(new Set(anchor.stemSpans.map((span) => span.pageNumber))).sort((a, b) => a - b),
    bbox: null,
    regionSpans: null,
    sourceMode: "context_stem",
  };
}

function isSectionContextAnchor(part: QuestionBankPart) {
  return Boolean(part.contextText && /before answering questions?\s+\d/i.test(part.contextText));
}

export function groupEdexcelBusinessQuestionUnits(units: QuestionUnit[]): QuestionUnit[] {
  const partsByGroup = new Map<string, QuestionBankPart[]>();
  const partsBySourceSection = new Map<string, QuestionBankPart[]>();

  for (const unit of units) {
    const actualPart = unit.parts[0];
    if (!actualPart) continue;
    const groupParts = partsByGroup.get(unit.groupUnitKey) ?? [];
    groupParts.push(actualPart);
    partsByGroup.set(unit.groupUnitKey, groupParts);

    const sectionKey = `${unit.sourceRelativePath}::${actualPart.sectionCode ?? ""}`;
    const sectionParts = partsBySourceSection.get(sectionKey) ?? [];
    sectionParts.push(actualPart);
    partsBySourceSection.set(sectionKey, sectionParts);
  }

  const grouped: QuestionUnit[] = [];
  for (const [groupUnitKey, rawParts] of partsByGroup.entries()) {
    const actualParts = [...rawParts].sort(compareBusinessPartOrder);
    const first = actualParts[0];
    if (!first) continue;

    const sectionKey = `${first.sourceRelativePath}::${first.sectionCode ?? ""}`;
    const sectionParts = [...(partsBySourceSection.get(sectionKey) ?? [])].sort(compareBusinessPartOrder);
    const firstSectionIndex = sectionParts.findIndex((part) => part.partKey === first.partKey);
    const needsSectionContext = /^(?:B|C)$/i.test(first.sectionCode ?? "");
    const externalAnchor = needsSectionContext
      ? sectionParts.slice(0, Math.max(firstSectionIndex + 1, 0)).find(isSectionContextAnchor) ?? null
      : null;
    const contextPart = externalAnchor ? makeSectionContextPart(externalAnchor) : null;
    const renderParts = [...(contextPart ? [contextPart] : []), ...actualParts].sort(compareBusinessPartOrder);

    const pageMap = new Map<number, QuestionBankPart[]>();
    for (const part of renderParts) {
      for (const pageNumber of part.pageNumbers) {
        const pageParts = pageMap.get(pageNumber) ?? [];
        pageParts.push(part);
        pageMap.set(pageNumber, pageParts);
      }
    }

    const pages = Array.from(pageMap.entries()).map(([pageNumber, pageParts]) => {
      const boxes = pageParts.map((part) => part.bbox).filter((box): box is BoundingBox => box !== null);
      return {
        pageNumber,
        parts: pageParts,
        bboxUnion: boxes.length > 0 ? unionBusinessBoxes(boxes) : null,
      };
    }).sort((a, b) => a.pageNumber - b.pageNumber);

    grouped.push({
      unitKey: groupUnitKey,
      groupUnitKey,
      sourceQuestionKey: `${first.boardCode}::${first.subjectSlug}::${first.paperCode}::${first.year ?? "-"}::${first.session ?? "-"}::${first.sectionCode ?? "-"}::q${first.questionNumber}`,
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
      totalMarks: actualParts.reduce((sum, part) => sum + (part.marks ?? 0), 0),
      canonicalLeafs: Array.from(new Set(actualParts.map((part) => part.canonicalLeaf))),
      parts: renderParts,
      pages,
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
