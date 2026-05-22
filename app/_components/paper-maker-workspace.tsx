"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

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

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>
      <path d="M1.5 3.5L5 7L8.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Stepper({ step, onChange }: { step: number; onChange: (step: number) => void }) {
  const steps = [
    { number: 1, label: "Subject" },
    { number: 2, label: "Topics" },
    { number: 3, label: "Build" },
  ];

  return (
    <ol className="flex items-center justify-center gap-3" aria-label="Paper maker steps">
      {steps.map((item, index) => {
        const isActive = step === item.number;
        const isComplete = step > item.number;
        const isFuture = step < item.number;

        return (
          <li key={item.number} className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (!isFuture) onChange(item.number);
              }}
              disabled={isFuture}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[0.78rem] transition ${
                isActive
                  ? "border-[#1a2e1a] bg-[#1a2e1a] text-white"
                  : isComplete
                    ? "border-[#1a2e1a]/10 bg-white text-[#1a2e1a]"
                    : "border-[#1a2e1a]/8 bg-transparent text-[#1a2e1a]/35"
              }`}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[0.68rem] font-semibold ${isActive ? "bg-white/15" : "bg-[#1a2e1a]/[0.05]"}`}>
                {isComplete ? "✓" : item.number}
              </span>
              <span>{item.label}</span>
            </button>
            {index < steps.length - 1 ? <div className="h-px w-6 bg-[#1a2e1a]/10" /> : null}
          </li>
        );
      })}
    </ol>
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
    <div className="space-y-2">
      <div
        className={`flex items-center gap-3 rounded-[1.15rem] border bg-white px-3 py-3 transition ${
          selection.checked || selection.partial
            ? "border-[#5a8a5c]/20 shadow-[0_6px_18px_rgba(90,138,92,0.08)]"
            : "border-[#1a2e1a]/[0.06]"
        }`}
        style={{ marginLeft: `${depth * 18}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleExpanded(node.id)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#1a2e1a]/10 bg-[#f8f7f4] text-[#1a2e1a]/55 transition hover:bg-[#f1eee6]"
            aria-label={isExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
          >
            <ChevronIcon expanded={isExpanded} />
          </button>
        ) : (
          <div className="h-8 w-8 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onToggleSelected(node)}
          role="checkbox"
          aria-checked={selection.partial ? "mixed" : selection.checked}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
              selection.checked
                ? "border-[#5a8a5c] bg-[#5a8a5c] text-white"
                : selection.partial
                  ? "border-[#5a8a5c] bg-[#5a8a5c]/15 text-[#5a8a5c]"
                  : "border-[#1a2e1a]/15 bg-white text-transparent"
            }`}
            aria-hidden="true"
          >
            {selection.partial ? "−" : "✓"}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className={`truncate font-medium text-[#1a2e1a] ${depth === 0 ? "text-[0.98rem]" : "text-[0.92rem]"}`}>
                {node.label}
              </p>
              <span className="shrink-0 rounded-full bg-[#f8f7f4] px-2 py-1 text-[0.68rem] tabular-nums text-[#1a2e1a]/55">
                {node.questionUnitCount} questions
              </span>
            </div>
          </div>
        </button>
      </div>

      {hasChildren && isExpanded ? (
        <div className="space-y-2">
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
  onClose,
  onBuildAnother,
}: {
  result: { paperCount: number; questionCount: number; totalMarks: number; coveredTopics: number; timeMinutes: number };
  subjectLabel: string;
  tierLabel?: string;
  onClose: () => void;
  onBuildAnother: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1a2e1a]/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[1.8rem] bg-white p-8 text-center shadow-[0_24px_60px_rgba(26,46,26,0.15)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-[#5a8a5c]">✓</div>
        <h3 className="mt-5 font-serif text-[1.5rem] text-[#1a2e1a]">Paper ready</h3>
        <p className="mt-2 text-[0.88rem] text-[#3d5a3f]/60">Your custom {result.paperCount === 1 ? "paper has" : `${result.paperCount} papers have`} been generated and downloaded.</p>

        <div className="mt-5 rounded-[1.3rem] border border-[#1a2e1a]/[0.06] bg-[#f8f7f4] p-5 text-left">
          <p className="text-[0.68rem] uppercase tracking-[0.18em] text-[#6b8a6d]">{subjectLabel}{tierLabel ? ` · ${tierLabel}` : ""}</p>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="font-serif text-[1.35rem] text-[#1a2e1a]">{result.paperCount}</p>
              <p className="text-[0.68rem] text-[#3d5a3f]/50">paper{result.paperCount === 1 ? "" : "s"}</p>
            </div>
            <div>
              <p className="font-serif text-[1.35rem] text-[#1a2e1a]">{result.totalMarks}</p>
              <p className="text-[0.68rem] text-[#3d5a3f]/50">marks</p>
            </div>
            <div>
              <p className="font-serif text-[1.35rem] text-[#1a2e1a]">{result.timeMinutes}</p>
              <p className="text-[0.68rem] text-[#3d5a3f]/50">minutes</p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          <button type="button" onClick={onClose} className="w-full rounded-full bg-[#1a2e1a] px-5 py-3 text-[0.9rem] font-semibold text-white transition hover:bg-[#2a4a2a]">
            Back to builder
          </button>
          <button type="button" onClick={onBuildAnother} className="w-full rounded-full border border-[#1a2e1a]/10 bg-white px-5 py-3 text-[0.9rem] font-medium text-[#1a2e1a] transition hover:bg-[#f8f7f4]">
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
          className="shrink-0 rounded-full bg-[#1a2e1a] px-5 py-2.5 text-[0.82rem] font-semibold text-white transition hover:bg-[#2a4a2a] disabled:opacity-40"
        >
          {isPending ? "Building..." : "Generate"}
        </button>
      </div>
    </div>
  );
}

export function PaperMakerWorkspace({ subjectOptions }: PaperMakerWorkspaceProps) {
  const defaultSubject = subjectOptions[0];
  const defaultMinutesPerMark = defaultSubject?.benchmarkMinutesPerMark ?? defaultSubject?.recommendedMinutesPerMark ?? 1;
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
  const activeMinutesPerMark = activeSubject?.benchmarkMinutesPerMark ?? activeSubject?.recommendedMinutesPerMark ?? 1;
  const selectedTopicSummaries = useMemo(
    () => buildSelectedTopicSummaries(activeTopics, selectedLeafIds),
    [activeTopics, selectedLeafIds],
  );
  const selectedTopicNodeIds = useMemo(
    () => selectedTopicSummaries.map((summary) => summary.id),
    [selectedTopicSummaries],
  );

  const canGenerate = generationEnabled && selectedPaperCodes.size > 0 && (!topicSelectionEnabled || selectedTopicNodeIds.length > 0);

  const summaryText = useMemo(() => {
    const parts = [activeSubject?.label ?? ""];
    if (activeTier) parts.push(activeTier.label);
    if (topicSelectionEnabled) parts.push(`${selectedTopicSummaries.length} topic${selectedTopicSummaries.length === 1 ? "" : "s"}`);
    parts.push(`${selectedPaperCodes.size} paper${selectedPaperCodes.size === 1 ? "" : "s"}`);
    parts.push(`${targetMarks} marks`);
    return parts.join(" · ");
  }, [activeSubject, activeTier, topicSelectionEnabled, selectedTopicSummaries.length, selectedPaperCodes.size, targetMarks]);

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
    setTargetMarks(clampMarks(estimateTargetMarksFromTimeMinutes(
      safeTimeMinutes,
      activeSubject?.benchmarkMinutesPerMark ?? null,
      activeSubject?.recommendedMinutesPerMark ?? 1,
    )));
  }, [activeSubject]);

  const handleSubjectChange = useCallback((key: PaperMakerSubjectKey) => {
    const subject = subjectOptions.find((entry) => entry.key === key);
    const nextTier = subject?.tiers[0]?.key ?? "foundation";
    const nextTopics = resolveSubjectTopics(subject, nextTier);
    setSelectedSubjectKey(key);
    setSelectedTier(nextTier);
    setSelectedPaperCodes(new Set(subject?.defaultPaperCodes ?? []));
    setSelectedLeafIds(new Set());
    setExpandedIds(new Set(nextTopics.map((topic) => topic.id)));
    if (targetMode === "time") {
      setTargetMarks(clampMarks(estimateTargetMarksFromTimeMinutes(
        timeMinutes,
        subject?.benchmarkMinutesPerMark ?? null,
        subject?.recommendedMinutesPerMark ?? 1,
      )));
    } else {
      setTargetMode("marks");
      setTimeMinutes(clampTimeMinutes(estimatePaperTimeMinutes(
        subject?.benchmarkMinutesPerMark ?? subject?.recommendedMinutesPerMark ?? 1,
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
              <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[#6b8a6d]">Step 01</p>
              <h2 className="mt-2 font-serif text-[1.7rem] text-[#1a2e1a]">Choose a paper to build</h2>
              <p className="mt-2 text-[0.95rem] text-[#3d5a3f]/65">Pick the subject first. Everything else stays hidden until you need it.</p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {subjectOptions.map((subject) => {
                const isActive = subject.key === selectedSubjectKey;

                return (
                  <button
                    key={subject.key}
                    type="button"
                    onClick={() => handleSubjectChange(subject.key)}
                    className={`rounded-[1.5rem] border p-6 text-left transition ${
                      isActive
                        ? "border-[#1a2e1a] bg-white shadow-[0_8px_24px_rgba(26,46,26,0.08)]"
                        : "border-[#1a2e1a]/[0.06] bg-white/70 hover:bg-white"
                    }`}
                  >
                    <div>
                      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-[#6b8a6d]">{subject.boardLabel}</p>
                      <h3 className="mt-1.5 font-serif text-[1.35rem] text-[#1a2e1a]">{subject.label}</h3>
                    </div>
                    <p className="mt-3 text-[0.88rem] leading-6 text-[#3d5a3f]/60">{subject.description}</p>
                  </button>
                );
              })}
            </div>

            <div className="flex justify-end">
              <button type="button" onClick={() => setStep(2)} className="rounded-full bg-[#1a2e1a] px-5 py-3 text-[0.88rem] font-semibold text-white transition hover:bg-[#2a4a2a]">
                Continue to {topicSelectionEnabled ? "topics" : "paper options"}
              </button>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[#6b8a6d]">Step 02</p>
                <h2 className="mt-2 font-serif text-[1.7rem] text-[#1a2e1a]">Choose what to pull from</h2>
                <p className="mt-2 text-[0.95rem] text-[#3d5a3f]/65">
                  {activeSubject?.key === "edexcel-combined-science"
                    ? "Pick the tier first, then choose the Biology, Chemistry, or Physics areas you want. Only tagged questions from those topic groups will be used."
                    : "Select whole topic areas. The builder will use real past-paper questions from those areas only."}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep(1)} className="rounded-full border border-[#1a2e1a]/10 px-4 py-2.5 text-[0.82rem] font-medium text-[#1a2e1a] transition hover:bg-white">
                  Back
                </button>
                <button type="button" onClick={() => setStep(3)} className="rounded-full bg-[#1a2e1a] px-5 py-2.5 text-[0.82rem] font-semibold text-white transition hover:bg-[#2a4a2a]">
                  Continue
                </button>
              </div>
            </div>

            {topicSelectionEnabled ? (
              <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)] xl:items-start">
                <aside className="rounded-[1.5rem] border border-[#1a2e1a]/[0.06] bg-white p-5 xl:sticky xl:top-[140px]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[0.7rem] uppercase tracking-[0.16em] text-[#6b8a6d]">Selected topics</p>
                      <p className="mt-2 font-serif text-[1.8rem] text-[#1a2e1a]">{selectedTopicSummaries.length}</p>
                    </div>
                    {selectedTopicSummaries.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setSelectedLeafIds(new Set())}
                        className="rounded-full border border-[#1a2e1a]/10 px-3 py-1.5 text-[0.74rem] font-medium text-[#1a2e1a]/70 transition hover:bg-[#f8f7f4]"
                      >
                        Clear all
                      </button>
                    ) : null}
                  </div>

                  <p className="mt-2 text-[0.82rem] leading-6 text-[#3d5a3f]/58">{selectedTopicSummaries.length === 0 ? `Choose one or more areas from ${totalLeafIds.length} available tagged topic strands.` : "Your final paper will only draw from the areas listed below."}</p>

                  {selectedTopicSummaries.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedTopicSummaries.map((topic) => (
                        <span key={topic.id} className="inline-flex items-center gap-2 rounded-full border border-[#5a8a5c]/15 bg-[#5a8a5c]/[0.07] px-3 py-1.5 text-[0.76rem] text-[#1a2e1a]">
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
                            className="text-[#1a2e1a]/40 transition hover:text-[#1a2e1a]"
                            aria-label={`Remove ${topic.label}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </aside>

                <div className="space-y-3">
                  {activeSubject?.tiers.length ? (
                    <div className="rounded-[1.5rem] border border-[#1a2e1a]/[0.06] bg-white p-5">
                      <p className="text-[0.72rem] uppercase tracking-[0.14em] text-[#6b8a6d]">Tier</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {activeSubject.tiers.map((tier) => {
                          const isActive = tier.key === selectedTier;

                          return (
                            <button
                              key={tier.key}
                              type="button"
                              onClick={() => handleTierChange(tier.key)}
                              className={`rounded-[1.2rem] border px-5 py-4 text-left transition ${
                                isActive
                                  ? "border-[#1a2e1a] bg-[#f8f7f4]"
                                  : "border-[#1a2e1a]/[0.06] bg-white hover:bg-[#faf9f6]"
                              }`}
                            >
                              <p className="text-[0.7rem] uppercase tracking-[0.14em] text-[#6b8a6d]">{tier.label}</p>
                              <p className="mt-2 font-serif text-[1.55rem] text-[#1a2e1a]">{tier.taggedQuestionUnits}</p>
                              <p className="text-[0.8rem] text-[#3d5a3f]/55">tagged question units available</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {activeTopics.map((topic) => (
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

                  {activeTopics.length === 0 ? (
                    <div className="rounded-[1.5rem] border border-dashed border-[#1a2e1a]/10 bg-white/70 px-5 py-6 text-[0.88rem] text-[#3d5a3f]/60">
                      No tagged topics are available for this selection yet.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="rounded-[1.5rem] border border-[#1a2e1a]/[0.06] bg-white p-6">
                <div className="grid gap-3 sm:grid-cols-2">
                  {activeSubject?.tiers.map((tier) => {
                    const isActive = tier.key === selectedTier;

                    return (
                      <button
                        key={tier.key}
                        type="button"
                        onClick={() => handleTierChange(tier.key)}
                        className={`rounded-[1.2rem] border px-5 py-4 text-left transition ${
                          isActive
                            ? "border-[#1a2e1a] bg-[#f8f7f4]"
                            : "border-[#1a2e1a]/[0.06] bg-white hover:bg-[#faf9f6]"
                        }`}
                      >
                        <p className="text-[0.7rem] uppercase tracking-[0.14em] text-[#6b8a6d]">{tier.label}</p>
                        <p className="mt-2 font-serif text-[1.55rem] text-[#1a2e1a]">{tier.taggedQuestionUnits}</p>
                        <p className="text-[0.8rem] text-[#3d5a3f]/55">tagged question units available</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        ) : null}

        {step === 3 ? (
          <section className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[#6b8a6d]">Step 03</p>
                <h2 className="mt-2 font-serif text-[1.7rem] text-[#1a2e1a]">Review and generate</h2>
                <p className="mt-2 text-[0.95rem] text-[#3d5a3f]/65">Set the paper length, choose which source papers to include, then generate the PDF.</p>
              </div>
              <button type="button" onClick={() => setStep(2)} className="rounded-full border border-[#1a2e1a]/10 px-4 py-2.5 text-[0.82rem] font-medium text-[#1a2e1a] transition hover:bg-white">
                Back
              </button>
            </div>

            <div className="rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-sm">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
                <div>
                  <p className="text-[0.7rem] uppercase tracking-[0.16em] text-[#6b8a6d]">Your paper</p>
                  <h3 className="mt-2 font-serif text-[1.4rem] text-[#1a2e1a]">{activeSubject?.label}{activeTier ? ` · ${activeTier.label}` : ""}</h3>
                  <div className="mt-4 flex flex-wrap gap-2 text-[0.8rem] text-[#1a2e1a]">
                    {topicSelectionEnabled ? <span className="rounded-full bg-[#f8f7f4] px-3 py-1.5">{selectedTopicSummaries.length} selected topic{selectedTopicSummaries.length === 1 ? "" : "s"}</span> : null}
                    <span className="rounded-full bg-[#f8f7f4] px-3 py-1.5">{selectedPaperCodes.size} source paper{selectedPaperCodes.size === 1 ? "" : "s"}</span>
                    <span className="rounded-full bg-[#f8f7f4] px-3 py-1.5">{paperCount} paper{paperCount === 1 ? "" : "s"}</span>
                    <span className="rounded-full bg-[#f8f7f4] px-3 py-1.5">{targetMarks} marks</span>
                    <span className="rounded-full bg-[#f8f7f4] px-3 py-1.5">{timeMinutes} minutes</span>
                  </div>
                </div>

                <div className="rounded-[1.2rem] bg-[#f8f7f4] p-4">
                  <p className="text-[0.7rem] uppercase tracking-[0.14em] text-[#6b8a6d]">Included papers</p>
                  <ul className="mt-3 space-y-2 text-[0.82rem] text-[#3d5a3f]/72">
                    {activePaperOptions.filter((paper) => selectedPaperCodes.has(paper.code)).map((paper) => (
                      <li key={paper.code}>{paper.label}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[0.78rem] font-medium text-[#1a2e1a]">Paper length</p>
                  <p className="mt-1 text-[0.82rem] text-[#3d5a3f]/55">Edit either marks or time. The other value updates live using the current subject pacing.</p>
                </div>
                <span className="rounded-full bg-[#f8f7f4] px-3 py-1.5 text-[0.75rem] text-[#3d5a3f]/65">
                  Based on ~{activeMinutesPerMark.toFixed(2)} min per mark
                </span>
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <div className="rounded-[1.3rem] bg-[#f8f7f4] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="paper-target-marks" className="text-[0.76rem] font-medium text-[#1a2e1a]">Target marks</label>
                    <span className={`rounded-full px-2.5 py-1 text-[0.68rem] ${targetMode === "marks" ? "bg-[#1a2e1a] text-white" : "bg-white text-[#3d5a3f]/55"}`}>
                      driving value
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => updateFromMarks(targetMarks - 5)}
                      disabled={!generationEnabled}
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-[#1a2e1a]/10 bg-white text-[#1a2e1a] transition hover:bg-[#f1eee6] disabled:opacity-30"
                    >
                      −
                    </button>
                    <input
                      id="paper-target-marks"
                      type="number"
                      min={MIN_MARKS}
                      max={MAX_MARKS}
                      step={5}
                      value={targetMarks}
                      onChange={(event) => updateFromMarks(Number(event.target.value) || MIN_MARKS)}
                      disabled={!generationEnabled}
                      className="h-14 w-full rounded-[1rem] border border-[#1a2e1a]/10 bg-white px-4 text-center font-serif text-[1.45rem] text-[#1a2e1a] outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => updateFromMarks(targetMarks + 5)}
                      disabled={!generationEnabled}
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-[#1a2e1a]/10 bg-white text-[#1a2e1a] transition hover:bg-[#f1eee6] disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>

                  <p className="mt-2 text-[0.76rem] text-[#3d5a3f]/55">Marks step in 5-mark blocks for a cleaner paper build.</p>

                  <input
                    type="range"
                    min={MIN_MARKS}
                    max={MAX_MARKS}
                    step={5}
                    value={targetMarks}
                    onChange={(event) => updateFromMarks(Number(event.target.value))}
                    disabled={!generationEnabled}
                    className="mt-4 w-full accent-[#5a8a5c]"
                  />
                </div>

                <div className="rounded-[1.3rem] bg-[#f8f7f4] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="paper-time-minutes" className="text-[0.76rem] font-medium text-[#1a2e1a]">Time on the front page</label>
                    <span className={`rounded-full px-2.5 py-1 text-[0.68rem] ${targetMode === "time" ? "bg-[#1a2e1a] text-white" : "bg-white text-[#3d5a3f]/55"}`}>
                      driving value
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <input
                      id="paper-time-minutes"
                      type="number"
                      min={MIN_TIME_MINUTES}
                      max={MAX_TIME_MINUTES}
                      step={5}
                      value={timeMinutes}
                      onChange={(event) => updateFromTime(Number(event.target.value) || MIN_TIME_MINUTES)}
                      disabled={!generationEnabled}
                      className="h-14 w-32 rounded-[1rem] border border-[#1a2e1a]/10 bg-white px-4 text-center font-serif text-[1.45rem] text-[#1a2e1a] outline-none"
                    />
                    <span className="text-[0.82rem] text-[#3d5a3f]/60">minutes</span>
                  </div>

                  <p className="mt-2 text-[0.76rem] text-[#3d5a3f]/55">If you raise the time, marks rise with it. If you shorten time, marks come down live.</p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {[30, 45, 60, 75, 90].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => updateFromTime(preset)}
                        disabled={!generationEnabled}
                        className={`rounded-full border px-3 py-1.5 text-[0.78rem] transition ${timeMinutes === preset && targetMode === "time" ? "border-[#1a2e1a] bg-[#1a2e1a] text-white" : "border-[#1a2e1a]/10 bg-white text-[#1a2e1a] hover:bg-[#f1eee6]"}`}
                      >
                        {preset} min
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[0.78rem] font-medium text-[#1a2e1a]">Source papers to include</p>
                  <p className="mt-1 text-[0.82rem] text-[#3d5a3f]/55">Use this to limit where questions are pulled from.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {activePaperOptions.map((paper) => {
                    const isActive = selectedPaperCodes.has(paper.code);
                    return (
                      <button
                        key={paper.code}
                        type="button"
                        onClick={() => togglePaperCode(paper.code)}
                        disabled={!generationEnabled}
                        className={`rounded-full border px-4 py-2 text-[0.82rem] transition disabled:opacity-40 ${
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
            </div>

            <div className="rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[0.78rem] font-medium text-[#1a2e1a]">How many papers</p>
                  <p className="mt-1 text-[0.82rem] text-[#3d5a3f]/55">Generate up to 3 different papers from the same topic selection. Later papers avoid reusing the same source questions.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setPaperCount(count)}
                      className={`rounded-full border px-4 py-2 text-[0.82rem] transition ${paperCount === count ? "border-[#1a2e1a] bg-[#1a2e1a] text-white" : "border-[#1a2e1a]/10 bg-[#f8f7f4] text-[#1a2e1a] hover:bg-[#f1eee6]"}`}
                    >
                      {count} paper{count === 1 ? "" : "s"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {error ? (
              <div className="rounded-[1.4rem] border border-red-200 bg-red-50 p-4">
                <p className="text-[0.8rem] font-medium text-red-700">Something went wrong</p>
                <p className="mt-1 text-[0.8rem] text-red-600/80">{error}</p>
                <button type="button" onClick={() => setError(null)} className="mt-2 text-[0.75rem] font-medium text-red-700 underline">
                  Dismiss
                </button>
              </div>
            ) : null}

            <div className="hidden lg:flex lg:justify-end">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate || isPending}
                className="rounded-full bg-[#1a2e1a] px-7 py-3.5 text-[0.92rem] font-semibold text-white transition hover:bg-[#2a4a2a] disabled:opacity-40"
              >
                {isPending ? "Building paper..." : "Generate paper"}
              </button>
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
