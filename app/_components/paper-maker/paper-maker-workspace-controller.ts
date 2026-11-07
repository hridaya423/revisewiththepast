import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { clampMarks, clampTimeMinutes, createMarkingSubmission, estimatePaperTimeMinutes, estimateTargetMarksFromTimeMinutes, recommendedPaperCodes, requestSubjectDetail, resolveMinutesPerMark, resolveSubjectTopics } from "@/features/papers/client";
import { useAuth } from "@/app/_components/auth-provider";
import { buildSelectedTopicSummaries, flattenLeafIds, type SelectedTopicSummary } from "@/app/_components/paper-maker/topic-tree-model";
import type { BuilderStage } from "@/app/_components/paper-maker/builder-progress";
import type { TopicTreeNodeWithCounts } from "@/shared/domain/topic";
import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import type { SubjectTierKey } from "@/shared/domain/subject";
import { builderSelectionReducer, mergeSubjectDetail, type WorkspaceSubjectOption } from "@/app/_components/paper-maker/state-model";
import { BUILDER_DRAFT_KEY, parseBuilderDraft, serializeBuilderDraft } from "@/app/_components/paper-maker/builder-draft";
import { usePaperGeneration } from "@/app/_components/paper-maker/use-paper-generation";

export type PaperMakerWorkspaceProps = {
  initialSubjectKey?: PaperMakerSubjectKey;
  initialTier?: SubjectTierKey;
  initialTopicIds?: string[];
  initialStage?: BuilderStage;
  initialJobId?: string;
  subjectOptions: WorkspaceSubjectOption[];
};

