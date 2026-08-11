"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import { AlignLeft, ArrowLeft, ArrowRight, Check, Clock3, List, Scale, Search, X, type LucideIcon } from "lucide-react";

import type { QuestionMixProfile } from "@/shared/domain/paper";
import type { TopicTreeNodeWithCounts } from "@/shared/domain/topic";
import type { PaperBuildTargetMode, SubjectTierKey } from "@/shared/domain/subject";
import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import { clampMarks, clampTimeMinutes, createMarkingSubmission, downloadMarkSchemePdfs, estimatePaperTimeMinutes, estimateTargetMarksFromTimeMinutes, MAX_MARKS, MAX_TIME_MINUTES, MIN_MARKS, MIN_TIME_MINUTES, recommendedPaperCodes, requestPaperGeneration, requestSavedPaper, requestSubjectDetail, resolveMinutesPerMark, resolveSubjectTopics, SuccessModal } from "@/features/papers/client";
import type { GenerationResult } from "@/features/papers/client";
import { useAuth } from "@/app/_components/auth-provider";
import { EmbossIcon } from "@/app/_components/emboss/emboss-icon";
import { EMBOSS_PRESETS } from "@/app/_components/emboss/params";
import {
  buildSelectedTopicSummaries,
  flattenLeafIds,
  getSelectionState,
  TopicNode,
  type SelectedTopicSummary,
} from "@/app/_components/paper-maker/topic-tree";
import { SUBJECT_COLORS, SUBJECT_ICONS } from "@/app/_components/subject-presentation";

type PaperMakerWorkspaceProps = {
  initialSubjectKey?: PaperMakerSubjectKey;
  initialTier?: SubjectTierKey;
  initialTopicIds?: string[];
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
    detailLoaded: boolean;
  }[];
};

type WorkspaceSubjectOption = PaperMakerWorkspaceProps["subjectOptions"][number];

function SubjectEmboss({ subjectKey, surface, size = 52 }: { subjectKey: string; surface: string; size?: number }) {
  const presentation = SUBJECT_COLORS[subjectKey] ?? { accent: "#4747D8", soft: "#F0F0FF" };
  const Icon = SUBJECT_ICONS[subjectKey];
  if (!Icon) return null;
  return <EmbossIcon icon={Icon} flag={subjectKey === "edexcel-french-reading" ? "fr" : undefined} color={presentation.accent} surface={surface} params={EMBOSS_PRESETS.subject} size={size} />;
}


const QUESTION_MIX_OPTIONS: { key: QuestionMixProfile; label: string; description: string; icon: LucideIcon }[] = [
  { key: "balanced", label: "Balanced", description: "A mix of short and extended questions.", icon: Scale },
  { key: "short-form", label: "Short form", description: "More 1–4 mark questions.", icon: List },
  { key: "long-form", label: "Long form", description: "More extended-response questions.", icon: AlignLeft },
];

type BuilderStage = "subject" | "topics" | "paper";

function BuilderProgress({ stage, subjectReady, topicsReady, topicSelectionEnabled, onStageChange }: { stage: BuilderStage; subjectReady: boolean; topicsReady: boolean; topicSelectionEnabled: boolean; onStageChange: (stage: BuilderStage) => void }) {
  const steps: Array<{ key: BuilderStage; label: string; ready: boolean; disabled: boolean }> = [
    { key: "subject", label: "Subject", ready: subjectReady, disabled: false },
    ...(topicSelectionEnabled ? [{ key: "topics" as const, label: "Topics", ready: topicsReady, disabled: !subjectReady }] : []),
    { key: "paper", label: "Paper", ready: false, disabled: !subjectReady || (topicSelectionEnabled && !topicsReady) },
  ];

  return (
    <nav className="flex items-center gap-1" aria-label="Paper builder steps">
      {steps.map((step, index) => (
        <button key={step.key} type="button" onClick={() => onStageChange(step.key)} disabled={step.disabled} aria-current={stage === step.key ? "step" : undefined} className={`inline-flex min-h-10 items-center gap-2 border-b-2 px-3 text-[0.74rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${stage === step.key ? "border-accent text-accent" : "border-transparent text-text-secondary hover:border-text/15 hover:text-accent"}`}>
            {step.label}
            {step.ready && stage !== step.key ? <Check className="h-4 w-4 text-success" /> : <span className="font-mono text-[0.66rem] text-text-subtle">{index + 1}</span>}
        </button>
      ))}
    </nav>
  );
}

function TopicSelectionSummary({
  topics,
  onClear,
  onRemove,
}: {
  topics: SelectedTopicSummary[];
  onClear: () => void;
  onRemove: (topic: SelectedTopicSummary) => void;
}) {
  const preview = topics.slice(0, 5);
  const overflow = Math.max(0, topics.length - preview.length);

  return (
    <div className="flex items-start justify-between gap-4 border-t border-text/10 pt-4">
      <div className="min-w-0">
        <p className="text-[0.72rem] font-semibold text-text">{topics.length ? `${topics.length} topic areas selected` : "No topic areas selected"}</p>
        <p className="mt-1 text-[0.68rem] leading-5 text-text-muted">
          {topics.length ? "Only these areas will be used in the generated paper." : "Select at least one area to keep the paper focused."}
        </p>
        {preview.length ? (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.68rem] text-text-secondary">
            {preview.map((topic) => (
              <button key={topic.id} type="button" onClick={() => onRemove(topic)} className="border-b border-text/20 pb-px text-left hover:border-accent hover:text-accent">
                {topic.label}
              </button>
            ))}
            {overflow ? <span className="font-medium text-text-muted">+{overflow} more</span> : null}
          </div>
        ) : null}
      </div>
      {topics.length ? (
        <button type="button" onClick={onClear} className="shrink-0 text-[0.68rem] font-semibold text-text-muted hover:text-accent">
          Clear
        </button>
      ) : null}
    </div>
  );
}

