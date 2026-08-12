"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { motionTokens } from "@/app/_components/ui/motion-tokens";
import type { TopicTreeNodeWithCounts } from "@/shared/domain/topic";

export type SelectedTopicSummary = {
  id: string;
  label: string;
  leafTopicIds: string[];
};

export function flattenLeafIds(nodes: TopicTreeNodeWithCounts[]) {
  return Array.from(new Set(nodes.flatMap((node) => node.leafTopicIds)));
}

export function getSelectionState(node: TopicTreeNodeWithCounts, selectedLeafIds: Set<string>) {
  const matchedLeafCount = node.leafTopicIds.filter((leafId) => selectedLeafIds.has(leafId)).length;
  return {
    checked: matchedLeafCount > 0 && matchedLeafCount === node.leafTopicIds.length,
    partial: matchedLeafCount > 0 && matchedLeafCount < node.leafTopicIds.length,
  };
}

export function buildSelectedTopicSummaries(nodes: TopicTreeNodeWithCounts[], selectedLeafIds: Set<string>) {
  const summaries: SelectedTopicSummary[] = [];
  const walk = (node: TopicTreeNodeWithCounts) => {
    const selection = getSelectionState(node, selectedLeafIds);
    if (!node.children?.length) {
      if (selection.checked) summaries.push({ id: node.id, label: node.label, leafTopicIds: node.leafTopicIds });
      return;
    }
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return summaries;
}

function topicDomId(id: string) {
  return `topic-children-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function TopicNode({
  node,
  depth,
  expandedIds,
  selectedLeafIds,
  onToggleExpanded,
  onToggleSelected,
}: {
  node: TopicTreeNodeWithCounts;
  depth: number;
  expandedIds: Set<string>;
  selectedLeafIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  onToggleSelected: (node: TopicTreeNodeWithCounts) => void;
}) {
  const hasChildren = Boolean(node.children?.length);
  const isExpanded = expandedIds.has(node.id);
  const selection = getSelectionState(node, selectedLeafIds);
  const childrenId = topicDomId(node.id);
  const checkboxRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = selection.partial;
  }, [selection.partial]);

  return (
    <div className="topic-node">
      <div className={`relative flex min-h-10 items-center border-b border-text/[0.07] py-1 pl-16 pr-3 transition-colors hover:bg-bg-soft ${selection.checked || selection.partial ? "bg-accent-soft/55" : ""}`}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleExpanded(node.id)}
            className="btn-press absolute left-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-text-muted hover:text-accent"
            aria-label={isExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
            aria-expanded={isExpanded}
            aria-controls={childrenId}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" strokeWidth={1.8} /> : <ChevronRight className="h-4 w-4" strokeWidth={1.8} />}
          </button>
        ) : null}

        <label className="flex min-w-0 flex-1 cursor-pointer items-center py-1 text-left">
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={selection.checked}
            onChange={() => onToggleSelected(node)}
            className="ui-checkbox topic-checkbox h-[18px] w-[18px]"
            aria-label={`${selection.checked ? "Deselect" : "Select"} ${node.label}, ${node.questionUnitCount} question${node.questionUnitCount === 1 ? "" : "s"}`}
          />
          <span className="flex min-w-0 flex-1 items-center">
            {depth > 0 ? <span className="shrink-0" style={{ width: `${depth * 8}px` }} aria-hidden="true" /> : null}
            <span data-topic-label className="min-w-0 text-[0.8rem] font-medium leading-5 text-text">{node.label}</span>
          </span>
          <span className="ml-3 shrink-0 font-mono text-[0.61rem] tabular-nums text-text-muted">
            {node.questionUnitCount} question{node.questionUnitCount === 1 ? "" : "s"}
          </span>
        </label>
      </div>

      <AnimatePresence initial={false}>
        {hasChildren && isExpanded ? (
          <motion.div
            id={childrenId}
            aria-label={`${node.label} subtopics`}
            initial={reduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={motionTokens.control}
          >
            {node.children?.map((child) => (
              <TopicNode
                key={child.id}
                node={child}
                depth={depth + 1}
                expandedIds={expandedIds}
                selectedLeafIds={selectedLeafIds}
                onToggleExpanded={onToggleExpanded}
                onToggleSelected={onToggleSelected}
              />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
