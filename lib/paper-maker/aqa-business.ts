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
  const filePath = resolve(process.cwd(), "config/aqa-business/taxonomy.json");
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

export function getAqaBusinessTopicTree() {
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

export function expandAqaBusinessTopicSelection(selectedNodeIds: string[]) {
  const index = cachedIndex ?? buildTopicIndex(getAqaBusinessTopicTree());
  return Array.from(new Set(selectedNodeIds.flatMap((nodeId) => index.get(nodeId)?.leafTopicIds ?? [])));
}

export function buildAqaBusinessTopicTreeWithCounts(units: QuestionUnit[]): TopicTreeNodeWithCounts[] {
  const tree = getAqaBusinessTopicTree();
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

function buildAqaBusinessQuestionKey(part: QuestionBankPart) {
  return [
    part.boardCode,
    part.subjectSlug,
    part.paperCode,
    part.year ?? "-",
    part.session ?? "-",
    `q${part.questionNumber}`,
  ].join("::");
}

export function groupAqaBusinessQuestionUnits(units: QuestionUnit[]): QuestionUnit[] {
  const partsByQuestion = new Map<string, Map<string, QuestionBankPart>>();

  for (const unit of units) {
    for (const part of unit.parts) {
      const questionKey = buildAqaBusinessQuestionKey(part);
      const parts = partsByQuestion.get(questionKey) ?? new Map<string, QuestionBankPart>();
      parts.set(part.partKey, part);
      partsByQuestion.set(questionKey, parts);
    }
  }

  const grouped: QuestionUnit[] = [];
  for (const [sourceQuestionKey, partMap] of partsByQuestion.entries()) {
    const parts = Array.from(partMap.values()).sort(compareBusinessPartOrder);
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
      unitKey: `${first.sourceRelativePath}::q${first.questionNumber}`,
      groupUnitKey: `${first.sourceRelativePath}::q${first.questionNumber}`,
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
          const boxes = pageParts.map((part) => part.bbox).filter((box): box is BoundingBox => box !== null);
          return {
            pageNumber,
            parts: pageParts,
            bboxUnion: boxes.length > 0 ? unionBusinessBoxes(boxes) : null,
          };
        })
        .sort((left, right) => left.pageNumber - right.pageNumber),
    });
  }

  return grouped.sort((a, b) => {
    if (a.totalMarks !== b.totalMarks) return a.totalMarks - b.totalMarks;
    if (a.paperCode !== b.paperCode) return a.paperCode.localeCompare(b.paperCode, undefined, { numeric: true });
    if (a.questionNumber !== b.questionNumber) return a.questionNumber.localeCompare(b.questionNumber, undefined, { numeric: true });
    return (b.year ?? 0) - (a.year ?? 0);
  });
}
