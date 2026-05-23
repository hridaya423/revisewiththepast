import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { QuestionUnit, TopicTreeNode, TopicTreeNodeWithCounts } from "@/lib/paper-maker/aqa-geography";

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

function loadAqaEnglishLiteratureTaxonomy() {
  const filePath = resolve(process.cwd(), "config/aqa-english-literature/taxonomy.json");
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

export function getAqaEnglishLiteratureTopicTree() {
  if (cachedTree) return cachedTree;

  const taxonomy = loadAqaEnglishLiteratureTaxonomy();
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

export function expandAqaEnglishLiteratureTopicSelection(selectedNodeIds: string[]) {
  const index = cachedIndex ?? buildTopicIndex(getAqaEnglishLiteratureTopicTree());
  return Array.from(new Set(selectedNodeIds.flatMap((nodeId) => index.get(nodeId)?.leafTopicIds ?? [])));
}

export function buildAqaEnglishLiteratureTopicTreeWithCounts(units: QuestionUnit[]): TopicTreeNodeWithCounts[] {
  const tree = getAqaEnglishLiteratureTopicTree();
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