export function PaperMakerWorkspace({ subjectOptions, initialSubjectKey, initialTier, initialTopicIds = [] }: PaperMakerWorkspaceProps) {
  const { isAuthenticated } = useAuth();
  const [subjectOptionsState, setSubjectOptionsState] = useState(subjectOptions);
  const defaultSubject = subjectOptionsState.find((subject) => subject.key === initialSubjectKey) ?? subjectOptionsState[0];
  const defaultTierKey = initialTier && defaultSubject?.tiers.some((tier) => tier.key === initialTier) ? initialTier : defaultSubject?.tiers[0]?.key ?? "foundation";
  const defaultMinutesPerMark = resolveMinutesPerMark(defaultSubject?.benchmarkMinutesPerMark, defaultSubject?.recommendedMinutesPerMark);
  const router = useRouter();
  const pathname = usePathname();
  const [selectedSubjectKey, setSelectedSubjectKey] = useState<PaperMakerSubjectKey>(defaultSubject?.key ?? "aqa-geography");
  const [selectedLeafIds, setSelectedLeafIds] = useState<Set<string>>(() => new Set(initialTopicIds));
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(defaultSubject?.topics.map((topic) => topic.id) ?? []));
  const [targetMarks, setTargetMarks] = useState(40);
  const [questionMix, setQuestionMix] = useState<QuestionMixProfile>("balanced");
  const [timeMinutes, setTimeMinutes] = useState(() => clampTimeMinutes(estimatePaperTimeMinutes(defaultMinutesPerMark, 40)));
  const [targetMode, setTargetMode] = useState<PaperBuildTargetMode>("marks");
  const [selectedPaperCodes, setSelectedPaperCodes] = useState<Set<string>>(new Set(defaultSubject?.defaultPaperCodes ?? []));
  const [paperSourcesCustomized, setPaperSourcesCustomized] = useState(false);
  const [selectedTier, setSelectedTier] = useState<SubjectTierKey>(defaultTierKey);
  const [error, setError] = useState<string | null>(null);
  const [paperCount, setPaperCount] = useState(1);
  const [generationMode, setGenerationMode] = useState<"paper" | "paper-and-mark-scheme" | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [loadingSubjectKey, setLoadingSubjectKey] = useState<PaperMakerSubjectKey | null>(null);
  const [subjectDetailError, setSubjectDetailError] = useState<string | null>(null);
  const [topicSearch, setTopicSearch] = useState("");
  const [activeTopicGroupId, setActiveTopicGroupId] = useState<string | null>(() => defaultSubject?.topics[0]?.id ?? null);
  const [hasChosenSubject, setHasChosenSubject] = useState(Boolean(initialSubjectKey));
  const [builderStage, setBuilderStage] = useState<BuilderStage>(() => {
    if (!initialSubjectKey) return "subject";
    return defaultSubject?.topicSelectionEnabled && initialTopicIds.length === 0 ? "topics" : "paper";
  });
  const subjectDetailRequestRef = useRef<AbortController | null>(null);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);

  const activeSubject = useMemo(() => subjectOptionsState.find((subject) => subject.key === selectedSubjectKey) ?? subjectOptionsState[0], [selectedSubjectKey, subjectOptionsState]);
  const activeTopics = useMemo(() => resolveSubjectTopics(activeSubject, selectedTier), [activeSubject, selectedTier]);
  const generationEnabled = activeSubject?.generationEnabled ?? false;
  const isLoadingSubjectDetail = loadingSubjectKey === selectedSubjectKey;
  const topicSelectionEnabled = activeSubject?.topicSelectionEnabled ?? false;
  const activeTier = activeSubject?.tiers.find((tier) => tier.key === selectedTier) ?? activeSubject?.tiers[0];
  const activePaperOptions = activeSubject?.paperOptions ?? [];
  const activeMinutesPerMark = resolveMinutesPerMark(activeSubject?.benchmarkMinutesPerMark, activeSubject?.recommendedMinutesPerMark);
  const selectedTopicSummaries = useMemo(() => buildSelectedTopicSummaries(activeTopics, selectedLeafIds), [activeTopics, selectedLeafIds]);
  const selectedTopicNodeIds = useMemo(() => selectedTopicSummaries.map((summary) => summary.id), [selectedTopicSummaries]);
  const resolvedPaperCodes = useMemo(() => paperSourcesCustomized || !activeSubject ? selectedPaperCodes : new Set(recommendedPaperCodes(activeSubject.key, selectedLeafIds, activeSubject.defaultPaperCodes)), [activeSubject, paperSourcesCustomized, selectedLeafIds, selectedPaperCodes]);
  const canGenerate = hasChosenSubject && !isLoadingSubjectDetail && generationEnabled && resolvedPaperCodes.size > 0 && (!topicSelectionEnabled || selectedTopicNodeIds.length > 0);
  const topicsReady = !topicSelectionEnabled || selectedTopicNodeIds.length > 0;

  const goToStage = useCallback((stage: BuilderStage) => {
    if (stage !== "subject" && !hasChosenSubject) return;
    if (stage === "paper" && topicSelectionEnabled && !topicsReady) return;
    setBuilderStage(stage);
    window.requestAnimationFrame(() => stageHeadingRef.current?.focus());
  }, [hasChosenSubject, topicSelectionEnabled, topicsReady]);

  const filteredTopics = useMemo(() => {
    if (!topicSearch.trim()) return activeTopics;
    const searchLower = topicSearch.toLowerCase();
    const filterNodes = (nodes: TopicTreeNodeWithCounts[]): TopicTreeNodeWithCounts[] => nodes.reduce<TopicTreeNodeWithCounts[]>((acc, node) => {
      const matchesSelf = node.label.toLowerCase().includes(searchLower);
      const filteredChildren = node.children?.length ? filterNodes(node.children) : [];
      if (matchesSelf || filteredChildren.length > 0) acc.push({ ...node, children: filteredChildren.length > 0 ? filteredChildren : node.children });
      return acc;
    }, []);
    return filterNodes(activeTopics);
  }, [activeTopics, topicSearch]);
  const activeTopicGroup = useMemo(() => filteredTopics.find((topic) => topic.id === activeTopicGroupId) ?? filteredTopics[0], [activeTopicGroupId, filteredTopics]);

  const groupedSubjectOptions = useMemo(() => {
    const buckets = new Map<string, WorkspaceSubjectOption[]>();
    for (const subject of subjectOptionsState) {
      const group = buckets.get(subject.boardLabel) ?? [];
      group.push(subject);
      buckets.set(subject.boardLabel, group);
    }
    return Array.from(buckets.entries()).map(([boardLabel, subjects]) => ({ boardLabel, subjects }));
  }, [subjectOptionsState]);

  const loadSubjectDetail = useCallback(async (key: PaperMakerSubjectKey) => {
    subjectDetailRequestRef.current?.abort();
    const controller = new AbortController();
    subjectDetailRequestRef.current = controller;
    setLoadingSubjectKey(key);
    setSubjectDetailError(null);
    try {
      const detail = await requestSubjectDetail(key, controller.signal);
      setSubjectOptionsState((current) => current.map((subject) => subject.key === detail.key ? { ...subject, taggedQuestionUnits: detail.taggedQuestionUnits, benchmarkMinutesPerMark: detail.benchmarkMinutesPerMark, topics: detail.topics, topicsByTier: detail.topicsByTier, tiers: detail.tiers, detailLoaded: detail.detailLoaded } : subject));
      const detailTier = detail.tiers.some((tier) => tier.key === selectedTier) ? selectedTier : detail.tiers[0]?.key ?? "foundation";
      const detailTopics = detail.tiers.length > 0 ? detail.topicsByTier?.[detailTier] ?? [] : detail.topics;
      if (detail.tiers.length > 0 && detailTier !== selectedTier) setSelectedTier(detailTier);
      setExpandedIds(new Set(detailTopics.map((topic) => topic.id)));
      setActiveTopicGroupId(detailTopics[0]?.id ?? null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setSubjectDetailError(cause instanceof Error ? cause.message : "Could not load this subject.");
    } finally {
      if (subjectDetailRequestRef.current === controller) setLoadingSubjectKey(null);
    }
  }, [selectedTier]);

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
      if (selection.checked) node.leafTopicIds.forEach((leafId) => next.delete(leafId));
      else node.leafTopicIds.forEach((leafId) => next.add(leafId));
      return next;
    });
  }, []);

  const togglePaperCode = useCallback((code: string) => {
    setPaperSourcesCustomized(true);
    setSelectedPaperCodes(() => {
      const next = new Set(resolvedPaperCodes);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, [resolvedPaperCodes]);

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
    const subject = subjectOptionsState.find((entry) => entry.key === key);
    const nextTier = subject?.tiers[0]?.key ?? "foundation";
    const nextTopics = resolveSubjectTopics(subject, nextTier);
    setSelectedSubjectKey(key);
    setHasChosenSubject(true);
    setSelectedTier(nextTier);
    setSelectedPaperCodes(new Set(subject?.defaultPaperCodes ?? []));
    setPaperSourcesCustomized(false);
    setSelectedLeafIds(new Set());
    setExpandedIds(new Set(nextTopics.map((topic) => topic.id)));
    setActiveTopicGroupId(nextTopics[0]?.id ?? null);
    setTopicSearch("");
    setPaperSourcesCustomized(false);
    if (targetMode === "time") {
      const nextMinutesPerMark = resolveMinutesPerMark(subject?.benchmarkMinutesPerMark, subject?.recommendedMinutesPerMark);
      setTargetMarks(clampMarks(estimateTargetMarksFromTimeMinutes(timeMinutes, nextMinutesPerMark, nextMinutesPerMark)));
    } else {
      setTargetMode("marks");
      setTimeMinutes(clampTimeMinutes(estimatePaperTimeMinutes(resolveMinutesPerMark(subject?.benchmarkMinutesPerMark, subject?.recommendedMinutesPerMark), targetMarks)));
    }
    setError(null);
    setSubjectDetailError(null);
    setResult(null);
    setBuilderStage(subject?.topicSelectionEnabled ? "topics" : "paper");
    window.requestAnimationFrame(() => stageHeadingRef.current?.focus());
    const params = new URLSearchParams();
    params.set("subject", key);
    if (subject?.tiers.length) params.set("tier", nextTier);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [subjectOptionsState, targetMode, targetMarks, timeMinutes, pathname, router]);

  useEffect(() => {
    if (!hasChosenSubject || !activeSubject || activeSubject.detailLoaded) return;
    const timeoutId = window.setTimeout(() => void loadSubjectDetail(activeSubject.key), 0);
    return () => window.clearTimeout(timeoutId);
  }, [activeSubject, hasChosenSubject, loadSubjectDetail]);

  const handleTierChange = useCallback((tierKey: SubjectTierKey) => {
    const nextTopics = resolveSubjectTopics(activeSubject, tierKey);
    const availableLeafIds = new Set(flattenLeafIds(nextTopics));
    setSelectedTier(tierKey);
    setSelectedLeafIds((current) => new Set(Array.from(current).filter((leafId) => availableLeafIds.has(leafId))));
    setExpandedIds(new Set(nextTopics.map((topic) => topic.id)));
    setActiveTopicGroupId(nextTopics[0]?.id ?? null);
    setTopicSearch("");
    setError(null);
    setResult(null);
    setBuilderStage("topics");
    const params = new URLSearchParams();
    params.set("subject", selectedSubjectKey);
    params.set("tier", tierKey);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [activeSubject, pathname, router, selectedSubjectKey]);

  const handleGenerate = useCallback((includeMarkScheme = false) => {
    setError(null);
    setResult(null);
    setGenerationMode(includeMarkScheme ? "paper-and-mark-scheme" : "paper");
    startTransition(async () => {
      try {
        const excludedSourceQuestionKeys = new Set<string>();
        const priorSelectedUnitMarks: number[] = [];
        const priorCoveredLeafTopicIds: string[] = [];
        const savedPaperIds: string[] = [];
        const markSchemeUnitKeys: string[][] = [];
        let saveWarning: string | null = null;
        let lastQuestionCount = 0;
        let lastTotalMarks = 0;
        let lastCoveredTopics = 0;
        let lastTimeMinutes = timeMinutes;

        for (let paperIndex = 0; paperIndex < paperCount; paperIndex += 1) {
          const generated = await requestPaperGeneration({
              subjectKey: selectedSubjectKey,
              subjectTier: activeSubject?.tiers.length ? selectedTier : undefined,
              selectedTopicNodeIds,
              targetMarks,
              questionMix,
              timeMinutes,
              targetMode,
              paperCodes: Array.from(resolvedPaperCodes),
              excludeSourceQuestionKeys: Array.from(excludedSourceQuestionKeys),
              remainingPaperCount: paperCount - paperIndex,
              priorSelectedUnitMarks,
              priorPaperCount: paperIndex,
              priorCoveredLeafTopicIds,
          });

          const blob = generated.blob;
          lastQuestionCount = generated.questionCount;
          lastTotalMarks = generated.totalMarks;
          lastCoveredTopics = generated.coveredTopics;
          lastTimeMinutes = generated.timeMinutes;
          generated.selectedSourceQuestionKeys.forEach((key) => excludedSourceQuestionKeys.add(key));
          priorSelectedUnitMarks.push(...generated.selectedUnitMarks);
          priorCoveredLeafTopicIds.push(...generated.coveredLeafTopicIds);
          const encodedUnitKeys = generated.selectedUnitKeys.length > 0 ? generated.selectedUnitKeys.join("\n") : null;
          if (encodedUnitKeys) markSchemeUnitKeys.push(generated.selectedUnitKeys);

          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = `${selectedSubjectKey}-custom-paper-${targetMarks}m-${paperIndex + 1}.pdf`;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();

          if (isAuthenticated && encodedUnitKeys) {
            const saveFormData = new FormData();
            saveFormData.append("subjectKey", selectedSubjectKey);
            if (activeSubject?.tiers.length) saveFormData.append("subjectTier", selectedTier);
            saveFormData.append("targetMarks", String(targetMarks));
            saveFormData.append("totalMarks", String(lastTotalMarks));
            saveFormData.append("timeMinutes", String(lastTimeMinutes));
            saveFormData.append("selectedUnitKeys", decodeURIComponent(encodedUnitKeys));
            saveFormData.append("file", new File([blob], anchor.download, { type: "application/pdf" }));
            try {
              const payload = await requestSavedPaper(saveFormData);
              if (payload.savedPaperId) savedPaperIds.push(payload.savedPaperId);
            } catch (cause) {
              if (!saveWarning) saveWarning = cause instanceof Error ? cause.message : "The paper downloaded, but saving it failed.";
            }
          }

          URL.revokeObjectURL(url);
        }

        let markSchemeGenerated = false;
        let markSchemeWarning: string | null = null;
        if (includeMarkScheme) {
          const outcome = await downloadMarkSchemePdfs({ unitKeysByPaper: markSchemeUnitKeys, subjectKey: selectedSubjectKey, subjectTier: activeSubject?.tiers.length ? selectedTier : undefined });
          markSchemeGenerated = outcome.generated;
          markSchemeWarning = outcome.warning;
        }
        if (saveWarning) setError(saveWarning);
        setResult({ paperCount, questionCount: lastQuestionCount, totalMarks: lastTotalMarks, coveredTopics: lastCoveredTopics, timeMinutes: lastTimeMinutes, savedPaperIds, markSchemeUnitKeys, saveWarning, markSchemeGenerated, markSchemeWarning });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setGenerationMode(null);
      }
    });
  }, [selectedSubjectKey, activeSubject, selectedTier, selectedTopicNodeIds, targetMarks, questionMix, timeMinutes, targetMode, resolvedPaperCodes, paperCount, isAuthenticated]);

  const removeTopic = useCallback((topic: SelectedTopicSummary) => {
    setSelectedLeafIds((current) => {
      const next = new Set(current);
      topic.leafTopicIds.forEach((leafId) => next.delete(leafId));
      return next;
    });
  }, []);

  useEffect(() => () => subjectDetailRequestRef.current?.abort(), []);

  return (
    <div className="pb-24 lg:pb-0">
      <header className="mx-auto max-w-[1240px] pb-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <h1 className="text-[clamp(1.85rem,3vw,2.55rem)] font-bold leading-tight tracking-[-0.05em] text-text">Build a practice paper</h1>
            <p className="mt-1.5 max-w-[58ch] text-[0.8rem] leading-5 text-text-muted">Choose your course and topics, then set the paper length.</p>
          </div>
          <div className="lg:justify-self-end"><BuilderProgress stage={builderStage} subjectReady={hasChosenSubject} topicsReady={topicsReady} topicSelectionEnabled={topicSelectionEnabled} onStageChange={goToStage} /></div>
        </div>
        {isPending ? <p className="mt-3 text-[0.72rem] font-semibold text-accent" aria-live="polite">Preparing your download…</p> : null}
      </header>

      <div className={`mx-auto mt-5 ${builderStage === "subject" ? "max-w-[1240px]" : "max-w-[1180px]"}`}>
        {builderStage === "subject" ? (
          <section aria-labelledby="subject-heading">
            <h2 ref={stageHeadingRef} tabIndex={-1} id="subject-heading" className="sr-only">Choose your course</h2>
            <div className="mt-3 space-y-8">
              {groupedSubjectOptions.map((group) => (
                <section key={group.boardLabel} className="grid gap-4 lg:grid-cols-[136px_minmax(0,1fr)] lg:gap-6" aria-labelledby={`board-${group.boardLabel.toLowerCase()}`}>
                  <div className="flex items-baseline justify-between border-b border-text/12 pb-3 lg:block lg:border-b-0 lg:pt-4">
                    <h3 id={`board-${group.boardLabel.toLowerCase()}`} className="text-[0.9rem] font-bold tracking-[-0.025em] text-text">{group.boardLabel}</h3>
                    <span className="mt-1.5 block text-[0.65rem] text-text-muted">{group.subjects.length} course{group.subjects.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {group.subjects.map((subject) => {
                      const subjectName = subject.label.startsWith(`${subject.boardLabel} `) ? subject.label.slice(subject.boardLabel.length + 1) : subject.label;
                      const tierText = subject.tiers.length ? subject.tiers.map((tier) => tier.label).join(" + ") : null;
                      return (
                        <button key={subject.key} type="button" onClick={() => handleSubjectChange(subject.key)} className="btn-press group grid min-h-[108px] grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 rounded-[6px] border border-text/10 bg-white px-5 py-4 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-text/20 hover:bg-bg-elevated">
                          <SubjectEmboss subjectKey={subject.key} surface="#FFFFFF" size={50} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[0.94rem] font-bold tracking-[-0.028em] text-text">{subjectName}</span>
                            {tierText ? <span className="mt-1.5 block text-[0.69rem] text-text-muted">{tierText}</span> : null}
                          </span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>
        ) : (
          <div className="space-y-6">
            <section className="grid gap-4 border-b border-text/12 pb-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" aria-labelledby="course-heading">
              <div className="flex min-w-0 items-center gap-3">
                <SubjectEmboss subjectKey={selectedSubjectKey} surface="#F5F1E8" size={50} />
                <div className="min-w-0">
                  <h2 id="course-heading" className="truncate text-[1.08rem] font-semibold tracking-[-0.035em] text-text">{activeSubject?.label ?? "Choose a course"}</h2>
                  {activeTier ? <p className="mt-0.5 text-[0.68rem] font-medium text-text-muted">{activeTier.label}</p> : null}
                </div>
              </div>
              <div className="grid w-full grid-cols-1 items-center gap-2 sm:flex sm:w-auto sm:min-w-0 sm:shrink-0 sm:flex-wrap sm:justify-end sm:gap-3">
                {activeSubject?.tiers.length ? (
                  <div className="flex w-full min-w-0 overflow-hidden rounded-[4px] border border-text/12 bg-white sm:w-auto">
                    {activeSubject.tiers.map((tier) => <button key={tier.key} type="button" onClick={() => handleTierChange(tier.key)} className={`btn-press w-1/2 min-w-0 flex-none border-r border-text/12 px-3 py-2 text-[0.7rem] font-semibold last:border-r-0 sm:w-auto ${selectedTier === tier.key ? "bg-accent text-white" : "text-text-muted hover:text-accent"}`}>{tier.label}</button>)}
                  </div>
                ) : null}
                <button type="button" onClick={() => goToStage("subject")} className="btn-press inline-flex min-h-10 w-full items-center justify-center gap-2 whitespace-nowrap rounded-[4px] border border-text/15 bg-white px-4 text-[0.7rem] font-semibold text-text-secondary hover:border-accent hover:text-accent sm:w-auto sm:min-w-[132px]">Change course<ArrowRight className="h-3.5 w-3.5" /></button>
              </div>
            </section>

            {subjectDetailError ? (
              <div className="border border-danger/20 bg-danger-soft px-4 py-4" role="alert">
                <p className="text-[0.78rem] font-semibold text-danger">We could not load {activeSubject?.label}.</p>
                <p className="mt-1 text-[0.74rem] leading-5 text-danger/80">{subjectDetailError}</p>
                <button type="button" onClick={() => activeSubject && loadSubjectDetail(activeSubject.key)} className="btn-press mt-3 border border-danger/30 bg-danger px-3 py-2 text-[0.72rem] font-semibold text-white">Try loading again</button>
              </div>
            ) : null}

            {hasChosenSubject && topicSelectionEnabled && builderStage === "topics" ? (
              <section aria-labelledby="topics-heading">
                <h2 ref={stageHeadingRef} tabIndex={-1} id="topics-heading" className="text-[1.3rem] font-semibold tracking-[-0.04em] text-text outline-none">Choose focus topics</h2>
                <p className="mt-1 text-[0.75rem] leading-5 text-text-muted">Select the topics to include.</p>
                <div className="relative mt-5">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" aria-hidden="true" />
                  <input type="search" value={topicSearch} onChange={(event) => setTopicSearch(event.target.value)} placeholder="Search topics" aria-label="Search topics" className="h-12 w-full border border-text/15 bg-bg-elevated pl-10 pr-10 text-[0.8rem] text-text placeholder:text-text-subtle outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-glow)]" />
                  {topicSearch ? <button type="button" onClick={() => setTopicSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-accent" aria-label="Clear topic search"><X className="h-4 w-4" /></button> : null}
                </div>

                {isLoadingSubjectDetail && !activeSubject?.detailLoaded ? <div className="mt-5 border border-text/10 bg-white py-14 text-center"><p className="text-[0.78rem] font-semibold text-text">Loading topic structure…</p><p className="mt-1 text-[0.7rem] text-text-muted">Preparing {activeSubject?.label} topics.</p></div> : (
                  <>
                    {filteredTopics.length ? <div className="mt-5 overflow-hidden border border-text/10 bg-white lg:grid lg:grid-cols-[270px_minmax(0,1fr)]" aria-label={`${activeSubject?.label ?? "Course"} topics`}>
                      <div className="hidden max-h-[36rem] overflow-y-auto border-r border-text/10 bg-bg-soft/65 p-2 lg:block">
                        {filteredTopics.map((topic) => {
                          const selection = getSelectionState(topic, selectedLeafIds);
                          const selectedCount = topic.leafTopicIds.filter((leafId) => selectedLeafIds.has(leafId)).length;
                          return <button key={topic.id} type="button" onClick={() => setActiveTopicGroupId(topic.id)} className={`mb-1 flex w-full items-start justify-between gap-3 rounded-md px-3 py-3 text-left transition-colors ${activeTopicGroup?.id === topic.id ? "bg-white text-text shadow-[0_1px_0_rgba(13,23,52,0.05)]" : "text-text-secondary hover:bg-white/75 hover:text-text"}`}><span className="text-[0.76rem] font-semibold leading-5">{topic.label}</span><span className={`mt-0.5 shrink-0 font-mono text-[0.58rem] ${selection.checked || selection.partial ? "text-accent" : "text-text-muted"}`}>{selectedCount}/{topic.leafTopicIds.length}</span></button>;
                        })}
                      </div>
                      <div className="max-h-[36rem] overflow-y-auto p-1 lg:p-3">
                        <div className="lg:hidden">
                          {filteredTopics.map((topic) => <TopicNode key={topic.id} node={topic} depth={0} expandedIds={expandedIds} selectedLeafIds={selectedLeafIds} onToggleExpanded={toggleExpanded} onToggleSelected={toggleSelected} />)}
                        </div>
                        <div className="hidden lg:block">
                          {activeTopicGroup ? <TopicNode key={activeTopicGroup.id} node={activeTopicGroup} depth={0} expandedIds={expandedIds} selectedLeafIds={selectedLeafIds} onToggleExpanded={toggleExpanded} onToggleSelected={toggleSelected} /> : null}
                        </div>
                      </div>
                    </div> : <div className="mt-5 border border-text/10 bg-white px-6 py-14 text-center"><Search className="mx-auto h-5 w-5 text-text-subtle" aria-hidden="true" /><p className="mx-auto mt-2 max-w-sm text-[0.75rem] leading-5 text-text-muted">{topicSearch ? "No topics match your search." : "No tagged topics are available for this selection yet."}</p></div>}
                    <div className="mt-4"><TopicSelectionSummary topics={selectedTopicSummaries} onClear={() => setSelectedLeafIds(new Set())} onRemove={removeTopic} /></div>
                    <div className="mt-5 hidden justify-end lg:flex"><button type="button" onClick={() => goToStage("paper")} disabled={!topicsReady} className="btn-press inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-accent px-6 text-[0.8rem] font-bold text-white hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-40">Continue to paper setup<ArrowRight className="h-4 w-4" /></button></div>
                  </>
                )}
              </section>
            ) : null}

            {builderStage === "paper" ? (
              <section aria-labelledby="paper-brief-heading">
                <h2 ref={stageHeadingRef} tabIndex={-1} id="paper-brief-heading" className="sr-only">Paper setup</h2>
                {topicSelectionEnabled ? <div className="flex justify-end"><button type="button" onClick={() => goToStage("topics")} className="inline-flex shrink-0 items-center gap-1.5 px-2 py-2 text-[0.7rem] font-semibold text-text-secondary hover:text-accent"><ArrowLeft className="h-3.5 w-3.5" />Back to topics</button></div> : null}

                <div className="mt-3 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-10">
                  <div>
                    <section className="pb-7" aria-labelledby="length-heading">
                      <h3 id="length-heading" className="text-[1rem] font-semibold tracking-[-0.025em] text-text">Session length</h3>
                      <p className="mt-1 text-[0.73rem] leading-5 text-text-muted">Set marks or time. The other value updates with it.</p>
                      <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-[5px] border border-text/12 bg-white" aria-label="Paper length presets">
                        {[30, 45, 60].map((minutes) => <button key={minutes} type="button" onClick={() => updateFromTime(minutes)} disabled={!generationEnabled} aria-pressed={timeMinutes === minutes} className={`btn-press h-11 border-r border-text/12 text-[0.75rem] font-semibold last:border-r-0 disabled:opacity-40 ${timeMinutes === minutes ? "bg-bg-warm-soft text-accent" : "text-text hover:bg-bg-soft"}`}>{minutes} min</button>)}
                      </div>
                      <div className="mt-5 grid gap-6 sm:grid-cols-2">
                        <label htmlFor="paper-target-marks" className="block">
                          <span className="text-[0.68rem] font-semibold text-text-muted">Target marks</span>
                          <span className="mt-2 flex items-center"><input id="paper-target-marks" type="number" min={MIN_MARKS} max={MAX_MARKS} step={5} value={targetMarks} onChange={(event) => updateFromMarks(Number(event.target.value) || MIN_MARKS)} disabled={!generationEnabled} className="paper-number-input h-11 w-full min-w-0 bg-transparent font-mono text-[1.3rem] font-semibold text-text outline-none" /><span className="text-[0.68rem] text-text-muted">marks</span></span>
                        </label>
                        <label htmlFor="paper-time-minutes" className="block">
                          <span className="text-[0.68rem] font-semibold text-text-muted">Duration</span>
                          <span className="mt-2 flex items-center"><input id="paper-time-minutes" type="number" min={MIN_TIME_MINUTES} max={MAX_TIME_MINUTES} step={5} value={timeMinutes} onChange={(event) => updateFromTime(Number(event.target.value) || MIN_TIME_MINUTES)} disabled={!generationEnabled} className="paper-number-input h-11 w-full min-w-0 bg-transparent font-mono text-[1.3rem] font-semibold text-text outline-none" /><span className="text-[0.68rem] text-text-muted">min</span></span>
                        </label>
                      </div>
                      <input type="range" min={MIN_MARKS} max={MAX_MARKS} step={5} value={targetMarks} onChange={(event) => updateFromMarks(Number(event.target.value))} disabled={!generationEnabled} aria-label="Target marks" className="ui-range mt-6 w-full" style={{ "--range-progress": `${((targetMarks - MIN_MARKS) / (MAX_MARKS - MIN_MARKS)) * 100}%` } as CSSProperties} />
                      <p className="mt-2 flex items-center gap-1.5 text-[0.66rem] text-text-muted"><Clock3 className="h-3.5 w-3.5 text-accent" />About {activeMinutesPerMark.toFixed(2)} minutes per mark</p>
                    </section>

                    <section className="border-t border-text/12 py-7" aria-labelledby="mix-heading">
                      <h3 id="mix-heading" className="text-[1rem] font-semibold tracking-[-0.025em] text-text">Question mix</h3>
                      <p className="mt-1 text-[0.73rem] leading-5 text-text-muted">Choose how the marks are distributed.</p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        {QUESTION_MIX_OPTIONS.map((option) => <button key={option.key} type="button" onClick={() => setQuestionMix(option.key)} disabled={!generationEnabled} aria-pressed={questionMix === option.key} className={`relative min-h-28 border p-4 pr-16 text-left transition-colors disabled:opacity-40 ${questionMix === option.key ? "border-accent/30 bg-bg-warm-soft text-text" : "border-text/12 bg-white text-text hover:border-text/20 hover:bg-bg-soft"}`}><span className="absolute right-2.5 top-2"><EmbossIcon icon={option.icon} color="#4747D8" surface={questionMix === option.key ? "#F2EFE8" : "#FFFFFF"} params={EMBOSS_PRESETS.control} size={46} /></span><span className="block text-[0.76rem] font-bold">{option.label}</span><span className="mt-2 block text-[0.66rem] leading-5 text-text-muted">{option.description}</span></button>)}
                      </div>
                    </section>

                    <section className="border-t border-text/12 py-7" aria-labelledby="advanced-heading">
                      <div className="flex items-start justify-between gap-4"><div><h3 id="advanced-heading" className="text-[1rem] font-semibold tracking-[-0.025em] text-text">Source papers</h3><p className="mt-1 text-[0.73rem] leading-5 text-text-muted">Choose which papers questions can be drawn from.</p></div><div className="flex shrink-0 gap-3 text-[0.66rem] font-semibold text-text-muted"><button type="button" onClick={() => { setPaperSourcesCustomized(true); setSelectedPaperCodes(new Set(activePaperOptions.map((paper) => paper.code))); }} className="hover:text-accent">Select all</button><button type="button" onClick={() => { setPaperSourcesCustomized(true); setSelectedPaperCodes(new Set()); }} className="hover:text-accent">Clear</button></div></div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {activePaperOptions.map((paper) => <label key={paper.code} className={`flex min-h-11 cursor-pointer items-center gap-2.5 border px-3 py-2 text-[0.72rem] font-medium transition-colors ${resolvedPaperCodes.has(paper.code) ? "border-text/25 bg-bg-soft text-text" : "border-text/10 bg-white text-text-muted"}`}><input type="checkbox" checked={resolvedPaperCodes.has(paper.code)} onChange={() => togglePaperCode(paper.code)} disabled={!generationEnabled} className="ui-checkbox h-[18px] w-[18px] shrink-0 disabled:opacity-40" />{paper.label}</label>)}
                      </div>
                      {paperSourcesCustomized ? <button type="button" onClick={() => setPaperSourcesCustomized(false)} className="mt-3 text-[0.66rem] font-semibold text-accent hover:text-accent-deep">Reset to topic-matched sources</button> : null}
                      <div className="mt-6 border-t border-text/10 pt-5"><h4 className="text-[0.82rem] font-semibold text-text">Paper batch</h4><p className="mt-1 text-[0.68rem] text-text-muted">Generate up to three papers from the same setup.</p><div className="mt-3 grid w-full grid-cols-3 overflow-hidden rounded-md border border-text/15 bg-white">{[1, 2, 3].map((count) => <button key={count} type="button" onClick={() => setPaperCount(count)} aria-pressed={paperCount === count} className={`btn-press border-r border-text/15 px-3 py-3 text-[0.72rem] font-semibold last:border-r-0 ${paperCount === count ? "bg-accent text-white" : "text-text-muted hover:bg-bg-soft hover:text-text"}`}>{count} paper{count === 1 ? "" : "s"}</button>)}</div></div>
                    </section>
                  </div>

                  <aside className="border-t border-text/12 pt-6 lg:sticky lg:top-24 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0" aria-labelledby="summary-heading">
                    <div className="flex items-center gap-3"><SubjectEmboss subjectKey={selectedSubjectKey} surface="#F5F1E8" size={46} /><div><h3 id="summary-heading" className="text-[1rem] font-semibold tracking-[-0.03em] text-text">Paper brief</h3><p className="mt-0.5 text-[0.7rem] text-text-muted">{activeSubject?.label}{activeTier ? ` · ${activeTier.label}` : ""}</p></div></div>
                    <div className="mt-5 border-y border-text/10 py-4">
                      <p className="text-[0.64rem] font-semibold uppercase tracking-[0.08em] text-text-muted">Topics</p>
                      {topicSelectionEnabled ? <ul className="mt-2 space-y-1.5">{selectedTopicSummaries.slice(0, 4).map((topic) => <li key={topic.id} className="text-[0.7rem] leading-4 text-text-secondary">{topic.label}</li>)}{selectedTopicSummaries.length > 4 ? <li className="text-[0.66rem] font-semibold text-accent">+{selectedTopicSummaries.length - 4} more</li> : null}</ul> : <p className="mt-2 text-[0.72rem] font-semibold text-text">All available topics</p>}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-b border-text/10 py-4">
                      <div><dt className="text-[0.64rem] text-text-muted">Marks</dt><dd className="mt-1 font-mono text-[0.9rem] font-semibold text-text">{targetMarks}</dd></div>
                      <div><dt className="text-[0.64rem] text-text-muted">Duration</dt><dd className="mt-1 font-mono text-[0.9rem] font-semibold text-text">{timeMinutes} min</dd></div>
                      <div><dt className="text-[0.64rem] text-text-muted">Question mix</dt><dd className="mt-1 text-[0.72rem] font-semibold text-text">{QUESTION_MIX_OPTIONS.find((option) => option.key === questionMix)?.label}</dd></div>
                      <div><dt className="text-[0.64rem] text-text-muted">Papers</dt><dd className="mt-1 font-mono text-[0.9rem] font-semibold text-text">{paperCount}</dd></div>
                    </dl>
                    {!isAuthenticated ? <div className="mt-4 border border-text/10 bg-white px-3.5 py-3.5 text-[0.7rem] leading-5 text-text-secondary"><p className="font-semibold text-text">Want to keep this paper?</p><p className="mt-0.5">Sign in before generating to save and mark it later. Downloads still work without an account.</p><Link href="/auth?redirect=/paper-maker" className="mt-2 inline-block font-semibold text-accent hover:text-accent-deep">Sign in</Link></div> : null}
                    {error ? <div className="mt-4 border border-danger/20 bg-danger-soft px-3 py-3" role="alert"><p className="text-[0.76rem] font-semibold text-danger">Something went wrong</p><p className="mt-1 text-[0.74rem] leading-5 text-danger/80">{error}</p></div> : null}
                    <div className="mt-5 hidden gap-2.5 lg:grid">
                      <button type="button" onClick={() => handleGenerate(false)} disabled={!canGenerate || isPending} className="btn-press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-[0.76rem] font-bold text-white hover:bg-accent-deep disabled:opacity-40">{isPending && generationMode === "paper" ? <><span className="status-breathe h-2 w-2 rounded-full bg-white/70" />Building paper…</> : <>Generate {paperCount > 1 ? `${paperCount} papers` : "paper"}<ArrowRight className="h-4 w-4" /></>}</button>
                      <button type="button" onClick={() => handleGenerate(true)} disabled={!canGenerate || isPending} className="btn-press relative inline-flex min-h-11 w-full items-center justify-center rounded-md border border-text/15 bg-transparent px-10 text-accent hover:border-accent/50 hover:bg-white/55 disabled:opacity-40">{isPending && generationMode === "paper-and-mark-scheme" ? <><span className="status-breathe mr-2 h-1.5 w-1.5 rounded-full bg-accent/70" /><span className="text-[0.68rem] font-bold">Building both…</span></> : <><span className="flex flex-col items-center text-center leading-none"><span className="text-[0.68rem] font-bold">{paperCount > 1 ? `Generate ${paperCount} papers` : "Generate paper"}</span><span className="mt-1 text-[0.5rem] font-medium tracking-[0.01em] text-text-muted">+ {paperCount > 1 ? "mark schemes" : "mark scheme"}</span></span><ArrowRight className="absolute right-4 h-3.5 w-3.5 text-accent/75" /></>}</button>
                    </div>
                  </aside>
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>

      {builderStage !== "subject" ? <div className="fixed inset-x-0 bottom-0 z-40 border-t border-text/10 bg-bg-elevated/95 p-3 shadow-[0_-10px_30px_rgba(38,33,24,0.1)] backdrop-blur lg:hidden">
        {builderStage === "topics" ? <button type="button" onClick={() => goToStage("paper")} disabled={!topicsReady} className="btn-press flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 text-[0.8rem] font-bold text-white hover:bg-accent-deep disabled:opacity-40">Continue to paper setup<ArrowRight className="h-4 w-4" /></button> : <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => handleGenerate(false)} disabled={!canGenerate || isPending} className="btn-press flex min-h-12 items-center justify-center rounded-md bg-accent px-3 text-[0.7rem] font-bold text-white disabled:opacity-40">{isPending && generationMode === "paper" ? "Building…" : paperCount > 1 ? `Generate ${paperCount} papers` : "Generate paper"}</button><button type="button" onClick={() => handleGenerate(true)} disabled={!canGenerate || isPending} className="btn-press flex min-h-11 items-center justify-center rounded-md border border-text/15 bg-transparent px-3 text-center text-accent disabled:opacity-40">{isPending && generationMode === "paper-and-mark-scheme" ? <span className="text-[0.64rem] font-bold">Building both…</span> : <span className="flex flex-col items-center leading-none"><span className="text-[0.64rem] font-bold">{paperCount > 1 ? `Generate ${paperCount} papers` : "Generate paper"}</span><span className="mt-1 text-[0.48rem] font-medium text-text-muted">+ {paperCount > 1 ? "mark schemes" : "mark scheme"}</span></span>}</button></div>}
      </div> : null}

      {result ? <SuccessModal result={result} subjectKey={selectedSubjectKey} subjectTier={activeSubject?.tiers.length ? selectedTier : undefined} subjectLabel={activeSubject?.label ?? ""} tierLabel={activeTier?.label} minutesPerMark={activeMinutesPerMark} isAuthenticated={isAuthenticated} onOpenMarking={async () => {
        if (!isAuthenticated) {
          router.push("/auth?redirect=/marking");
          return;
        }
        if (result.savedPaperIds.length !== 1) {
          router.push("/marking");
          return;
        }
        const payload = await createMarkingSubmission({ savedPaperId: result.savedPaperIds[0] });
        router.push(`/marking/${payload.submissionId}`);
      }} onClose={() => setResult(null)} onBuildAnother={() => { setResult(null); setSelectedLeafIds(new Set()); }} /> : null}
    </div>
  );
}
