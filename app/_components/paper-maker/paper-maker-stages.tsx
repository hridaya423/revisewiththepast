import Link from "next/link";
import { ArrowLeft, ArrowRight, Search, X } from "lucide-react";

import type { QuestionMixProfile } from "@/shared/domain/paper";
import type { TopicTreeNodeWithCounts } from "@/shared/domain/topic";
import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import { TopicNode } from "@/app/_components/paper-maker/topic-tree";
import { examBoardTabId } from "@/app/_components/paper-maker/exam-board-model";
import { GenerationState } from "@/app/_components/paper-maker/generation-state";
import { PaperSetupControls } from "@/app/_components/paper-maker/paper-setup-controls";
import { QUESTION_MIX_OPTIONS } from "@/app/_components/paper-maker/paper-setup-model";
import type { SelectedTopicSummary } from "@/app/_components/paper-maker/topic-tree-model";
import type { BuilderUiState, WorkspaceSubjectOption } from "@/app/_components/paper-maker/state-model";
import { ExamBoardDrum } from "@/app/_components/paper-maker/exam-board-drum";
import { AnimatedValue } from "@/app/_components/ui/animated-value";
import { InlineNotice } from "@/app/_components/ui/inline-notice";
import { SubjectEmboss } from "@/app/_components/paper-maker/subject-emboss";

type SubjectGroup = { boardLabel: string; subjects: WorkspaceSubjectOption[] };

function TopicSelectionSummary({ topics, onRemove }: { topics: SelectedTopicSummary[]; onRemove: (topic: SelectedTopicSummary) => void }) {
  const preview = topics.slice(0, 5);
  const overflow = Math.max(0, topics.length - preview.length);
  return (
    <div className="py-[0.6875rem]">
      <p className="text-[0.72rem] font-semibold text-text">{topics.length ? `${topics.length} topic areas selected` : "No topic areas selected"}</p>
      <p className="mt-1 text-[0.68rem] leading-5 text-text-muted">{topics.length ? "Only these areas will be used in the generated paper." : "Select at least one area to keep the paper focused."}</p>
      {preview.length ? <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.68rem] text-text-secondary">{preview.map((topic) => <button key={topic.id} type="button" onClick={() => onRemove(topic)} className="border-b border-text/20 pb-px text-left hover:border-accent hover:text-accent">{topic.label}</button>)}{overflow ? <span className="font-medium text-text-muted">+{overflow} more</span> : null}</div> : null}
    </div>
  );
}

function TopicLoadingState({ subjectLabel }: { subjectLabel: string }) {
  return (
    <div className="topic-loading-state mt-5 border border-text/10 bg-white px-5 py-12 sm:px-8" role="status" aria-live="polite">
      <div className="mx-auto flex max-w-md flex-col items-center gap-5 text-center">
        <div className="topic-dot-loader shrink-0" aria-hidden="true">
          {Array.from({ length: 25 }, (_, index) => {
            const column = index % 5;
            const row = Math.floor(index / 5);
            return <span key={index} className={`topic-loader-dot ${column === 3 ? "topic-loader-dot-active" : ""}`} style={column === 3 ? { animationDelay: `${row * -0.12}s` } : undefined} />;
          })}
        </div>
        <div>
          <p className="text-[0.8rem] font-semibold text-text">Loading {subjectLabel} topics</p>
          <p className="mt-1 text-[0.7rem] leading-5 text-text-muted">Preparing the topic list.</p>
        </div>
      </div>
    </div>
  );
}

