import type { TopicTreeNodeWithCounts } from "@/shared/domain/topic";
export type SelectedTopicSummary = { id: string; label: string; leafTopicIds: string[] };
export function flattenLeafIds(nodes: TopicTreeNodeWithCounts[]) { return Array.from(new Set(nodes.flatMap((node) => node.leafTopicIds))); }
export function getSelectionState(node: TopicTreeNodeWithCounts, selectedLeafIds: Set<string>) {
  const matchedLeafCount = node.leafTopicIds.filter((leafId) => selectedLeafIds.has(leafId)).length;
  return { checked: matchedLeafCount > 0 && matchedLeafCount === node.leafTopicIds.length, partial: matchedLeafCount > 0 && matchedLeafCount < node.leafTopicIds.length };
}
export function buildSelectedTopicSummaries(nodes: TopicTreeNodeWithCounts[], selectedLeafIds: Set<string>) {
  const summaries: SelectedTopicSummary[] = [];
  const walk = (node: TopicTreeNodeWithCounts) => { const selection = getSelectionState(node, selectedLeafIds); if (!node.children?.length) { if (selection.checked) summaries.push({ id: node.id, label: node.label, leafTopicIds: node.leafTopicIds }); return; } node.children.forEach(walk); };
  nodes.forEach(walk);
  return summaries;
}