export function usePaperMakerWorkspace({ subjectOptions, initialSubjectKey, initialTier, initialTopicIds = [], initialStage, initialJobId }: PaperMakerWorkspaceProps) {
  const { isAuthenticated } = useAuth();
  const generation = usePaperGeneration(initialJobId);
  const isPending = generation.busy;
  const generationMode = isPending ? generation.job?.includeMarkScheme ? "paper-and-mark-scheme" as const : "paper" as const : null;
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
  const [loadingSubjectKey, setLoadingSubjectKey] = useState<PaperMakerSubjectKey | null>(null);
  const [subjectDetailError, setSubjectDetailError] = useState<string | null>(null);
  const [topicSearch, setTopicSearch] = useState("");
  const [activeTopicGroupId, setActiveTopicGroupId] = useState<string | null>(() => defaultSubject?.topics[0]?.id ?? null);
  const [hasChosenSubject, setHasChosenSubject] = useState(Boolean(initialSubjectKey));
  const [builderStage, setBuilderStage] = useState<BuilderStage>(() => !initialSubjectKey ? "subject" : initialStage === "subject" ? "subject" : defaultSubject?.topicSelectionEnabled && initialTopicIds.length === 0 ? "topics" : initialStage ?? "paper");
  const [stageDirection, setStageDirection] = useState<"forward" | "back">("forward");
  const [activeBoardLabel, setActiveBoardLabel] = useState(defaultSubject?.boardLabel ?? subjectOptionsState[0]?.boardLabel ?? "");
  const subjectDetailRequestRef = useRef<AbortController | null>(null);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [initialDraftContext] = useState({ subjectOptions, initialSubjectKey, initialTier, initialTopicIds, initialStage });

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
  const canGenerate = hasChosenSubject && Boolean(activeSubject?.detailLoaded) && !isLoadingSubjectDetail && !subjectDetailError && generationEnabled && resolvedPaperCodes.size > 0 && topicsReady;
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

  const updateLocation = useCallback((stage: BuilderStage, method: "push" | "replace" = "push", subjectKey = selectedSubjectKey, tier = selectedTier, leafIds = selectedLeafIds) => {
    const params = new URLSearchParams(window.location.search);
    params.set("subject", subjectKey);
    params.set("stage", stage);
    const subject = subjectOptionsState.find((entry) => entry.key === subjectKey);
    if (subject?.tiers.length) params.set("tier", tier);
    else params.delete("tier");
    if (leafIds.size) params.set("topics", Array.from(leafIds).join(","));
    else params.delete("topics");
    window.history[method === "push" ? "pushState" : "replaceState"](null, "", `${pathname}?${params}`);
  }, [pathname, selectedLeafIds, selectedSubjectKey, selectedTier, subjectOptionsState]);

  const focusStageHeading = useCallback(() => window.requestAnimationFrame(() => stageHeadingRef.current?.focus()), []);
  const goToStage = useCallback((stage: BuilderStage) => {
    if (stage !== "subject" && !hasChosenSubject) return;
    if (stage === "paper" && topicSelectionEnabled && !topicsReady) return;
    const order: Record<BuilderStage, number> = { subject: 0, topics: 1, paper: 2 };
    setStageDirection(order[stage] >= order[builderStage] ? "forward" : "back");
    setBuilderStage(stage);
    updateLocation(stage);
    focusStageHeading();
  }, [builderStage, focusStageHeading, hasChosenSubject, topicSelectionEnabled, topicsReady, updateLocation]);
  const loadSubjectDetail = useCallback(async (key: PaperMakerSubjectKey) => {
    subjectDetailRequestRef.current?.abort();
    const controller = new AbortController();
    subjectDetailRequestRef.current = controller;
    setLoadingSubjectKey(key);
    setSubjectDetailError(null);
    try {
      const detail = await requestSubjectDetail(key, controller.signal);
      if (controller.signal.aborted) return;
      setSubjectDetails((current) => [...current.filter((entry) => entry.key !== detail.key), detail]);
      const detailTier = detail.tiers.some((tier) => tier.key === selectedTier) ? selectedTier : detail.tiers[0]?.key ?? "foundation";
      const detailTopics = detail.tiers.length > 0 ? detail.topicsByTier?.[detailTier] ?? [] : detail.topics;
      const availableIds = new Set(flattenLeafIds(detailTopics));
      const validIds = new Set(Array.from(selectedLeafIds).filter((id) => availableIds.has(id)));
      if (detailTier !== selectedTier || validIds.size !== selectedLeafIds.size) {
        dispatchSelection({ type: "tier-changed", tier: detailTier, leafIds: validIds });
        if (detailTopics.length && !validIds.size) setBuilderStage("topics");
      }
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
    dispatchSelection({ type: "subject-changed", subjectKey: key, tier: nextTier, paperCodes: new Set(subject?.defaultPaperCodes ?? []), targetMarks: nextTargetMarks, timeMinutes: nextTimeMinutes }); setHasChosenSubject(true); setExpandedIds(new Set(nextTopics.map((topic) => topic.id))); setActiveTopicGroupId(nextTopics[0]?.id ?? null); setTopicSearch(""); setError(null); setSubjectDetailError(null); setStageDirection("forward"); setBuilderStage(subject?.topicSelectionEnabled ? "topics" : "paper"); focusStageHeading();
    updateLocation(subject?.topicSelectionEnabled ? "topics" : "paper", "push", key, nextTier, new Set());
  }, [focusStageHeading, subjectOptionsState, targetMarks, targetMode, timeMinutes, updateLocation]);
  const handleTierChange = useCallback((tierKey: SubjectTierKey) => { const nextTopics = resolveSubjectTopics(activeSubject, tierKey); const available = new Set(flattenLeafIds(nextTopics)); const leafIds = new Set(Array.from(selectedLeafIds).filter((id) => available.has(id))); dispatchSelection({ type: "tier-changed", tier: tierKey, leafIds }); setExpandedIds(new Set(nextTopics.map((topic) => topic.id))); setActiveTopicGroupId(nextTopics[0]?.id ?? null); setTopicSearch(""); setError(null); setStageDirection("back"); setBuilderStage("topics"); updateLocation("topics", "push", selectedSubjectKey, tierKey, leafIds); }, [activeSubject, selectedLeafIds, selectedSubjectKey, updateLocation]);
  const handleGenerate = useCallback((includeMarkScheme = false) => {
    if (!canGenerate || isPending) return;
    setError(null);
    void generation.start({
      request: { subjectKey: selectedSubjectKey, subjectTier: activeSubject?.tiers.length ? selectedTier : undefined, selectedTopicNodeIds, targetMarks, questionMix, timeMinutes, targetMode, paperCodes: Array.from(resolvedPaperCodes) },
      paperCount,
      includeMarkScheme,
    });
  }, [activeSubject, canGenerate, generation, isPending, paperCount, questionMix, resolvedPaperCodes, selectedSubjectKey, selectedTier, selectedTopicNodeIds, targetMarks, targetMode, timeMinutes]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const draft = parseBuilderDraft(window.localStorage.getItem(BUILDER_DRAFT_KEY), initialDraftContext.subjectOptions);
        const mayRestore = !initialDraftContext.initialSubjectKey || Boolean(initialDraftContext.initialStage && draft?.selection.selectedSubjectKey === initialDraftContext.initialSubjectKey);
        if (draft && mayRestore) {
          if (initialDraftContext.initialSubjectKey) {
            draft.selection.selectedLeafIds = new Set(initialDraftContext.initialTopicIds);
            if (initialDraftContext.initialTier) draft.selection.selectedTier = initialDraftContext.initialTier;
            draft.stage = initialDraftContext.initialStage ?? draft.stage;
          }
          dispatchSelection({ type: "selection-restored", selection: draft.selection });
          setPaperCount(draft.paperCount);
          setBuilderStage(draft.stage);
          setHasChosenSubject(true);
          setActiveBoardLabel(initialDraftContext.subjectOptions.find((subject) => subject.key === draft.selection.selectedSubjectKey)?.boardLabel ?? "");
          setDraftRestored(true);
        }
      } catch {
        setDraftRestored(false);
      }
      setDraftReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialDraftContext]);

  useEffect(() => {
    if (!draftReady || !hasChosenSubject) return;
    try {
      window.localStorage.setItem(BUILDER_DRAFT_KEY, serializeBuilderDraft({ selection, paperCount, stage: builderStage }));
    } catch {}
    updateLocation(builderStage, "replace");
  }, [builderStage, draftReady, hasChosenSubject, paperCount, selection, updateLocation]);

  useEffect(() => {
    const restoreLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const subject = subjectOptionsState.find((entry) => entry.key === params.get("subject"));
      if (!subject) {
        setHasChosenSubject(false);
        setBuilderStage("subject");
        return;
      }
      const tier = subject.tiers.find((entry) => entry.key === params.get("tier"))?.key ?? subject.tiers[0]?.key ?? "foundation";
      const ids = new Set((params.get("topics") ?? "").split(",").filter(Boolean));
      if (subject.key !== selectedSubjectKey || tier !== selectedTier) {
        dispatchSelection({ type: "subject-changed", subjectKey: subject.key, tier, paperCodes: new Set(subject.defaultPaperCodes), targetMarks, timeMinutes });
      }
      dispatchSelection({ type: "leaf-selection-changed", leafIds: ids });
      setHasChosenSubject(true);
      setActiveBoardLabel(subject.boardLabel);
      const requested = params.get("stage");
      setBuilderStage(requested === "subject" ? "subject" : subject.topicSelectionEnabled && (!ids.size || requested === "topics") ? "topics" : "paper");
    };
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, [selectedSubjectKey, selectedTier, subjectOptionsState, targetMarks, timeMinutes]);

  const clearSavedChoices = useCallback(() => {
    try { window.localStorage.removeItem(BUILDER_DRAFT_KEY); } catch {}
    setDraftRestored(false);
    setHasChosenSubject(false);
    setBuilderStage("subject");
    setSelectedLeafIds(new Set());
    window.history.replaceState(null, "", pathname);
  }, [pathname, setSelectedLeafIds]);

  useEffect(() => { if (!draftReady || !hasChosenSubject || !activeSubject || activeSubject.detailLoaded || subjectDetailError) return; const timeoutId = window.setTimeout(() => void loadSubjectDetail(activeSubject.key), 0); return () => window.clearTimeout(timeoutId); }, [activeSubject, draftReady, hasChosenSubject, loadSubjectDetail, subjectDetailError]);
  useEffect(() => () => subjectDetailRequestRef.current?.abort(), []);
  return { generation, focusStageHeading, draftRestored, clearSavedChoices, isAuthenticated, router, activeSubject, activeTier, activeTopics, activePaperOptions, activeMinutesPerMark, selectedSubjectKey, selectedTier, selectedTopicSummaries, selectedLeafIds, expandedIds, filteredTopics, activeTopicGroup, groupedSubjectOptions, activeBoardGroup, topicSelectionEnabled, generationEnabled, isLoadingSubjectDetail, subjectDetailError, topicSearch, hasChosenSubject, builderStage, stageDirection, stageHeadingRef, topicsReady, canGenerate, targetMarks, timeMinutes, questionMix, paperCount, resolvedPaperCodes, paperSourcesCustomized, error: generation.error ?? error, isPending, generationMode, setActiveBoardLabel, setTopicSearch, setActiveTopicGroupId, setQuestionMix, setPaperCount, setSelectedLeafIds, setPaperSourcesCustomized, setSelectedPaperCodes, goToStage, loadSubjectDetail, toggleExpanded, toggleSelected, clearTopics, removeTopic, togglePaperCode, updateFromMarks, updateFromTime, handleSubjectChange, handleTierChange, handleGenerate, createMarkingSubmission };
}
