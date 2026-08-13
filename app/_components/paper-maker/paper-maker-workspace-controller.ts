import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import type { GenerationResult } from "@/features/papers/client";
import { clampMarks, clampTimeMinutes, createMarkingSubmission, downloadMarkSchemePdfs, estimatePaperTimeMinutes, estimateTargetMarksFromTimeMinutes, recommendedPaperCodes, requestPaperGeneration, requestSavedPaper, requestSubjectDetail, resolveMinutesPerMark, resolveSubjectTopics, SuccessModal } from "@/features/papers/client";
import { useAuth } from "@/app/_components/auth-provider";
import { buildSelectedTopicSummaries, flattenLeafIds, type SelectedTopicSummary } from "@/app/_components/paper-maker/topic-tree-model";
import type { BuilderStage } from "@/app/_components/paper-maker/builder-progress";
import type { TopicTreeNodeWithCounts } from "@/shared/domain/topic";
import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import type { SubjectTierKey } from "@/shared/domain/subject";
import { builderSelectionReducer, mergeSubjectDetail, type WorkspaceSubjectOption } from "@/app/_components/paper-maker/state-model";

export type PaperMakerWorkspaceProps = {
  initialSubjectKey?: PaperMakerSubjectKey;
  initialTier?: SubjectTierKey;
  initialTopicIds?: string[];
  subjectOptions: WorkspaceSubjectOption[];
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}