export function SubjectSelectionStage({ groups, activeBoardLabel, headingRef, onBoardChange, onSubjectChange }: { groups: SubjectGroup[]; activeBoardLabel: string; headingRef: React.RefObject<HTMLHeadingElement | null>; onBoardChange: (label: string) => void; onSubjectChange: (key: PaperMakerSubjectKey) => void }) {
  const activeGroup = groups.find((group) => group.boardLabel === activeBoardLabel) ?? groups[0];
  return <section aria-labelledby="subject-heading">
    <h2 ref={headingRef} tabIndex={-1} id="subject-heading" className="sr-only">Choose your course</h2>
    <div className="mt-3">
      <ExamBoardDrum boards={groups.map((group) => ({ label: group.boardLabel, courseCount: group.subjects.length }))} value={activeGroup?.boardLabel ?? ""} onChange={onBoardChange} />
      {groups.map((group) => {
        const active = group.boardLabel === activeGroup?.boardLabel;
        return <section aria-labelledby={examBoardTabId(group.boardLabel)} className="mt-5" hidden={!active} id={`exam-board-panel-${group.boardLabel.toLowerCase()}`} key={group.boardLabel} role="tabpanel">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{group.subjects.map((subject) => {
            const subjectName = subject.label.startsWith(`${subject.boardLabel} `) ? subject.label.slice(subject.boardLabel.length + 1) : subject.label;
            const tierText = subject.tiers.length ? subject.tiers.map((tier) => tier.label).join(" + ") : null;
            return <button key={subject.key} type="button" onClick={() => onSubjectChange(subject.key)} className="btn-press group grid min-h-[108px] grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 rounded-[6px] border border-text/10 bg-white px-5 py-4 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-text/20 hover:bg-bg-elevated"><SubjectEmboss subjectKey={subject.key} surface="#FFFFFF" size={50} /><span className="min-w-0 flex-1"><span className="block text-[0.94rem] font-bold tracking-[-0.028em] text-text">{subjectName}</span>{tierText ? <span className="mt-1.5 block text-[0.69rem] text-text-muted">{tierText}</span> : null}</span><ArrowRight className="h-4 w-4 shrink-0 text-text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden="true" /></button>;
          })}</div>
        </section>;
      })}
    </div>
  </section>;
}

