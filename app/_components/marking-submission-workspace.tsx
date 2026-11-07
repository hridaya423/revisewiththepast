"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { OperationNotice } from "@/app/_components/marking/presentation";
import { QuestionProgressRail, type QuestionProgressState } from "@/app/_components/marking/question-progress";
import { ActiveQuestionPanel } from "@/app/_components/marking/active-question-panel";
import type { ConfirmInput } from "@/app/_components/marking/score-panel";
import { UploadMapping } from "@/app/_components/marking/upload-mapping";
import { MarkingSetupControls } from "@/app/_components/marking-workspace-sections";
import { autoScoreQuestion as requestAutoScoreQuestion, autoScoreWholePaper as requestAutoScoreWholePaper, formatQuestionLabel, formatStatus, getQuestionState, importFinishedPaper as requestImportFinishedPaper, loadCombinedMarkScheme as requestCombinedMarkScheme, parseScoreEvidence, prioritizeQuestion, runOcr as requestOcr, saveScore as requestSaveScore } from "@/features/papers/client";

import { buildQuestionRows, statusToneClass } from "@/app/_components/marking/model";
import type { CombinedMarkSchemeEntry, FeedbackScope, MarkingSubmissionBundle } from "@/app/_components/marking/model";

export function MarkingSubmissionWorkspace({ submissionId, initialBundle }: { submissionId: string; initialBundle: MarkingSubmissionBundle }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [operationFeedback, setOperationFeedback] = useState<{ scope: FeedbackScope; message: string } | null>(null);
  const [ocrLoadingKey, setOcrLoadingKey] = useState<string | null>(null);
  const [autoScoreLoadingKey, setAutoScoreLoadingKey] = useState<string | null>(null);
  const [combinedMarkScheme, setCombinedMarkScheme] = useState<{ entries: CombinedMarkSchemeEntry[]; combinedText: string; failures?: Array<{ questionKey: string; error: string }> } | null>(null);
  const [isLoadingCombinedMarkScheme, setIsLoadingCombinedMarkScheme] = useState(false);
  const [selectedQuestionKey, setSelectedQuestionKey] = useState<string | null>(null);

  const questionRows = useMemo(() => buildQuestionRows(initialBundle, combinedMarkScheme?.entries), [combinedMarkScheme?.entries, initialBundle]);

  const activeQuestionKey = useMemo(() => {
    if (selectedQuestionKey && questionRows.some((row) => row.questionKey === selectedQuestionKey)) return selectedQuestionKey;
    return [...questionRows].sort((left, right) => prioritizeQuestion(left) - prioritizeQuestion(right))[0]?.questionKey ?? null;
  }, [questionRows, selectedQuestionKey]);
  const activeRow = questionRows.find((row) => row.questionKey === activeQuestionKey) ?? null;
  const activeRowIndex = activeRow ? questionRows.findIndex((row) => row.questionKey === activeRow.questionKey) : -1;
  const nextQuestion = activeRowIndex >= 0 ? questionRows[activeRowIndex + 1] ?? null : null;
  const previousQuestion = activeRowIndex > 0 ? questionRows[activeRowIndex - 1] ?? null : null;
  const isImportedSubmission = initialBundle.submission.importSource === "imported_pdf";
  const hasImportedPages = initialBundle.pages.length > 0;
  const canAutoScoreWholePaper = questionRows.length > 0 && questionRows.every((row) => Boolean(row.response));
  const mappingQuestions = useMemo(() => questionRows.flatMap((row, index) => row.savedQuestion ? [{ key: row.questionKey, label: formatQuestionLabel({ questionNumber: row.savedQuestion.questionNumber ?? String(index + 1), questionPartNumber: row.savedQuestion.questionPartNumber, questionPath: row.savedQuestion.questionPath, questionKey: row.questionKey }) }] : []), [questionRows]);
  const reviewRows = useMemo(() => questionRows.filter((row) => {
    const state = getQuestionState(row);
    return state === "review" || state === "failed";
  }), [questionRows]);
  const activeMarkSchemeEntry = useMemo(() => {
    return questionRows.find((row) => row.questionKey === activeQuestionKey)?.combinedMarkScheme ?? null;
  }, [activeQuestionKey, questionRows]);

  const showFeedback = (scope: FeedbackScope) => operationFeedback?.scope === scope ? <OperationNotice message={operationFeedback.message} /> : null;
  const fail = (scope: FeedbackScope, cause: unknown, fallback: string) => {
    setOperationFeedback({ scope, message: cause instanceof Error ? cause.message : fallback });
  };

  const processFinishedPaperPdf = (file: File | null) => {
    if (!file) return;
    setOperationFeedback(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("submissionId", submissionId);
         await requestImportFinishedPaper(formData);
        router.refresh();
      } catch (cause) {
        fail("setup", cause, "Could not import the finished paper PDF.");
      }
    });
  };

  const runOcr = async (questionKey: string) => {
    setOcrLoadingKey(questionKey);
    setOperationFeedback(null);
    try {
      await requestOcr({ submissionId, questionKey });
      router.refresh();
    } catch (cause) {
      fail("ocr", cause, "Could not run OCR.");
    } finally {
      setOcrLoadingKey(null);
    }
  };

  const autoScore = async (questionKey: string) => {
    setAutoScoreLoadingKey(questionKey);
    setOperationFeedback(null);
    try {
      await requestAutoScoreQuestion({ submissionId, questionKey });
      router.refresh();
    } catch (cause) {
      fail("score", cause, "Could not auto-score this question.");
    } finally {
      setAutoScoreLoadingKey(null);
    }
  };

  const autoScoreWholePaper = async () => {
    setAutoScoreLoadingKey("__whole-paper__");
    setOperationFeedback(null);
    try {
      await requestAutoScoreWholePaper(submissionId);
      router.refresh();
    } catch (cause) {
      fail("whole-paper", cause, "Could not auto-score the full paper.");
    } finally {
      setAutoScoreLoadingKey(null);
    }
  };

  const confirmScore = async (questionKey: string, input: ConfirmInput) => {
    const evidence = parseScoreEvidence(initialBundle.scores.find((entry) => entry.questionKey === questionKey)?.evidenceJson);
    const result = await requestSaveScore({ submissionId, questionKey, ...input, evidence: evidence ?? { savedFrom: "marking-workspace" } });
    router.refresh();
    return result;
  };

  const openUploads = () => {
    const element = document.getElementById("answer-pages");
    const details = element?.querySelector("details");
    if (details) details.open = true;
    element?.scrollIntoView({ block: "start" });
    element?.querySelector("summary")?.focus();
  };

  const loadCombinedMarkScheme = useCallback(async () => {
    setIsLoadingCombinedMarkScheme(true);
    setOperationFeedback(null);
    try {
      const payload = await requestCombinedMarkScheme(submissionId);
      setCombinedMarkScheme(payload);
    } catch (cause) {
      fail("mark-scheme", cause, "Could not load combined mark scheme.");
    } finally {
      setIsLoadingCombinedMarkScheme(false);
    }
  }, [submissionId]);

  useEffect(() => {
    if ((initialBundle.savedPaperQuestions ?? []).length === 0 || combinedMarkScheme) return;
    const timeoutId = window.setTimeout(() => void loadCombinedMarkScheme(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [combinedMarkScheme, initialBundle.savedPaperQuestions, loadCombinedMarkScheme]);

  const activeScoreEvidence = activeRow ? parseScoreEvidence(activeRow.score?.evidenceJson) : null;
  const activeMarkSchemePreview = activeScoreEvidence?.markScheme?.partText || activeRow?.combinedMarkScheme?.markScheme.partText || null;
  const activeMarkSchemeUrl = activeScoreEvidence?.markScheme?.markSchemeUrl || activeRow?.combinedMarkScheme?.markScheme.markSchemeUrl;
  const activeMarkSchemePages = activeScoreEvidence?.markScheme?.pageNumbers || activeRow?.combinedMarkScheme?.markScheme.pageNumbers;
  const confirmedMarks = initialBundle.scores.filter((score) => score.scoreStatus === "confirmed").reduce((sum, score) => sum + score.awardedMarks, 0);
  const paperMarks = (initialBundle.savedPaperQuestions ?? []).reduce((sum, question) => sum + question.totalMarks, 0) || initialBundle.insights.totalMaxMarks;
  const activeTopicLabel = activeRow?.savedQuestion?.topicLabels?.[0];
  const confirmedRows = questionRows.filter((row) => row.score?.scoreStatus === "confirmed");
  const allConfirmed = questionRows.length > 0 && confirmedRows.length === questionRows.length;
  const weakTopics = Array.from(new Map(questionRows.flatMap((row) => row.score?.scoreStatus === "confirmed" && row.score.awardedMarks < row.score.maxMarks ? (row.savedQuestion?.canonicalLeafIds ?? []).map((id, index) => [id, row.savedQuestion?.topicLabels?.[index] ?? row.savedQuestion?.topicLabels?.[0] ?? id] as const) : [])).entries()).slice(0, 6);

  const progressItems = questionRows.map((row, index) => {
    const state = getQuestionState(row);
    let progressState: QuestionProgressState = "waiting";
    if (row.questionKey === activeQuestionKey) progressState = "current";
    else if (row.score?.scoreStatus === "confirmed" && !row.score.needsReview) progressState = "confirmed";
    else if (state === "review") progressState = "review";
    else if (state === "failed") progressState = "failed";
    else if (state === "ocr" || state === "scored" || state === "suggested") progressState = "ready";
    return { key: row.questionKey, label: String(index + 1).padStart(2, "0"), state: progressState };
  });

  const tools = (
    <>
      <div id="answer-pages" className="scroll-mt-4">
        <UploadMapping submissionId={submissionId} questions={mappingQuestions} initiallyOpen={initialBundle.pages.length === 0} onChange={() => router.refresh()} />
      </div>
      <MarkingSetupControls
        bundle={initialBundle}
        importState={isPending ? (isImportedSubmission && hasImportedPages ? "replacing" : "processing") : "idle"}
        canAutoScoreWholePaper={canAutoScoreWholePaper}
        autoScoreLoadingKey={autoScoreLoadingKey}
        reviewCount={reviewRows.length}
        processFinishedPaperPdf={processFinishedPaperPdf}
        autoScoreWholePaper={autoScoreWholePaper}
        showFeedback={showFeedback}
      />
    </>
  );

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 border-b border-text/10 pb-2 text-sm text-text-secondary">
        <Link href="/marking" className="inline-flex min-h-11 items-center hover:text-accent"><span aria-hidden="true" className="mr-1 md:hidden">‹</span>My papers</Link>
        <span aria-hidden="true" className="max-md:hidden">/</span><span className="max-md:hidden">{initialBundle.savedPaper?.title || initialBundle.submission.paperCode || "Saved paper"}</span>
      </nav>

      <header className="border-b border-text/10 pb-3 md:pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 text-[1.375rem] font-semibold leading-7 tracking-[-0.02em] text-text md:text-[2.25rem] md:leading-[2.75rem]">{initialBundle.savedPaper?.title || initialBundle.submission.studentLabel || "Untitled revision paper"}</h1>
              <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusToneClass(initialBundle.submission.status === "review_required" ? "review" : initialBundle.submission.status === "scored" ? "confirmed" : initialBundle.submission.status === "ocr_complete" ? "active" : "neutral")}`}>{formatStatus(initialBundle.submission.status)}</span>
            </div>
            <p className="mt-1 text-sm text-text-secondary">{activeTopicLabel ? `${activeTopicLabel} · ` : ""}{activeRow ? `${formatQuestionLabel({ questionNumber: activeRow.savedQuestion?.questionNumber, questionPartNumber: activeRow.savedQuestion?.questionPartNumber, questionPath: activeRow.savedQuestion?.questionPath, questionKey: activeRow.questionKey })} of ${questionRows.length} · ${activeRow.savedQuestion?.totalMarks ?? activeRow.score?.maxMarks ?? 0} marks` : initialBundle.submission.paperCode || "No paper reference yet"}</p>
          </div>
          <p className="text-base text-text-secondary"><span className="font-mono font-semibold tabular-nums text-text">{confirmedMarks} / {paperMarks}</span> confirmed · {confirmedRows.length} of {questionRows.length} questions</p>
        </div>
        {progressItems.length > 0 ? <div className="mt-2 overflow-x-auto pb-1 md:mt-4"><QuestionProgressRail items={progressItems} activeKey={activeQuestionKey} onSelect={setSelectedQuestionKey} /></div> : null}
      </header>

      {allConfirmed ? (
        <section aria-labelledby="paper-complete" className="rounded-[3px] border border-success/30 bg-white px-5 py-5">
          <h2 id="paper-complete" className="text-xl font-semibold text-text">Every mark is confirmed</h2>
          <p className="mt-1 text-base text-text-secondary"><span className="font-mono font-semibold tabular-nums text-text">{confirmedMarks} / {paperMarks}</span> across {questionRows.length} question{questionRows.length === 1 ? "" : "s"}.</p>
          {weakTopics.length > 0 ? <>
            <p className="mt-4 text-sm font-semibold text-text">Topics where marks were dropped</p>
            <ul className="mt-2 flex flex-wrap gap-2">{weakTopics.map(([id, label]) => <li key={id} className="rounded-md border border-text/15 bg-bg-soft px-2.5 py-1 text-sm text-text">{label}</li>)}</ul>
            <Link href={`/paper-maker?subject=${encodeURIComponent(initialBundle.submission.subjectKey)}&topics=${encodeURIComponent(weakTopics.map(([id]) => id).join(","))}`} className="mt-4 inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-deep">Practise these topics</Link>
            <p className="mt-2 text-sm text-text-secondary">Opens the paper builder with these topics chosen, so you can check them before creating anything.</p>
          </> : null}
        </section>
      ) : null}

      {hasImportedPages ? null : tools}
      {questionRows.length === 0 ? <div className="rounded-[3px] border border-dashed border-text/25 px-6 py-12 text-center text-base text-text-secondary">Add your first answer page to start reviewing this paper.</div> : activeRow ? (
        <div>
          <div className="min-w-0 py-3">
            <ActiveQuestionPanel
              key={activeRow.questionKey}
              row={activeRow}
              nextQuestion={nextQuestion}
              previousQuestion={previousQuestion}
              onSelect={setSelectedQuestionKey}
              runOcr={() => void runOcr(activeRow.questionKey)}
              ocrLoading={ocrLoadingKey === activeRow.questionKey}
              autoScore={() => void autoScore(activeRow.questionKey)}
              autoScoreLoading={autoScoreLoadingKey === activeRow.questionKey}
              onConfirm={(input) => confirmScore(activeRow.questionKey, input)}
              markScheme={{ entry: activeMarkSchemeEntry, preview: activeMarkSchemePreview, url: activeMarkSchemeUrl, pages: activeMarkSchemePages, loading: isLoadingCombinedMarkScheme, onLoad: () => void loadCombinedMarkScheme() }}
              onAddPages={openUploads}
              subjectKey={initialBundle.submission.subjectKey}
              feedback={showFeedback("upload") || showFeedback("ocr") || showFeedback("score") ? <div className="mb-3 space-y-2">{showFeedback("upload")}{showFeedback("ocr")}{showFeedback("score")}</div> : null}
            />
          </div>
        </div>
      ) : null}
      {hasImportedPages ? tools : null}
    </div>
  );
}