export function usePaperMakerWorkspace({ subjectOptions, initialSubjectKey, initialTier, initialTopicIds = [] }: PaperMakerWorkspaceProps) {
  const { isAuthenticated } = useAuth();
  const [subjectDetails, setSubjectDetails] = useState<Array<Parameters<typeof mergeSubjectDetail>[1]>>([]);
  const subjectOptionsState = useMemo(() => subjectDetails.reduce(mergeSubjectDetail, subjectOptions), [subjectDetails, subjectOptions]);
  const defaultSubject = subjectOptionsState.find((subject) => subject.key === initialSubjectKey) ?? subjectOptionsState[0];
  const defaultTierKey = initialTier && defaultSubject?.tiers.some((tier) => tier.key === initialTier) ? initialTier : defaultSubject?.tiers[0]?.key ?? "foundation";
  const defaultMinutesPerMark = resolveMinutesPerMark(defaultSubject?.benchmarkMinutesPerMark, defaultSubject?.recommendedMinutesPerMark);
  const router = useRouter();
  const pathname = usePathname();
  const [selection, dispatchSelection] = useReducer(builderSelectionReducer, {
    selectedSubjectKey: defaultSubject?.key ?? "aqa-geography",
    selectedLeafIds: new Set(initialTopicIds),
    selectedPaperCodes: new Set(defaultSubject?.defaultPaperCodes ?? []),
    paperSourcesCustomized: false,
    selectedTier: defaultTierKey,
    targetMarks: 40,
    timeMinutes: clampTimeMinutes(estimatePaperTimeMinutes(defaultMinutesPerMark, 40)),
    targetMode: "marks",
    questionMix: "balanced",
  });
  const { selectedSubjectKey, selectedLeafIds, selectedPaperCodes, paperSourcesCustomized, selectedTier, targetMarks, timeMinutes, targetMode, questionMix } = selection;
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(defaultSubject?.topics.map((topic) => topic.id) ?? []));
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
  const [builderStage, setBuilderStage] = useState<BuilderStage>(() => !initialSubjectKey ? "subject" : defaultSubject?.topicSelectionEnabled && initialTopicIds.length === 0 ? "topics" : "paper");
  const [stageDirection, setStageDirection] = useState<"forward" | "back">("forward");
  const [activeBoardLabel, setActiveBoardLabel] = useState(defaultSubject?.boardLabel ?? subjectOptionsState[0]?.boardLabel ?? "");
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
  const topicsReady = !topicSelectionEnabled || selectedTopicNodeIds.length > 0;
  const canGenerate = hasChosenSubject && !isLoadingSubjectDetail && generationEnabled && resolvedPaperCodes.size > 0 && topicsReady;
  const filteredTopics = useMemo(() => {
    if (!topicSearch.trim()) return activeTopics;
    const searchLower = topicSearch.toLowerCase();
    const filterNodes = (nodes: TopicTreeNodeWithCounts[]): TopicTreeNodeWithCounts[] => nodes.reduce<TopicTreeNodeWithCounts[]>((acc, node) => {
      const filteredChildren = node.children?.length ? filterNodes(node.children) : [];
      if (node.label.toLowerCase().includes(searchLower) || filteredChildren.length > 0) acc.push({ ...node, children: filteredChildren.length > 0 ? filteredChildren : node.children });
      return acc;
    }, []);
    return filterNodes(activeTopics);
  }, [activeTopics, topicSearch]);
  const activeTopicGroup = useMemo(() => filteredTopics.find((topic) => topic.id === activeTopicGroupId) ?? filteredTopics[0], [activeTopicGroupId, filteredTopics]);
  const groupedSubjectOptions = useMemo(() => {
    const buckets = new Map<string, WorkspaceSubjectOption[]>();
    for (const subject of subjectOptionsState) buckets.set(subject.boardLabel, [...(buckets.get(subject.boardLabel) ?? []), subject]);
    return Array.from(buckets.entries()).map(([boardLabel, subjects]) => ({ boardLabel, subjects }));
  }, [subjectOptionsState]);
  const activeBoardGroup = groupedSubjectOptions.find((group) => group.boardLabel === activeBoardLabel) ?? groupedSubjectOptions[0];

  const focusStageHeading = useCallback(() => window.requestAnimationFrame(() => stageHeadingRef.current?.focus()), []);
  const goToStage = useCallback((stage: BuilderStage) => {
    if (stage !== "subject" && !hasChosenSubject) return;
    if (stage === "paper" && topicSelectionEnabled && !topicsReady) return;
    const order: Record<BuilderStage, number> = { subject: 0, topics: 1, paper: 2 };
    setStageDirection(order[stage] >= order[builderStage] ? "forward" : "back");
    setBuilderStage(stage);
    focusStageHeading();
  }, [builderStage, focusStageHeading, hasChosenSubject, topicSelectionEnabled, topicsReady]);
  const loadSubjectDetail = useCallback(async (key: PaperMakerSubjectKey) => {
    subjectDetailRequestRef.current?.abort();
    const controller = new AbortController();
    subjectDetailRequestRef.current = controller;
    setLoadingSubjectKey(key);
    setSubjectDetailError(null);
    try {
      const detail = await requestSubjectDetail(key, controller.signal);
      setSubjectDetails((current) => [...current.filter((entry) => entry.key !== detail.key), detail]);
      const detailTier = detail.tiers.some((tier) => tier.key === selectedTier) ? selectedTier : detail.tiers[0]?.key ?? "foundation";
      const detailTopics = detail.tiers.length > 0 ? detail.topicsByTier?.[detailTier] ?? [] : detail.topics;
      if (detail.tiers.length > 0 && detailTier !== selectedTier) dispatchSelection({ type: "tier-changed", tier: detailTier, leafIds: selectedLeafIds });
      setExpandedIds(new Set(detailTopics.map((topic) => topic.id)));
      setActiveTopicGroupId(detailTopics[0]?.id ?? null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setSubjectDetailError(cause instanceof Error ? cause.message : "Could not load this subject.");
    } finally {
      if (subjectDetailRequestRef.current === controller) setLoadingSubjectKey(null);
    }
  }, [selectedLeafIds, selectedTier]);
  const toggleExpanded = useCallback((id: string) => setExpandedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }), []);
  const toggleSelected = useCallback((node: TopicTreeNodeWithCounts) => dispatchSelection({ type: "leaf-selection-toggled", leafIds: node.leafTopicIds }), []);
  const setSelectedLeafIds = useCallback((leafIds: Set<string>) => dispatchSelection({ type: "leaf-selection-changed", leafIds }), []);
  const clearTopics = useCallback(() => setSelectedLeafIds(new Set()), [setSelectedLeafIds]);
  const removeTopic = useCallback((topic: SelectedTopicSummary) => dispatchSelection({ type: "leaf-selection-removed", leafIds: topic.leafTopicIds }), []);
  const setPaperSourcesCustomized = useCallback((customized: boolean) => dispatchSelection({ type: "paper-sources-reset", customized }), []);
  const setSelectedPaperCodes = useCallback((paperCodes: Set<string>) => dispatchSelection({ type: "paper-codes-changed", paperCodes, customized: true }), []);
  const setQuestionMix = useCallback((nextQuestionMix: typeof questionMix) => dispatchSelection({ type: "question-mix-changed", questionMix: nextQuestionMix }), []);
  const togglePaperCode = useCallback((code: string) => { const next = new Set(resolvedPaperCodes); if (next.has(code)) next.delete(code); else next.add(code); dispatchSelection({ type: "paper-codes-changed", paperCodes: next, customized: true }); }, [resolvedPaperCodes]);
  const updateFromMarks = useCallback((marks: number) => { const safe = clampMarks(marks); dispatchSelection({ type: "marks-changed", targetMarks: safe, timeMinutes: clampTimeMinutes(estimatePaperTimeMinutes(activeMinutesPerMark, safe)) }); }, [activeMinutesPerMark]);
  const updateFromTime = useCallback((time: number) => { const safe = clampTimeMinutes(time); dispatchSelection({ type: "time-changed", timeMinutes: safe, targetMarks: clampMarks(estimateTargetMarksFromTimeMinutes(safe, activeMinutesPerMark, activeMinutesPerMark)) }); }, [activeMinutesPerMark]);
  const handleSubjectChange = useCallback((key: PaperMakerSubjectKey) => {
    const subject = subjectOptionsState.find((entry) => entry.key === key);
    const nextTier = subject?.tiers[0]?.key ?? "foundation";
    const nextTopics = resolveSubjectTopics(subject, nextTier);
    const nextMinutesPerMark = resolveMinutesPerMark(subject?.benchmarkMinutesPerMark, subject?.recommendedMinutesPerMark);
    const nextTargetMarks = targetMode === "time" ? clampMarks(estimateTargetMarksFromTimeMinutes(timeMinutes, nextMinutesPerMark, nextMinutesPerMark)) : targetMarks;
    const nextTimeMinutes = targetMode === "time" ? timeMinutes : clampTimeMinutes(estimatePaperTimeMinutes(nextMinutesPerMark, targetMarks));
    dispatchSelection({ type: "subject-changed", subjectKey: key, tier: nextTier, paperCodes: new Set(subject?.defaultPaperCodes ?? []), targetMarks: nextTargetMarks, timeMinutes: nextTimeMinutes }); setHasChosenSubject(true); setExpandedIds(new Set(nextTopics.map((topic) => topic.id))); setActiveTopicGroupId(nextTopics[0]?.id ?? null); setTopicSearch(""); setError(null); setSubjectDetailError(null); setResult(null); setStageDirection("forward"); setBuilderStage(subject?.topicSelectionEnabled ? "topics" : "paper"); focusStageHeading();
    const params = new URLSearchParams({ subject: key }); if (subject?.tiers.length) params.set("tier", nextTier); router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [focusStageHeading, pathname, router, subjectOptionsState, targetMarks, targetMode, timeMinutes]);
  const handleTierChange = useCallback((tierKey: SubjectTierKey) => { const nextTopics = resolveSubjectTopics(activeSubject, tierKey); const available = new Set(flattenLeafIds(nextTopics)); dispatchSelection({ type: "tier-changed", tier: tierKey, leafIds: new Set(Array.from(selectedLeafIds).filter((id) => available.has(id))) }); setExpandedIds(new Set(nextTopics.map((topic) => topic.id))); setActiveTopicGroupId(nextTopics[0]?.id ?? null); setTopicSearch(""); setError(null); setResult(null); setStageDirection("back"); setBuilderStage("topics"); router.replace(`${pathname}?subject=${selectedSubjectKey}&tier=${tierKey}`, { scroll: false }); }, [activeSubject, pathname, router, selectedLeafIds, selectedSubjectKey]);
  const handleGenerate = useCallback((includeMarkScheme = false) => {
    setError(null); setResult(null); setGenerationMode(includeMarkScheme ? "paper-and-mark-scheme" : "paper");
    startTransition(async () => {
      try {
        const excluded = new Set<string>(); const priorMarks: number[] = []; const priorTopics: string[] = []; const savedPaperIds: string[] = []; const markSchemeUnitKeys: string[][] = []; let saveWarning: string | null = null; let lastQuestionCount = 0; let lastTotalMarks = 0; let lastCoveredTopics = 0; let lastTimeMinutes = timeMinutes;
        for (let paperIndex = 0; paperIndex < paperCount; paperIndex += 1) {
          const generated = await requestPaperGeneration({ subjectKey: selectedSubjectKey, subjectTier: activeSubject?.tiers.length ? selectedTier : undefined, selectedTopicNodeIds, targetMarks, questionMix, timeMinutes, targetMode, paperCodes: Array.from(resolvedPaperCodes), excludeSourceQuestionKeys: Array.from(excluded), remainingPaperCount: paperCount - paperIndex, priorSelectedUnitMarks: priorMarks, priorPaperCount: paperIndex, priorCoveredLeafTopicIds: priorTopics });
          lastQuestionCount = generated.questionCount; lastTotalMarks = generated.totalMarks; lastCoveredTopics = generated.coveredTopics; lastTimeMinutes = generated.timeMinutes; generated.selectedSourceQuestionKeys.forEach((key) => excluded.add(key)); priorMarks.push(...generated.selectedUnitMarks); priorTopics.push(...generated.coveredLeafTopicIds);
          const encoded = generated.selectedUnitKeys.length ? generated.selectedUnitKeys.join("\n") : null; if (encoded) markSchemeUnitKeys.push(generated.selectedUnitKeys);
          const filename = `${selectedSubjectKey}-custom-paper-${targetMarks}m-${paperIndex + 1}.pdf`; downloadBlob(generated.blob, filename);
          if (isAuthenticated && encoded) { const saveFormData = new FormData(); saveFormData.append("subjectKey", selectedSubjectKey); if (activeSubject?.tiers.length) saveFormData.append("subjectTier", selectedTier); saveFormData.append("targetMarks", String(targetMarks)); saveFormData.append("totalMarks", String(lastTotalMarks)); saveFormData.append("timeMinutes", String(lastTimeMinutes)); saveFormData.append("selectedUnitKeys", decodeURIComponent(encoded)); saveFormData.append("file", new File([generated.blob], filename, { type: "application/pdf" })); try { const payload = await requestSavedPaper(saveFormData); if (payload.savedPaperId) savedPaperIds.push(payload.savedPaperId); } catch (cause) { if (!saveWarning) saveWarning = cause instanceof Error ? cause.message : "The paper downloaded, but saving it failed."; } }
        }
        let markSchemeGenerated = false; let markSchemeWarning: string | null = null; if (includeMarkScheme) { const outcome = await downloadMarkSchemePdfs({ unitKeysByPaper: markSchemeUnitKeys, subjectKey: selectedSubjectKey, subjectTier: activeSubject?.tiers.length ? selectedTier : undefined }); markSchemeGenerated = outcome.generated; markSchemeWarning = outcome.warning; }
        if (saveWarning) setError(saveWarning); setResult({ paperCount, questionCount: lastQuestionCount, totalMarks: lastTotalMarks, coveredTopics: lastCoveredTopics, timeMinutes: lastTimeMinutes, savedPaperIds, markSchemeUnitKeys, saveWarning, markSchemeGenerated, markSchemeWarning });
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setGenerationMode(null); }
    });
  }, [activeSubject, isAuthenticated, paperCount, questionMix, resolvedPaperCodes, selectedSubjectKey, selectedTier, selectedTopicNodeIds, targetMarks, targetMode, timeMinutes]);
  useEffect(() => { if (!hasChosenSubject || !activeSubject || activeSubject.detailLoaded) return; const timeoutId = window.setTimeout(() => void loadSubjectDetail(activeSubject.key), 0); return () => window.clearTimeout(timeoutId); }, [activeSubject, hasChosenSubject, loadSubjectDetail]);
  useEffect(() => () => subjectDetailRequestRef.current?.abort(), []);
  return { isAuthenticated, router, activeSubject, activeTier, activeTopics, activePaperOptions, activeMinutesPerMark, selectedSubjectKey, selectedTier, selectedTopicSummaries, selectedLeafIds, expandedIds, filteredTopics, activeTopicGroup, groupedSubjectOptions, activeBoardGroup, topicSelectionEnabled, generationEnabled, isLoadingSubjectDetail, subjectDetailError, topicSearch, hasChosenSubject, builderStage, stageDirection, stageHeadingRef, topicsReady, canGenerate, targetMarks, timeMinutes, questionMix, paperCount, resolvedPaperCodes, paperSourcesCustomized, error, isPending, generationMode, result, setActiveBoardLabel, setTopicSearch, setActiveTopicGroupId, setQuestionMix, setPaperCount, setResult, setSelectedLeafIds, setPaperSourcesCustomized, setSelectedPaperCodes, goToStage, loadSubjectDetail, toggleExpanded, toggleSelected, clearTopics, removeTopic, togglePaperCode, updateFromMarks, updateFromTime, handleSubjectChange, handleTierChange, handleGenerate, createMarkingSubmission, SuccessModal };
}