export function TopicsStage({ activeSubjectLabel, headingRef, topicSearch, filteredTopics, activeTopicGroup, expandedIds, selectedLeafIds, selectedTopicSummaries, isLoading, detailLoaded, topicsReady, onSearchChange, onClearSearch, onActiveGroupChange, onToggleExpanded, onToggleSelected, onRemoveTopic, onClearTopics, onContinue }: { activeSubjectLabel: string; headingRef: React.RefObject<HTMLHeadingElement | null>; topicSearch: string; filteredTopics: TopicTreeNodeWithCounts[]; activeTopicGroup?: TopicTreeNodeWithCounts; expandedIds: Set<string>; selectedLeafIds: Set<string>; selectedTopicSummaries: SelectedTopicSummary[]; isLoading: boolean; detailLoaded: boolean; topicsReady: boolean; onSearchChange: (value: string) => void; onClearSearch: () => void; onActiveGroupChange: (id: string) => void; onToggleExpanded: (id: string) => void; onToggleSelected: (node: TopicTreeNodeWithCounts) => void; onRemoveTopic: (topic: SelectedTopicSummary) => void; onClearTopics: () => void; onContinue: () => void }) {
  const isPreparing = isLoading && !detailLoaded;
  return <section aria-labelledby="topics-heading" aria-busy={isPreparing}>
    <h2 ref={headingRef} tabIndex={-1} id="topics-heading" className="text-[1.3rem] font-semibold tracking-[-0.04em] text-text outline-none">Choose focus topics</h2><p className="mt-1 text-[0.75rem] leading-5 text-text-muted">Select the topics to include.</p>
    {isPreparing ? <TopicLoadingState subjectLabel={activeSubjectLabel} /> : <><div className="relative mt-5"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" aria-hidden="true" /><input type="search" value={topicSearch} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search topics" aria-label="Search topics" className="h-12 w-full border border-text/15 bg-bg-elevated pl-10 pr-10 text-[0.8rem] text-text placeholder:text-text-subtle outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-glow)]" />{topicSearch ? <button type="button" onClick={onClearSearch} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-accent" aria-label="Clear topic search"><X className="h-4 w-4" /></button> : null}</div>
      {filteredTopics.length ? <div className="mt-5 overflow-hidden border border-text/10 bg-white lg:grid lg:grid-cols-[270px_minmax(0,1fr)]" aria-label={`${activeSubjectLabel} topics`}><div className="topic-browser-pane hidden overflow-y-auto border-r border-text/10 bg-bg-soft/65 p-2 lg:block">{filteredTopics.map((topic) => { const selectedCount = topic.leafTopicIds.filter((leafId) => selectedLeafIds.has(leafId)).length; const selected = selectedCount === topic.leafTopicIds.length; const partial = selectedCount > 0 && !selected; return <button key={topic.id} type="button" onClick={() => onActiveGroupChange(topic.id)} className={`mb-1 flex w-full items-start justify-between gap-3 rounded-md px-3 py-3 text-left transition-colors ${activeTopicGroup?.id === topic.id ? "bg-white text-text shadow-[0_1px_0_rgba(13,23,52,0.05)]" : "text-text-secondary hover:bg-white/75 hover:text-text"}`}><span className="text-[0.76rem] font-semibold leading-5">{topic.label}</span><span className={`mt-0.5 shrink-0 font-mono text-[0.58rem] ${selected || partial ? "text-accent" : "text-text-muted"}`}>{selectedCount}/{topic.leafTopicIds.length}</span></button>; })}</div><div className="topic-browser-pane overflow-y-auto p-1 lg:p-3"><div className="lg:hidden">{filteredTopics.map((topic) => <TopicNode key={topic.id} node={topic} depth={0} expandedIds={expandedIds} selectedLeafIds={selectedLeafIds} onToggleExpanded={onToggleExpanded} onToggleSelected={onToggleSelected} />)}</div><div className="hidden lg:block">{activeTopicGroup ? <TopicNode key={activeTopicGroup.id} node={activeTopicGroup} depth={0} expandedIds={expandedIds} selectedLeafIds={selectedLeafIds} onToggleExpanded={onToggleExpanded} onToggleSelected={onToggleSelected} /> : null}</div></div></div> : <div className="mt-5 border border-text/10 bg-white px-6 py-14 text-center"><Search className="mx-auto h-5 w-5 text-text-subtle" aria-hidden="true" /><p className="mx-auto mt-2 max-w-sm text-[0.75rem] leading-5 text-text-muted">{topicSearch ? "No topics match your search." : "No tagged topics are available for this selection yet."}</p></div>}
       <div className="mt-3 border-t border-text/10 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-6"><TopicSelectionSummary topics={selectedTopicSummaries} onRemove={onRemoveTopic} /><div className="flex items-center justify-between gap-3 lg:justify-end"><button type="button" onClick={onClearTopics} disabled={!selectedTopicSummaries.length} aria-label="Clear selected topics" className="text-[0.7rem] font-semibold text-text-secondary hover:text-accent disabled:opacity-40">Clear selected topics</button><button type="button" onClick={onContinue} disabled={!topicsReady} className="btn-press inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-accent px-6 text-[0.8rem] font-bold text-white hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-40">Continue to paper setup<ArrowRight className="h-4 w-4" /></button></div></div>
    </>}
  </section>;
}

export function PaperSetupStage({ subjectKey, subjectLabel, activeTierLabel, headingRef, topicSelectionEnabled, selectedTopicSummaries, targetMarks, timeMinutes, questionMix, paperCount, generationEnabled, activeMinutesPerMark, activePaperOptions, resolvedPaperCodes, paperSourcesCustomized, canGenerate, isAuthenticated, error, isPending, generationMode, onBackToTopics, onMarksChange, onTimeChange, onQuestionMixChange, onPaperCodeToggle, onSelectAllPapers, onClearPapers, onResetPapers, onPaperCountChange, onGenerate }: { subjectKey: PaperMakerSubjectKey; subjectLabel: string; activeTierLabel?: string; headingRef: React.RefObject<HTMLHeadingElement | null>; topicSelectionEnabled: boolean; selectedTopicSummaries: SelectedTopicSummary[]; targetMarks: number; timeMinutes: number; questionMix: QuestionMixProfile; paperCount: number; generationEnabled: boolean; activeMinutesPerMark: number; activePaperOptions: { code: string; label: string }[]; resolvedPaperCodes: Set<string>; paperSourcesCustomized: boolean; canGenerate: boolean; isAuthenticated: boolean; error: string | null; isPending: boolean; generationMode: BuilderUiState["generationMode"]; onBackToTopics: () => void; onMarksChange: (value: number) => void; onTimeChange: (value: number) => void; onQuestionMixChange: (value: QuestionMixProfile) => void; onPaperCodeToggle: (code: string) => void; onSelectAllPapers: () => void; onClearPapers: () => void; onResetPapers: () => void; onPaperCountChange: (value: number) => void; onGenerate: (includeMarkScheme?: boolean) => void }) {
  return <section aria-labelledby="paper-brief-heading"><h2 ref={headingRef} tabIndex={-1} id="paper-brief-heading" className="sr-only">Paper setup</h2>{topicSelectionEnabled ? <div className="flex justify-end"><button type="button" onClick={onBackToTopics} className="inline-flex shrink-0 items-center gap-1.5 px-2 py-2 text-[0.7rem] font-semibold text-text-secondary hover:text-accent"><ArrowLeft className="h-3.5 w-3.5" />Back to topics</button></div> : null}<div className="mt-3 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-10"><PaperSetupControls generationEnabled={generationEnabled} targetMarks={targetMarks} timeMinutes={timeMinutes} activeMinutesPerMark={activeMinutesPerMark} questionMix={questionMix} activePaperOptions={activePaperOptions} resolvedPaperCodes={resolvedPaperCodes} paperSourcesCustomized={paperSourcesCustomized} paperCount={paperCount} onMarksChange={onMarksChange} onTimeChange={onTimeChange} onQuestionMixChange={onQuestionMixChange} onPaperCodeToggle={onPaperCodeToggle} onSelectAllPapers={onSelectAllPapers} onClearPapers={onClearPapers} onResetPapers={onResetPapers} onPaperCountChange={onPaperCountChange} /><aside className="border-t border-text/12 pt-6 lg:sticky lg:top-24 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0" aria-labelledby="summary-heading"><div className="flex items-center gap-3"><SubjectEmboss subjectKey={subjectKey} surface="#F5F1E8" size={46} /><div><h3 id="summary-heading" className="text-[1rem] font-semibold tracking-[-0.03em] text-text">Paper brief</h3><p className="mt-0.5 text-[0.7rem] text-text-muted">{subjectLabel}{activeTierLabel ? ` · ${activeTierLabel}` : ""}</p></div></div><div className="mt-5 border-y border-text/10 py-4"><p className="text-[0.64rem] font-semibold uppercase tracking-[0.08em] text-text-muted">Topics</p>{topicSelectionEnabled ? <ul className="mt-2 space-y-1.5">{selectedTopicSummaries.slice(0, 4).map((topic) => <li key={topic.id} className="text-[0.7rem] leading-4 text-text-secondary">{topic.label}</li>)}{selectedTopicSummaries.length > 4 ? <li className="text-[0.66rem] font-semibold text-accent">+{selectedTopicSummaries.length - 4} more</li> : null}</ul> : <p className="mt-2 text-[0.72rem] font-semibold text-text">All available topics</p>}</div><dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-b border-text/10 py-4"><div><dt className="text-[0.64rem] text-text-muted">Marks</dt><dd className="mt-1 font-mono text-[0.9rem] font-semibold text-text"><AnimatedValue value={targetMarks} label="marks" /></dd></div><div><dt className="text-[0.64rem] text-text-muted">Duration</dt><dd className="mt-1 font-mono text-[0.9rem] font-semibold text-text"><AnimatedValue value={timeMinutes} label="minutes" /> <span aria-hidden="true">min</span></dd></div><div><dt className="text-[0.64rem] text-text-muted">Question mix</dt><dd className="mt-1 text-[0.72rem] font-semibold text-text">{QUESTION_MIX_OPTIONS.find((option) => option.key === questionMix)?.label}</dd></div><div><dt className="text-[0.64rem] text-text-muted">Papers</dt><dd className="mt-1 font-mono text-[0.9rem] font-semibold text-text"><AnimatedValue value={paperCount} label={paperCount === 1 ? "paper" : "papers"} /></dd></div></dl>{!isAuthenticated ? <div className="mt-4 border border-text/10 bg-white px-3.5 py-3.5 text-[0.7rem] leading-5 text-text-secondary"><p className="font-semibold text-text">Want to keep this paper?</p><p className="mt-0.5">Sign in before generating to save and mark it later. Downloads still work without an account.</p><Link href="/auth?redirect=/paper-maker" className="mt-2 inline-block font-semibold text-accent hover:text-accent-deep">Sign in</Link></div> : null}{error ? <InlineNotice tone="failure" message={error} className="mt-4" /> : null}<div className="mt-5 hidden lg:block"><GenerationState canGenerate={canGenerate} isPending={isPending} generationMode={generationMode} paperCount={paperCount} onGenerate={onGenerate} /></div></aside></div></section>;
}
