"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import gsap from "gsap";
import {
  Globe,
  Briefcase,
  BookOpen,
  Cpu,
  Building2,
  FlaskConical,
  Calculator,
  Search,
  X,
  Minus,
  Check,
  Clock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import type { TopicTreeNodeWithCounts } from "@/lib/paper-maker/aqa-geography";
import type { SubjectTierKey } from "@/lib/paper-maker/combined-science";
import {
  estimatePaperTimeMinutes,
  estimateTargetMarksFromTimeMinutes,
  type PaperBuildTargetMode,
  type PaperMakerSubjectKey,
} from "@/lib/paper-maker/subjects";

type PaperMakerWorkspaceProps = {
  subjectOptions: {
    key: PaperMakerSubjectKey;
    label: string;
    boardLabel: string;
    description: string;
    taggedQuestionUnits: number;
    topicSelectionEnabled: boolean;
    generationEnabled: boolean;
    availabilityNote: string;
    recommendedMinutesPerMark: number;
    benchmarkMinutesPerMark: number | null;
    paperOptions: { code: string; label: string }[];
    defaultPaperCodes: string[];
    topics: TopicTreeNodeWithCounts[];
    topicsByTier?: Partial<Record<SubjectTierKey, TopicTreeNodeWithCounts[]>>;
    tiers: { key: SubjectTierKey; label: string; taggedQuestionUnits: number }[];
  }[];
};

type SelectedTopicSummary = {
  id: string;
  label: string;
  leafTopicIds: string[];
};

type WorkspaceSubjectOption = PaperMakerWorkspaceProps["subjectOptions"][number];

const SUBJECT_ICONS: Record<string, React.ElementType> = {
  "aqa-geography": Globe,
  "aqa-business": Briefcase,
  "aqa-english-language": BookOpen,
  "aqa-english-literature": BookOpen,
  "edexcel-business": Building2,
  "edexcel-combined-science": FlaskConical,
  "edexcel-mathematics-higher": Calculator,
  "ocr-computer-science": Cpu,
};

const MIN_MARKS = 10;
const MAX_MARKS = 120;
const MIN_TIME_MINUTES = 15;
const MAX_TIME_MINUTES = 300;

function clampMarks(value: number) {
  return Math.max(MIN_MARKS, Math.min(MAX_MARKS, Math.round(value)));
}

function clampTimeMinutes(value: number) {
  return Math.max(MIN_TIME_MINUTES, Math.min(MAX_TIME_MINUTES, Math.round(value / 5) * 5 || MIN_TIME_MINUTES));
}

function resolveMinutesPerMark(benchmarkMinutesPerMark: number | null | undefined, recommendedMinutesPerMark: number | undefined) {
  const fallback = recommendedMinutesPerMark && Number.isFinite(recommendedMinutesPerMark) && recommendedMinutesPerMark > 0
    ? recommendedMinutesPerMark
    : 1;
  if (!benchmarkMinutesPerMark || !Number.isFinite(benchmarkMinutesPerMark)) return fallback;
  if (benchmarkMinutesPerMark < 0.5 || benchmarkMinutesPerMark > 3) return fallback;
  return benchmarkMinutesPerMark;
}

function resolveSubjectTopics(subject: WorkspaceSubjectOption | undefined, tierKey: SubjectTierKey) {
  if (!subject) return [];
  if (subject.tiers.length > 0) {
    return subject.topicsByTier?.[tierKey] ?? [];
  }
  return subject.topics;
}

function flattenLeafIds(nodes: TopicTreeNodeWithCounts[]) {
  return Array.from(new Set(nodes.flatMap((node) => node.leafTopicIds)));
}

function getSelectionState(node: TopicTreeNodeWithCounts, selectedLeafIds: Set<string>) {
  const matchedLeafCount = node.leafTopicIds.filter((leafId) => selectedLeafIds.has(leafId)).length;
  return {
    checked: matchedLeafCount > 0 && matchedLeafCount === node.leafTopicIds.length,
    partial: matchedLeafCount > 0 && matchedLeafCount < node.leafTopicIds.length,
  };
}

function buildSelectedTopicSummaries(nodes: TopicTreeNodeWithCounts[], selectedLeafIds: Set<string>): SelectedTopicSummary[] {
  const summaries: SelectedTopicSummary[] = [];
  const walk = (node: TopicTreeNodeWithCounts) => {
    const selection = getSelectionState(node, selectedLeafIds);
    if (!node.children?.length) {
      if (selection.checked) {
        summaries.push({ id: node.id, label: node.label, leafTopicIds: node.leafTopicIds });
      }
      return;
    }
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return summaries;
}

function Stepper({ step, onChange }: { step: number; onChange: (step: number) => void }) {
  const steps = [
    { number: 1, label: "Subject" },
    { number: 2, label: "Topics" },
    { number: 3, label: "Build" },
  ];

  return (
    <div className="flex items-center justify-center" aria-label="Paper maker steps">
      {steps.map((item, index) => {
        const isActive = step === item.number;
        const isComplete = step > item.number;
        const isFuture = step < item.number;

        return (
          <div key={item.number} className="flex items-center">
            <button
              type="button"
              onClick={() => {
                if (!isFuture) onChange(item.number);
              }}
              disabled={isFuture}
              className={`btn-press flex items-center gap-2.5 rounded-full px-4 py-2.5 text-[0.82rem] transition-all ${
                isActive
                  ? "bg-[#1a2e1a] text-white shadow-[0_4px_14px_rgba(26,46,26,0.18)]"
                  : isComplete
                    ? "border border-[#1a2e1a]/10 bg-white text-[#1a2e1a] hover:bg-[#f8f7f4]"
                    : "border border-[#1a2e1a]/8 bg-transparent text-[#1a2e1a]/35 cursor-not-allowed"
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[0.72rem] font-semibold ${
                  isActive ? "bg-white/15" : isComplete ? "bg-accent-warm/15 text-accent-warm" : "bg-[#1a2e1a]/[0.05]"
                }`}
              >
                {isComplete ? <Check className="h-3 w-3" strokeWidth={2.5} /> : item.number}
              </span>
              <span className="font-medium">{item.label}</span>
            </button>
            {index < steps.length - 1 && (
              <div className="mx-1.5 h-px w-8 bg-[#1a2e1a]/10" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TopicNode({
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

  return (
    <div className="topic-node">
      <div
        className={`flex items-center gap-2.5 rounded-xl border bg-white px-3.5 py-2.5 transition-all card-lift ${
          selection.checked || selection.partial
            ? "border-accent/25 shadow-[0_4px_16px_rgba(90,138,92,0.08)]"
            : "border-[#1a2e1a]/[0.05]"
        }`}
        style={{ marginLeft: depth > 0 ? `${depth * 16}px` : undefined }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleExpanded(node.id)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#1a2e1a]/10 bg-[#f8f7f4] text-[#1a2e1a]/55 transition-colors hover:bg-[#f1eee6]"
            aria-label={isExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
          >
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <div className="h-7 w-7 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onToggleSelected(node)}
          role="checkbox"
          aria-checked={selection.partial ? "mixed" : selection.checked}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <span
            className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border-[1.5px] transition-all ${
              selection.checked
                ? "border-accent bg-accent text-white"
                : selection.partial
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-[#1a2e1a]/15 bg-white text-transparent"
            }`}
            aria-hidden="true"
          >
            {selection.partial ? <Minus className="h-3 w-3" strokeWidth={2.5} /> : selection.checked ? <Check className="h-3 w-3" strokeWidth={2.5} /> : null}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className={`truncate font-medium text-[#1a2e1a] ${depth === 0 ? "text-[0.94rem]" : "text-[0.88rem]"}`}>
                {node.label}
              </p>
              <span className="shrink-0 rounded-full bg-[#f8f7f4] px-2 py-0.5 text-[0.68rem] tabular-nums text-[#1a2e1a]/50">
                {node.questionUnitCount}
              </span>
            </div>
          </div>
        </button>
      </div>

      {hasChildren && isExpanded ? (
        <div className="mt-1.5 space-y-1.5">
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
        </div>
      ) : null}
    </div>
  );
}

function SuccessModal({
  result,
  subjectLabel,
  tierLabel,
  minutesPerMark,
  onClose,
  onBuildAnother,
}: {
  result: { paperCount: number; questionCount: number; totalMarks: number; coveredTopics: number; timeMinutes: number };
  subjectLabel: string;
  tierLabel?: string;
  minutesPerMark: number;
  onClose: () => void;
  onBuildAnother: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modalRef.current) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      gsap.from(modalRef.current, {
        scale: 0.92,
        opacity: 0,
        duration: 0.45,
        ease: "back.out(1.7)",
        clearProps: "transform,opacity",
      });
      gsap.from(".stat-number", {
        textContent: 0,
        duration: 0.8,
        delay: 0.3,
        ease: "power2.out",
        snap: { textContent: 1 },
      });
    }, modalRef);
    return () => ctx.revert();
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1a2e1a]/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-[1.8rem] bg-white p-8 text-center shadow-[0_24px_60px_rgba(26,46,26,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Check className="h-7 w-7" strokeWidth={2.5} />
        </div>
        <h3 className="mt-5 font-serif text-[1.5rem] text-[#1a2e1a]">Paper ready</h3>
        <p className="mt-2 text-[0.88rem] text-[#3d5a3f]/60">
          Your custom {result.paperCount === 1 ? "paper has" : `${result.paperCount} papers have`} been generated and downloaded.
        </p>

        <div className="mt-5 rounded-[1.3rem] border border-[#1a2e1a]/[0.06] bg-[#faf8f3] p-5 text-left">
          <p className="text-[0.68rem] uppercase tracking-[0.18em] text-accent-warm">
            {subjectLabel}
            {tierLabel ? ` · ${tierLabel}` : ""}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="stat-number font-serif tabular-nums text-[1.35rem] text-[#1a2e1a]">{result.paperCount}</p>
              <p className="text-[0.68rem] text-[#3d5a3f]/50">paper{result.paperCount === 1 ? "" : "s"}</p>
            </div>
            <div>
              <p className="stat-number font-serif tabular-nums text-[1.35rem] text-[#1a2e1a]">{result.totalMarks}</p>
              <p className="text-[0.68rem] text-[#3d5a3f]/50">marks</p>
            </div>
            <div>
              <p className="stat-number font-serif tabular-nums text-[1.35rem] text-[#1a2e1a]">{result.timeMinutes}</p>
              <p className="text-[0.68rem] text-[#3d5a3f]/50">minutes</p>
            </div>
          </div>
          <p className="mt-3 text-center text-[0.68rem] text-[#3d5a3f]/50">
            Using ~{minutesPerMark.toFixed(2)} min per mark
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-press w-full rounded-full bg-[#1a2e1a] px-5 py-3 text-[0.9rem] font-semibold text-white transition-colors hover:bg-[#2a4a2a]"
          >
            Back to builder
          </button>
          <button
            type="button"
            onClick={onBuildAnother}
            className="btn-press w-full rounded-full border border-[#1a2e1a]/10 bg-white px-5 py-3 text-[0.9rem] font-medium text-[#1a2e1a] transition-colors hover:bg-[#f8f7f4]"
          >
            Build another paper
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileCommandBar({ summary, canGenerate, onGenerate, isPending }: {
  summary: string;
  canGenerate: boolean;
  onGenerate: () => void;
  isPending: boolean;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#1a2e1a]/[0.06] bg-white/95 px-5 py-3 backdrop-blur-xl lg:hidden">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <p className="truncate text-[0.78rem] text-[#3d5a3f]/60">{summary}</p>
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate || isPending}
          className="btn-press shrink-0 rounded-full bg-[#1a2e1a] px-5 py-2.5 text-[0.82rem] font-semibold text-white transition-colors hover:bg-[#2a4a2a] disabled:opacity-40"
        >
          {isPending ? "Building..." : "Generate"}
        </button>
      </div>
    </div>
  );
}

export function PaperMakerWorkspace({ subjectOptions }: PaperMakerWorkspaceProps) {
  const defaultSubject = subjectOptions[0];
  const defaultMinutesPerMark = resolveMinutesPerMark(defaultSubject?.benchmarkMinutesPerMark, defaultSubject?.recommendedMinutesPerMark);
  const [step, setStep] = useState(1);
  const [selectedSubjectKey, setSelectedSubjectKey] = useState<PaperMakerSubjectKey>(defaultSubject?.key ?? "aqa-geography");
  const [selectedLeafIds, setSelectedLeafIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(defaultSubject?.topics.map((topic) => topic.id) ?? []));
  const [targetMarks, setTargetMarks] = useState(40);
  const [timeMinutes, setTimeMinutes] = useState(() => clampTimeMinutes(estimatePaperTimeMinutes(defaultMinutesPerMark, 40)));
  const [targetMode, setTargetMode] = useState<PaperBuildTargetMode>("marks");
  const [selectedPaperCodes, setSelectedPaperCodes] = useState<Set<string>>(new Set(defaultSubject?.defaultPaperCodes ?? []));
  const [selectedTier, setSelectedTier] = useState<SubjectTierKey>("foundation");
  const [error, setError] = useState<string | null>(null);
  const [paperCount, setPaperCount] = useState(1);
  const [result, setResult] = useState<{ paperCount: number; questionCount: number; totalMarks: number; coveredTopics: number; timeMinutes: number } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [topicSearch, setTopicSearch] = useState("");
  const activeStepRef = useRef<HTMLDivElement | null>(null);

  const activeSubject = useMemo(
    () => subjectOptions.find((subject) => subject.key === selectedSubjectKey) ?? subjectOptions[0],
    [selectedSubjectKey, subjectOptions],
  );
  const activeTopics = useMemo(() => resolveSubjectTopics(activeSubject, selectedTier), [activeSubject, selectedTier]);
  const totalLeafIds = useMemo(() => flattenLeafIds(activeTopics), [activeTopics]);
  const generationEnabled = activeSubject?.generationEnabled ?? false;
  const topicSelectionEnabled = activeSubject?.topicSelectionEnabled ?? false;
  const activeTier = activeSubject?.tiers.find((tier) => tier.key === selectedTier) ?? activeSubject?.tiers[0];
  const activePaperOptions = activeSubject?.paperOptions ?? [];
  const activeMinutesPerMark = resolveMinutesPerMark(activeSubject?.benchmarkMinutesPerMark, activeSubject?.recommendedMinutesPerMark);
  const selectedTopicSummaries = useMemo(
    () => buildSelectedTopicSummaries(activeTopics, selectedLeafIds),
    [activeTopics, selectedLeafIds],
  );
  const selectedTopicNodeIds = useMemo(
    () => selectedTopicSummaries.map((summary) => summary.id),
    [selectedTopicSummaries],
  );
  const selectedTopicPreview = useMemo(() => selectedTopicSummaries.slice(0, 4), [selectedTopicSummaries]);
  const selectedTopicOverflowCount = Math.max(0, selectedTopicSummaries.length - selectedTopicPreview.length);

  const canGenerate = generationEnabled && selectedPaperCodes.size > 0 && (!topicSelectionEnabled || selectedTopicNodeIds.length > 0);

  const filteredTopics = useMemo(() => {
    if (!topicSearch.trim()) return activeTopics;
    const searchLower = topicSearch.toLowerCase();
    const filterNodes = (nodes: TopicTreeNodeWithCounts[]): TopicTreeNodeWithCounts[] => {
      return nodes.reduce<TopicTreeNodeWithCounts[]>((acc, node) => {
        const matchesSelf = node.label.toLowerCase().includes(searchLower);
        const filteredChildren = node.children?.length ? filterNodes(node.children) : [];
        if (matchesSelf || filteredChildren.length > 0) {
          acc.push({ ...node, children: filteredChildren.length > 0 ? filteredChildren : node.children });
        }
        return acc;
      }, []);
    };
    return filterNodes(activeTopics);
  }, [activeTopics, topicSearch]);

  const summaryText = useMemo(() => {
    const parts = [activeSubject?.label ?? ""];
    if (activeTier) parts.push(activeTier.label);
    if (topicSelectionEnabled) parts.push(`${selectedTopicSummaries.length} topic${selectedTopicSummaries.length === 1 ? "" : "s"}`);
    parts.push(`${selectedPaperCodes.size} paper${selectedPaperCodes.size === 1 ? "" : "s"}`);
    parts.push(`${targetMarks} marks`);
    return parts.join(" · ");
  }, [activeSubject, activeTier, topicSelectionEnabled, selectedTopicSummaries.length, selectedPaperCodes.size, targetMarks]);

  const groupedSubjectOptions = useMemo(() => {
    const boardOrder = ["AQA", "Edexcel", "OCR"];
    const buckets = new Map<string, WorkspaceSubjectOption[]>();
    for (const subject of subjectOptions) {
      const group = buckets.get(subject.boardLabel) ?? [];
      group.push(subject);
      buckets.set(subject.boardLabel, group);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => boardOrder.indexOf(a[0]) - boardOrder.indexOf(b[0]))
      .map(([boardLabel, subjects]) => ({ boardLabel, subjects }));
  }, [subjectOptions]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelected = useCallback((node: TopicTreeNodeWithCounts) => {
    setSelectedLeafIds((current) => {
      const next = new Set(current);
      const selection = getSelectionState(node, current);
      if (selection.checked) {
        for (const leafId of node.leafTopicIds) next.delete(leafId);
      } else {
        for (const leafId of node.leafTopicIds) next.add(leafId);
      }
      return next;
    });
  }, []);

  const togglePaperCode = useCallback((code: string) => {
    setSelectedPaperCodes((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const updateFromMarks = useCallback((nextMarks: number) => {
    const safeMarks = clampMarks(nextMarks);
    setTargetMode("marks");
    setTargetMarks(safeMarks);
    setTimeMinutes(clampTimeMinutes(estimatePaperTimeMinutes(activeMinutesPerMark, safeMarks)));
  }, [activeMinutesPerMark]);

  const updateFromTime = useCallback((nextTimeMinutes: number) => {
    const safeTimeMinutes = clampTimeMinutes(nextTimeMinutes);
    setTargetMode("time");
    setTimeMinutes(safeTimeMinutes);
    setTargetMarks(clampMarks(estimateTargetMarksFromTimeMinutes(safeTimeMinutes, activeMinutesPerMark, activeMinutesPerMark)));
  }, [activeMinutesPerMark]);

  const handleSubjectChange = useCallback((key: PaperMakerSubjectKey) => {
    const subject = subjectOptions.find((entry) => entry.key === key);
    const nextTier = subject?.tiers[0]?.key ?? "foundation";
    const nextTopics = resolveSubjectTopics(subject, nextTier);
    setSelectedSubjectKey(key);
    setSelectedTier(nextTier);
    setSelectedPaperCodes(new Set(subject?.defaultPaperCodes ?? []));
    setSelectedLeafIds(new Set());
    setExpandedIds(new Set(nextTopics.map((topic) => topic.id)));
    setTopicSearch("");
    if (targetMode === "time") {
      const nextMinutesPerMark = resolveMinutesPerMark(subject?.benchmarkMinutesPerMark, subject?.recommendedMinutesPerMark);
      setTargetMarks(clampMarks(estimateTargetMarksFromTimeMinutes(timeMinutes, nextMinutesPerMark, nextMinutesPerMark)));
    } else {
      setTargetMode("marks");
      setTimeMinutes(clampTimeMinutes(estimatePaperTimeMinutes(
        resolveMinutesPerMark(subject?.benchmarkMinutesPerMark, subject?.recommendedMinutesPerMark),
        targetMarks,
      )));
    }
    setError(null);
    setResult(null);
    setStep(1);
  }, [subjectOptions, targetMode, targetMarks, timeMinutes]);

  const handleTierChange = useCallback((tierKey: SubjectTierKey) => {
    const nextTopics = resolveSubjectTopics(activeSubject, tierKey);
    const availableLeafIds = new Set(flattenLeafIds(nextTopics));
    setSelectedTier(tierKey);
    setSelectedLeafIds((current) => new Set(Array.from(current).filter((leafId) => availableLeafIds.has(leafId))));
    setExpandedIds(new Set(nextTopics.map((topic) => topic.id)));
    setTopicSearch("");
    setError(null);
    setResult(null);
  }, [activeSubject]);

  const handleGenerate = useCallback(() => {
    setError(null);
    setResult(null);

    startTransition(async () => {
      try {
        const excludedSourceQuestionKeys = new Set<string>();
        const priorSelectedUnitMarks: number[] = [];
        let lastQuestionCount = 0;
        let lastTotalMarks = 0;
        let lastCoveredTopics = 0;
        let lastTimeMinutes = timeMinutes;

        for (let paperIndex = 0; paperIndex < paperCount; paperIndex += 1) {
          const response = await fetch("/api/paper-maker/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subjectKey: selectedSubjectKey,
              subjectTier: activeSubject?.tiers.length ? selectedTier : undefined,
              selectedTopicNodeIds,
              targetMarks,
              timeMinutes,
              targetMode,
              paperCodes: Array.from(selectedPaperCodes),
              excludeSourceQuestionKeys: Array.from(excludedSourceQuestionKeys),
              remainingPaperCount: paperCount - paperIndex,
              priorSelectedUnitMarks,
              priorPaperCount: paperIndex,
            }),
          });

          if (!response.ok) {
            const message = await response.text();
            throw new Error(message || "Failed to generate paper.");
          }

          const blob = await response.blob();
          lastQuestionCount = Number(response.headers.get("X-Question-Count") ?? 0);
          lastTotalMarks = Number(response.headers.get("X-Total-Marks") ?? 0);
          lastCoveredTopics = Number(response.headers.get("X-Covered-Topics") ?? 0);
          lastTimeMinutes = Number(response.headers.get("X-Time-Minutes") ?? timeMinutes);
          const encodedKeys = response.headers.get("X-Selected-Source-Question-Keys");
          if (encodedKeys) {
            for (const key of decodeURIComponent(encodedKeys).split("\n").filter(Boolean)) {
              excludedSourceQuestionKeys.add(key);
            }
          }
          const encodedMarks = response.headers.get("X-Selected-Unit-Marks");
          if (encodedMarks) {
            for (const value of decodeURIComponent(encodedMarks).split("\n").filter(Boolean)) {
              const parsed = Number(value);
              if (Number.isFinite(parsed)) {
                priorSelectedUnitMarks.push(parsed);
              }
            }
          }

          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = `${selectedSubjectKey}-custom-paper-${targetMarks}m-${paperIndex + 1}.pdf`;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(url);
        }

        setResult({
          paperCount,
          questionCount: lastQuestionCount,
          totalMarks: lastTotalMarks,
          coveredTopics: lastCoveredTopics,
          timeMinutes: lastTimeMinutes,
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  }, [selectedSubjectKey, activeSubject, selectedTier, selectedTopicNodeIds, targetMarks, timeMinutes, targetMode, selectedPaperCodes, paperCount]);

  useEffect(() => {
    activeStepRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  return (
    <div className="relative pb-24 lg:pb-0">
      <div className="-mx-5 border-b border-[#1a2e1a]/[0.06] bg-[#f4f2ec] px-5 py-4 sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12">
        <Stepper step={step} onChange={setStep} />
      </div>

      <div ref={activeStepRef} className="mt-8">
        {step === 1 ? (
          <section className="space-y-6">
            <div className="max-w-2xl">
              <p className="text-[0.68rem] uppercase tracking-[0.24em] text-accent-warm">Step 01</p>
              <h2 className="mt-2 font-serif text-[1.7rem] text-[#1a2e1a]">Choose a paper to build</h2>
              <p className="mt-2 text-[0.95rem] text-[#3d5a3f]/65">Pick the subject first. Everything else stays hidden until you need it.</p>
            </div>

            <div className="space-y-5">
              {groupedSubjectOptions.map((group) => (
                <section key={group.boardLabel} className="space-y-3">
                  <p className="text-[0.68rem] uppercase tracking-[0.22em] text-accent-warm">{group.boardLabel}</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {group.subjects.map((subject) => {
                      const isActive = subject.key === selectedSubjectKey;
                      const Icon = SUBJECT_ICONS[subject.key];

                      return (
                        <button
                          key={subject.key}
                          type="button"
                          onClick={() => handleSubjectChange(subject.key)}
                          className={`card-lift rounded-[1.4rem] border p-6 text-left transition-all ${
                            isActive
                              ? "border-accent/30 bg-white shadow-[0_6px_24px_rgba(90,138,92,0.12)]"
                              : "border-[#1a2e1a]/[0.06] bg-white/70 hover:bg-white hover:shadow-[0_4px_16px_rgba(26,46,26,0.06)]"
                          }`}
                        >
                          <div className="flex items-start gap-4">
                            {Icon ? (
                              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
                                isActive ? "bg-accent/10 text-accent" : "bg-[#f4f2ec] text-[#6b8a6d]"
                              }`}>
                                <Icon className="h-5 w-5" strokeWidth={1.5} />
                              </div>
                            ) : null}
                            <div className="min-w-0 flex-1">
                              <h3 className="mt-1 font-serif text-[1.3rem] tracking-[-0.02em] text-[#1a2e1a]">{subject.label}</h3>
                            </div>
                          </div>
                          <p className="mt-3 text-[0.88rem] leading-6 text-[#3d5a3f]/60">{subject.description}</p>
                          <p className="mt-2 text-[0.75rem] tabular-nums text-[#3d5a3f]/45">
                            {subject.taggedQuestionUnits} tagged question unit{subject.taggedQuestionUnits === 1 ? "" : "s"}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <div className="flex justify-end">
              <button type="button" onClick={() => setStep(2)} className="btn-press rounded-full bg-[#1a2e1a] px-5 py-3 text-[0.88rem] font-semibold text-white transition-colors hover:bg-[#2a4a2a]">
                Continue to {topicSelectionEnabled ? "topics" : "paper options"}
              </button>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <p className="text-[0.68rem] uppercase tracking-[0.24em] text-accent-warm">Step 02</p>
                <h2 className="mt-2 font-serif text-[1.7rem] text-[#1a2e1a]">Choose what to pull from</h2>
                <p className="mt-2 text-[0.95rem] text-[#3d5a3f]/65">
                  {activeSubject?.key === "edexcel-combined-science"
                    ? "Pick the tier first, then choose the Biology, Chemistry, or Physics areas you want."
                    : "Select whole topic areas. The builder will use real past-paper questions from those areas only."}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep(1)} className="btn-press rounded-full border border-[#1a2e1a]/10 px-4 py-2.5 text-[0.82rem] font-medium text-[#1a2e1a] transition-colors hover:bg-white">
                  Back
                </button>
                <button type="button" onClick={() => setStep(3)} className="btn-press rounded-full bg-[#1a2e1a] px-5 py-2.5 text-[0.82rem] font-semibold text-white transition-colors hover:bg-[#2a4a2a]">
                  Continue
                </button>
              </div>
            </div>

            {topicSelectionEnabled ? (
              <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)] xl:items-start">
                <aside className="rounded-[1.4rem] border border-[#1a2e1a]/[0.06] bg-white p-5 xl:sticky xl:top-[100px]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[0.68rem] uppercase tracking-[0.16em] text-accent-warm">Your paper</p>
                      <p className="mt-1 font-serif text-[1.1rem] text-[#1a2e1a]">{activeSubject?.label}{activeTier ? ` · ${activeTier.label}` : ""}</p>
                    </div>
                    {selectedTopicSummaries.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setSelectedLeafIds(new Set())}
                        className="btn-press rounded-full border border-[#1a2e1a]/10 px-3 py-1 text-[0.72rem] font-medium text-[#1a2e1a]/60 transition-colors hover:bg-[#f8f7f4]"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="font-serif text-[2.2rem] leading-none text-[#1a2e1a]">{selectedTopicSummaries.length}</span>
                    <span className="text-[0.82rem] text-[#3d5a3f]/55">topic{selectedTopicSummaries.length === 1 ? "" : "s"} selected</span>
                  </div>

                  <p className="mt-2 text-[0.78rem] leading-6 text-[#3d5a3f]/50">
                    {selectedTopicSummaries.length === 0
                      ? `Choose one or more areas from ${totalLeafIds.length} available tagged topic strands.`
                      : "Your final paper will only draw from the areas listed below."}
                  </p>

                  {selectedTopicSummaries.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {selectedTopicSummaries.map((topic) => (
                        <span key={topic.id} className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/[0.06] px-2.5 py-1 text-[0.72rem] text-[#1a2e1a]">
                          {topic.label}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedLeafIds((current) => {
                                const next = new Set(current);
                                for (const leafId of topic.leafTopicIds) next.delete(leafId);
                                return next;
                              });
                            }}
                            className="text-[#1a2e1a]/40 transition-colors hover:text-[#1a2e1a]"
                            aria-label={`Remove ${topic.label}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </aside>

                <div className="space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#3d5a3f]/40" />
                    <input
                      type="text"
                      value={topicSearch}
                      onChange={(e) => setTopicSearch(e.target.value)}
                      placeholder="Search topics..."
                      className="w-full rounded-xl border border-[#1a2e1a]/[0.06] bg-white py-2.5 pl-10 pr-4 text-[0.88rem] text-[#1a2e1a] placeholder:text-[#3d5a3f]/35 outline-none transition-shadow focus:shadow-[0_0_0_2px_rgba(90,138,92,0.2)] focus:border-accent/30"
                    />
                    {topicSearch && (
                      <button
                        type="button"
                        onClick={() => setTopicSearch("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#3d5a3f]/40 hover:text-[#1a2e1a]"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {activeSubject?.tiers.length ? (
                    <div className="rounded-[1.4rem] border border-[#1a2e1a]/[0.06] bg-white p-4">
                      <p className="text-[0.7rem] uppercase tracking-[0.14em] text-accent-warm">Tier</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {activeSubject.tiers.map((tier) => {
                          const isActive = tier.key === selectedTier;
                          return (
                            <button
                              key={tier.key}
                              type="button"
                              onClick={() => handleTierChange(tier.key)}
                              className={`card-lift rounded-[1.1rem] border px-4 py-3.5 text-left transition-all ${
                                isActive
                                  ? "border-accent/30 bg-[#f8f7f4] shadow-[0_2px_12px_rgba(90,138,92,0.08)]"
                                  : "border-[#1a2e1a]/[0.06] bg-white hover:bg-[#faf9f6]"
                              }`}
                            >
                              <p className="text-[0.7rem] uppercase tracking-[0.14em] text-accent-warm">{tier.label}</p>
                              <p className="mt-1 font-serif text-[1.35rem] text-[#1a2e1a]">{tier.taggedQuestionUnits}</p>
                              <p className="text-[0.78rem] text-[#3d5a3f]/50">tagged question units</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {filteredTopics.map((topic) => (
                    <TopicNode
                      key={topic.id}
                      node={topic}
                      depth={0}
                      expandedIds={expandedIds}
                      selectedLeafIds={selectedLeafIds}
                      onToggleExpanded={toggleExpanded}
                      onToggleSelected={toggleSelected}
                    />
                  ))}

                  {filteredTopics.length === 0 ? (
                    <div className="rounded-[1.4rem] border border-dashed border-[#1a2e1a]/10 bg-white/70 px-5 py-8 text-center">
                      <Search className="mx-auto h-6 w-6 text-[#3d5a3f]/30" />
                      <p className="mt-2 text-[0.88rem] text-[#3d5a3f]/60">
                        {topicSearch ? "No topics match your search. Try a broader term." : "No tagged topics are available for this selection yet."}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="rounded-[1.4rem] border border-[#1a2e1a]/[0.06] bg-white p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  {activeSubject?.tiers.map((tier) => {
                    const isActive = tier.key === selectedTier;
                    return (
                      <button
                        key={tier.key}
                        type="button"
                        onClick={() => handleTierChange(tier.key)}
                        className={`card-lift rounded-[1.1rem] border px-4 py-3.5 text-left transition-all ${
                          isActive
                            ? "border-accent/30 bg-[#f8f7f4] shadow-[0_2px_12px_rgba(90,138,92,0.08)]"
                            : "border-[#1a2e1a]/[0.06] bg-white hover:bg-[#faf9f6]"
                        }`}
                      >
                        <p className="text-[0.7rem] uppercase tracking-[0.14em] text-accent-warm">{tier.label}</p>
                        <p className="mt-1 font-serif text-[1.35rem] text-[#1a2e1a]">{tier.taggedQuestionUnits}</p>
                        <p className="text-[0.78rem] text-[#3d5a3f]/50">tagged question units</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        ) : null}

        {step === 3 ? (
          <section className="mx-auto max-w-4xl space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <p className="text-[0.68rem] uppercase tracking-[0.24em] text-accent-warm">Step 03</p>
                <h2 className="mt-2 font-serif text-[1.7rem] text-[#1a2e1a]">Review and generate</h2>
                <p className="mt-2 text-[0.95rem] text-[#3d5a3f]/65">Set the paper length, choose which source papers to include, then generate the PDF.</p>
              </div>
              <button type="button" onClick={() => setStep(2)} className="btn-press rounded-full border border-[#1a2e1a]/10 px-4 py-2.5 text-[0.82rem] font-medium text-[#1a2e1a] transition-colors hover:bg-white">
                Back
              </button>
            </div>

            <div className="rounded-[1.3rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-sm">
              <div className="mb-4">
                <p className="text-[0.82rem] font-semibold text-[#1a2e1a]">Paper length</p>
                <p className="text-[0.72rem] text-[#3d5a3f]/45">Marks and time stay in sync. Adjust either one.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className={`rounded-xl border p-4 transition-all ${targetMode === "marks" ? "border-accent/30 bg-[#faf8f3]" : "border-[#1a2e1a]/10 bg-[#f8f7f4]"}`}>
                  <label htmlFor="paper-target-marks" className="text-[0.72rem] uppercase tracking-[0.1em] text-accent-warm">Marks</label>
                  <div className="mt-2 flex items-end gap-2">
                    <input
                      id="paper-target-marks"
                      type="number"
                      min={MIN_MARKS}
                      max={MAX_MARKS}
                      step={5}
                      value={targetMarks}
                      onChange={(event) => updateFromMarks(Number(event.target.value) || MIN_MARKS)}
                      disabled={!generationEnabled}
                      className="h-12 w-24 rounded-lg border border-[#1a2e1a]/10 bg-white px-3 text-center font-serif text-[1.35rem] text-[#1a2e1a] outline-none focus:border-accent/30 focus:shadow-[0_0_0_2px_rgba(90,138,92,0.2)]"
                    />
                    <span className="pb-1 text-[0.78rem] text-[#3d5a3f]/50">marks</span>
                  </div>
                </div>

                <div className={`rounded-xl border p-4 transition-all ${targetMode === "time" ? "border-accent/30 bg-[#faf8f3]" : "border-[#1a2e1a]/10 bg-[#f8f7f4]"}`}>
                  <label htmlFor="paper-time-minutes" className="text-[0.72rem] uppercase tracking-[0.1em] text-accent-warm">Time</label>
                  <div className="mt-2 flex items-end gap-2">
                    <input
                      id="paper-time-minutes"
                      type="number"
                      min={MIN_TIME_MINUTES}
                      max={MAX_TIME_MINUTES}
                      step={5}
                      value={timeMinutes}
                      onChange={(event) => updateFromTime(Number(event.target.value) || MIN_TIME_MINUTES)}
                      disabled={!generationEnabled}
                      className="h-12 w-24 rounded-lg border border-[#1a2e1a]/10 bg-white px-3 text-center font-serif text-[1.35rem] text-[#1a2e1a] outline-none focus:border-accent/30 focus:shadow-[0_0_0_2px_rgba(90,138,92,0.2)]"
                    />
                    <span className="pb-1 text-[0.78rem] text-[#3d5a3f]/50">minutes</span>
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-[#1a2e1a]/10 bg-[#f8f7f4] p-4">
                <input
                  type="range"
                  min={MIN_MARKS}
                  max={MAX_MARKS}
                  step={5}
                  value={targetMarks}
                  onChange={(event) => updateFromMarks(Number(event.target.value))}
                  disabled={!generationEnabled}
                  className="w-full accent-accent"
                />
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {[30, 45, 60, 75, 90].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => updateFromTime(preset)}
                      disabled={!generationEnabled}
                      className={`btn-press rounded-full border px-2.5 py-1 text-[0.74rem] transition-all ${
                        timeMinutes === preset && targetMode === "time"
                          ? "border-[#1a2e1a] bg-[#1a2e1a] text-white"
                          : "border-[#1a2e1a]/10 bg-white text-[#1a2e1a] hover:bg-[#f1eee6]"
                      }`}
                    >
                      {preset}m
                    </button>
                  ))}
                </div>
              </div>

              <p className="mt-3 flex items-center gap-1.5 text-[0.72rem] text-[#3d5a3f]/45">
                <Clock className="h-3 w-3" />
                Based on ~{activeMinutesPerMark.toFixed(2)} min per mark
              </p>
            </div>

            <div className="rounded-[1.3rem] border border-[#1a2e1a]/[0.06] bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[0.82rem] font-semibold text-[#1a2e1a]">Source papers</p>
                  <p className="text-[0.72rem] text-[#3d5a3f]/45">Limit where questions come from.</p>
                </div>
                <div className="flex items-center gap-3 text-[0.72rem]">
                  <button
                    type="button"
                    onClick={() => setSelectedPaperCodes(new Set(activePaperOptions.map((paper) => paper.code)))}
                    className="text-[#1a2e1a]/55 transition-colors hover:text-[#1a2e1a]"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPaperCodes(new Set())}
                    className="text-[#1a2e1a]/55 transition-colors hover:text-[#1a2e1a]"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {activePaperOptions.map((paper) => {
                  const isActive = selectedPaperCodes.has(paper.code);
                  return (
                    <button
                      key={paper.code}
                      type="button"
                      onClick={() => togglePaperCode(paper.code)}
                      disabled={!generationEnabled}
                      className={`btn-press rounded-full border px-3 py-1.5 text-[0.78rem] font-medium transition-all disabled:opacity-40 ${
                        isActive
                          ? "border-[#1a2e1a] bg-[#1a2e1a] text-white"
                          : "border-[#1a2e1a]/10 bg-[#f8f7f4] text-[#1a2e1a] hover:bg-[#f1eee6]"
                      }`}
                    >
                      {paper.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[1.3rem] border border-[#1a2e1a]/[0.06] bg-[#faf8f3] p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[0.68rem] uppercase tracking-[0.18em] text-accent-warm">Build summary</p>
                  <p className="mt-1 font-serif text-[1.2rem] text-[#1a2e1a]">
                    {activeSubject?.label}
                    {activeTier ? ` · ${activeTier.label}` : ""}
                  </p>
                  <p className="mt-1 text-[0.8rem] text-[#3d5a3f]/55">
                    {targetMarks} marks · {timeMinutes} minutes · {selectedPaperCodes.size} source paper{selectedPaperCodes.size === 1 ? "" : "s"}
                  </p>

                  {topicSelectionEnabled && selectedTopicPreview.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {selectedTopicPreview.map((topic) => (
                        <span key={topic.id} className="inline-flex items-center rounded-full border border-accent/20 bg-white px-2.5 py-1 text-[0.72rem] text-[#1a2e1a]">
                          {topic.label}
                        </span>
                      ))}
                      {selectedTopicOverflowCount > 0 ? (
                        <span className="inline-flex items-center rounded-full border border-[#1a2e1a]/12 bg-white px-2.5 py-1 text-[0.72rem] text-[#3d5a3f]/65">
                          +{selectedTopicOverflowCount} more
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 gap-2 rounded-full border border-[#1a2e1a]/10 bg-white p-1">
                  {[1, 2, 3].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setPaperCount(count)}
                      className={`btn-press rounded-full px-3.5 py-1.5 text-[0.76rem] font-semibold transition-all ${
                        paperCount === count
                          ? "bg-[#1a2e1a] text-white"
                          : "text-[#1a2e1a]/65 hover:bg-[#f8f7f4]"
                      }`}
                    >
                      {count} paper{count === 1 ? "" : "s"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {error ? (
              <div className="rounded-[1rem] border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-[0.8rem] font-medium text-red-700">Something went wrong</p>
                <p className="mt-0.5 text-[0.78rem] text-red-600/80">{error}</p>
              </div>
            ) : null}

            <div className="hidden lg:block lg:sticky lg:bottom-5">
              <div className="rounded-[1.2rem] border border-[#1a2e1a]/10 bg-white/95 p-4 shadow-[0_10px_28px_rgba(22,40,22,0.08)] backdrop-blur">
                <div className="flex items-center justify-between gap-4">
                  <p className="truncate text-[0.82rem] text-[#3d5a3f]/65">{summaryText}</p>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!canGenerate || isPending}
                    className="btn-press inline-flex items-center gap-2 rounded-full bg-[#1a2e1a] px-6 py-3 text-[0.9rem] font-semibold text-[#f8faf8] shadow-[0_8px_24px_rgba(22,40,22,0.18)] transition-shadow hover:shadow-[0_12px_32px_rgba(22,40,22,0.24)] disabled:opacity-40"
                  >
                    {isPending ? (
                      <>
                        <span className="status-breathe inline-block h-2 w-2 rounded-full bg-white/70" />
                        Assembling paper...
                      </>
                    ) : (
                      <>
                        <span className="text-[#f8faf8]">Generate paper</span>
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {step === 3 ? <MobileCommandBar summary={summaryText} canGenerate={canGenerate} onGenerate={handleGenerate} isPending={isPending} /> : null}

      {result ? (
        <SuccessModal
          result={result}
          subjectLabel={activeSubject?.label ?? ""}
          tierLabel={activeTier?.label}
          minutesPerMark={activeMinutesPerMark}
          onClose={() => setResult(null)}
          onBuildAnother={() => {
            setResult(null);
            setStep(1);
            setSelectedLeafIds(new Set());
          }}
        />
      ) : null}
    </div>
  );
}

function ArrowRight({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6.5 3.5L11 8l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
