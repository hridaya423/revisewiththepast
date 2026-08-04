import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { BoundingBox, QuestionBankPart, QuestionUnit } from "@/shared/domain/paper";
import type { TopicTreeNode, TopicTreeNodeWithCounts } from "@/shared/domain/topic";

type TaxonomyTopic = {
  id: string;
  parentId: string | null;
  label: string;
  kind: "branch" | "leaf";
};

type Taxonomy = {
  topics: TaxonomyTopic[];
};

let cachedTree: TopicTreeNode[] | null = null;
let cachedIndex: Map<string, TopicTreeNode> | null = null;

function loadEnglishLanguageTaxonomy() {
  const filePath = resolve(process.cwd(), "config/aqa-english-language/taxonomy.json");
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

export function getAqaEnglishLanguageTopicTree() {
  if (cachedTree) return cachedTree;

  const taxonomy = loadEnglishLanguageTaxonomy();
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

export function expandAqaEnglishLanguageTopicSelection(selectedNodeIds: string[]) {
  const index = cachedIndex ?? buildTopicIndex(getAqaEnglishLanguageTopicTree());
  return Array.from(new Set(selectedNodeIds.flatMap((nodeId) => index.get(nodeId)?.leafTopicIds ?? [])));
}

export function buildAqaEnglishLanguageTopicTreeWithCounts(units: QuestionUnit[]): TopicTreeNodeWithCounts[] {
  const tree = getAqaEnglishLanguageTopicTree();
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

function unionBoundingBoxes(boxes: BoundingBox[]) {
  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
  };
}

export function groupAqaEnglishLanguageSectionUnits(units: QuestionUnit[]): QuestionUnit[] {
  const groupedParts = new Map<string, QuestionBankPart[]>();
  const passthrough: QuestionUnit[] = [];

  for (const unit of units) {
    if (unit.sectionCode !== "A") {
      passthrough.push(unit);
      continue;
    }
    const key = `${unit.sourceRelativePath}::${unit.sectionCode}`;
    const parts = groupedParts.get(key) ?? [];
    parts.push(...unit.parts);
    groupedParts.set(key, parts);
  }

  const grouped: QuestionUnit[] = [];
  for (const [key, rawParts] of groupedParts.entries()) {
    const parts = [...rawParts].sort((left, right) => {
      if (left.pageNumber !== right.pageNumber) return left.pageNumber - right.pageNumber;
      if (left.questionNumber !== right.questionNumber) return left.questionNumber.localeCompare(right.questionNumber, undefined, { numeric: true });
      return (left.questionPartNumber ?? "").localeCompare(right.questionPartNumber ?? "", undefined, { numeric: true });
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
      unitKey: key,
      groupUnitKey: key,
      sourceQuestionKey: `${first.boardCode}::${first.subjectSlug}::${first.paperCode}::${first.year ?? "-"}::${first.session ?? "-"}::${first.sectionCode ?? "-"}`,
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
      pages: Array.from(pageMap.entries()).map(([pageNumber, pageParts]) => {
        const boxes = pageParts.map((part) => part.bbox).filter((bbox): bbox is BoundingBox => bbox !== null);
        return {
          pageNumber,
          parts: pageParts,
          bboxUnion: boxes.length > 0 ? unionBoundingBoxes(boxes) : null,
        };
      }).sort((left, right) => left.pageNumber - right.pageNumber),
    });
  }

  return [...grouped, ...passthrough].sort((a, b) => {
    if (a.totalMarks !== b.totalMarks) return a.totalMarks - b.totalMarks;
    if (a.paperCode !== b.paperCode) return a.paperCode.localeCompare(b.paperCode, undefined, { numeric: true });
    return (b.year ?? 0) - (a.year ?? 0);
  });
}
