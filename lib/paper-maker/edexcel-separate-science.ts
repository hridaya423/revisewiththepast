import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { QuestionUnit, TopicTreeNode, TopicTreeNodeWithCounts } from "@/lib/paper-maker/aqa-geography";

type TaxonomyTopic = {
  id: string;
  parentId: string | null;
  label: string;
  kind: "branch" | "leaf";
};

type Taxonomy = {
  topics: TaxonomyTopic[];
};

const treeCache = new Map<string, TopicTreeNode[]>();
const indexCache = new Map<string, Map<string, TopicTreeNode>>();

function loadTaxonomy(subjectSlug: "biology" | "chemistry" | "physics") {
  const filePath = resolve(process.cwd(), `config/edexcel-${subjectSlug}/taxonomy.json`);
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

export function getEdexcelSeparateScienceTopicTree(subjectSlug: "biology" | "chemistry" | "physics") {
  const cached = treeCache.get(subjectSlug);
  if (cached) return cached;

  const taxonomy = loadTaxonomy(subjectSlug);
  const byParent = new Map<string | null, TaxonomyTopic[]>();
  for (const topic of taxonomy.topics) {
    const entries = byParent.get(topic.parentId) ?? [];
    entries.push(topic);
    byParent.set(topic.parentId, entries);
  }

  const rootNodes = (byParent.get(null) ?? []).map((topic) => buildNode(topic, byParent));
  treeCache.set(subjectSlug, rootNodes);
  indexCache.set(subjectSlug, buildTopicIndex(rootNodes));
  return rootNodes;
}

export function expandEdexcelSeparateScienceTopicSelection(subjectSlug: "biology" | "chemistry" | "physics", selectedNodeIds: string[]) {
  const index = indexCache.get(subjectSlug) ?? buildTopicIndex(getEdexcelSeparateScienceTopicTree(subjectSlug));
  indexCache.set(subjectSlug, index);
  return Array.from(new Set(selectedNodeIds.flatMap((nodeId) => index.get(nodeId)?.leafTopicIds ?? [])));
}

export function buildEdexcelSeparateScienceTopicTreeWithCounts(subjectSlug: "biology" | "chemistry" | "physics", units: QuestionUnit[]): TopicTreeNodeWithCounts[] {
  const tree = getEdexcelSeparateScienceTopicTree(subjectSlug);
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
