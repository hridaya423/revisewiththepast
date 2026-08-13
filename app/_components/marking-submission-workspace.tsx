"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { OperationNotice } from "@/app/_components/marking/presentation";
import { QuestionProgressRail, type QuestionProgressState } from "@/app/_components/marking/question-progress";
import { ActiveQuestionPanel } from "@/app/_components/marking/active-question-panel";
import { MarkingQuestionNavigation, MarkingSetupControls } from "@/app/_components/marking-workspace-sections";
import { autoScoreQuestion as requestAutoScoreQuestion, autoScoreWholePaper as requestAutoScoreWholePaper, formatQuestionLabel, formatStatus, getQuestionState, importFinishedPaper as requestImportFinishedPaper, loadCombinedMarkScheme as requestCombinedMarkScheme, parseScoreEvidence, prioritizeQuestion, runOcr as requestOcr, saveScore as requestSaveScore, uploadResponsePage as requestUploadResponsePage } from "@/features/papers/client";

import { buildQuestionRows, statusToneClass } from "@/app/_components/marking/model";
import type { CombinedMarkSchemeEntry, FeedbackScope, MarkingSubmissionBundle } from "@/app/_components/marking/model";

export function MarkingSubmissionWorkspace({ submissionId, initialBundle }: { submissionId: string; initialBundle: MarkingSubmissionBundle }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [operationFeedback, setOperationFeedback] = useState<{ scope: FeedbackScope; message: string } | null>(null);
  const [ocrLoadingKey, setOcrLoadingKey] = useState<string | null>(null);
  const [scoreLoadingKey, setScoreLoadingKey] = useState<string | null>(null);
  const [autoScoreLoadingKey, setAutoScoreLoadingKey] = useState<string | null>(null);
  const [combinedMarkScheme, setCombinedMarkScheme] = useState<{ entries: CombinedMarkSchemeEntry[]; combinedText: string; failures?: Array<{ questionKey: string; error: string }> } | null>(null);
  const [isLoadingCombinedMarkScheme, setIsLoadingCombinedMarkScheme] = useState(false);
  const [selectedQuestionKey, setSelectedQuestionKey] = useState<string | null>(null);
  const [pageLabel, setPageLabel] = useState("");
  const [pendingBulkFiles, setPendingBulkFiles] = useState<File[]>([]);

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
  const bulkUploadTargets = useMemo(() => questionRows.flatMap((row) => row.pages.length === 0 && row.savedQuestion ? [row.savedQuestion] : []), [questionRows]);
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

  const uploadPageForQuestion = (questionKey: string, file: File | null, questionNumberOverride?: string, questionPartNumberOverride?: string | null) => {
    if (!file) return;
    setOperationFeedback(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("submissionId", submissionId);
        formData.append("questionKey", questionKey);
        if (questionNumberOverride) formData.append("questionNumber", questionNumberOverride);
        if (questionPartNumberOverride) formData.append("questionPartNumber", questionPartNumberOverride);
        if (pageLabel.trim()) formData.append("pageLabel", pageLabel.trim());
        formData.append("file", file);
         await requestUploadResponsePage(formData);
        setPageLabel("");
        router.refresh();
      } catch (cause) {
        fail("upload", cause, "Could not upload response page.");
      }
    });
  };

  const uploadFinishedScriptPages = (files: File[]) => {
    const savedQuestions = initialBundle.savedPaperQuestions ?? [];
    if (files.length === 0) return;
    if (savedQuestions.length === 0) {
      setOperationFeedback({ scope: "bulk", message: "This submission needs a linked saved paper before script pages can be assigned automatically." });
      return;
    }
    const targetQuestions = questionRows.flatMap((row) => row.pages.length === 0 && row.savedQuestion ? [row.savedQuestion] : []);
    if (targetQuestions.length === 0) {
      setOperationFeedback({ scope: "bulk", message: "Every generated question already has an uploaded page. Use the per-question upload control for extra pages." });
      return;
    }
    if (files.length > targetQuestions.length) {
      setOperationFeedback({ scope: "bulk", message: `You selected ${files.length} pages but only ${targetQuestions.length} questions are still missing uploads. Extra pages were not assigned automatically.` });
    } else {
      setOperationFeedback(null);
    }
    startTransition(async () => {
      try {
        for (let index = 0; index < Math.min(files.length, targetQuestions.length); index += 1) {
          const file = files[index];
          const question = targetQuestions[index];
          const formData = new FormData();
          formData.append("submissionId", submissionId);
          formData.append("questionKey", question.unitKey);
          formData.append("questionNumber", question.questionNumber);
          if (question.questionPartNumber) formData.append("questionPartNumber", question.questionPartNumber);
          formData.append("pageLabel", `Script page ${index + 1}`);
          formData.append("file", file);
           await requestUploadResponsePage(formData);
        }
        setPageLabel("");
        setPendingBulkFiles([]);
        router.refresh();
      } catch (cause) {
        fail("bulk", cause, "Could not upload the selected answer images.");
      }
    });
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

  const saveScore = async (questionKey: string, formData: FormData) => {
    setScoreLoadingKey(questionKey);
    setOperationFeedback(null);
    const awardedMarks = Number(formData.get(`awarded-${questionKey}`) ?? 0);
    const maxMarks = Number(formData.get(`max-${questionKey}`) ?? 0);
    const rationale = String(formData.get(`rationale-${questionKey}`) ?? "").trim();
    const confidence = Number(formData.get(`confidence-${questionKey}`) ?? 0.5);
    const needsReview = formData.get(`review-${questionKey}`) === "on";
    const existingScore = initialBundle.scores.find((entry) => entry.questionKey === questionKey);
    const existingEvidence = parseScoreEvidence(existingScore?.evidenceJson);
    try {
      await requestSaveScore({ submissionId, questionKey, awardedMarks, maxMarks, confidence, needsReview, rationale, evidence: existingEvidence ?? { savedFrom: "marking-workspace" } });
      if (formData.get("saveAction") === "next" && nextQuestion) setSelectedQuestionKey(nextQuestion.questionKey);
      router.refresh();
    } catch (cause) {
      fail("score", cause, "Could not save score.");
    } finally {
      setScoreLoadingKey(null);
    }
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

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 border-b border-text/10 pb-3 text-[0.875rem] text-text-muted">
        <Link href="/marking" className="hover:text-accent">Mark your papers</Link><span aria-hidden="true">/</span><span>{initialBundle.savedPaper?.title || initialBundle.submission.paperCode || "Saved paper"}</span><span aria-hidden="true">/</span><span className="font-semibold text-text">{activeRow ? formatQuestionLabel({ questionNumber: activeRow.savedQuestion?.questionNumber, questionPartNumber: activeRow.savedQuestion?.questionPartNumber, questionKey: activeRow.questionKey }) : "Questions"}</span>
      </nav>

      <header className="border-b border-text/10 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[clamp(1.65rem,3vw,2.25rem)] font-bold leading-tight tracking-[-0.035em] text-text">{activeTopicLabel || initialBundle.savedPaper?.title || initialBundle.submission.studentLabel || "Untitled revision paper"}</h1>
              <span className={`border px-2 py-1 text-[0.75rem] font-semibold ${statusToneClass(initialBundle.submission.status === "review_required" ? "review" : initialBundle.submission.status === "scored" ? "confirmed" : initialBundle.submission.status === "ocr_complete" ? "active" : "neutral")}`}>{formatStatus(initialBundle.submission.status)}</span>
            </div>
            <p className="mt-1 text-[0.875rem] text-text-muted">{activeRow ? `${formatQuestionLabel({ questionNumber: activeRow.savedQuestion?.questionNumber, questionPartNumber: activeRow.savedQuestion?.questionPartNumber, questionPath: activeRow.savedQuestion?.questionPath, questionKey: activeRow.questionKey })} of ${questionRows.length} · ${activeRow.savedQuestion?.totalMarks ?? activeRow.score?.maxMarks ?? 0} marks` : initialBundle.submission.paperCode || "No paper reference yet"}</p>
          </div>
          <p className="text-[0.95rem] font-semibold tabular-nums text-text">{confirmedMarks} / {paperMarks} confirmed</p>
        </div>
        {progressItems.length > 0 ? <div className="mt-4 overflow-x-auto pb-1"><QuestionProgressRail items={progressItems} activeKey={activeQuestionKey} onSelect={setSelectedQuestionKey} /></div> : null}
      </header>

      <MarkingSetupControls
        bundle={initialBundle}
        setupStatus={{ importState: isPending ? (isImportedSubmission && hasImportedPages ? "replacing" : "processing") : "idle", canAutoScoreWholePaper }}
        autoScoreLoadingKey={autoScoreLoadingKey}
        isLoadingCombinedMarkScheme={isLoadingCombinedMarkScheme}
        combinedMarkScheme={combinedMarkScheme}
        pendingBulkFiles={pendingBulkFiles}
        bulkUploadTargets={bulkUploadTargets}
        reviewCount={reviewRows.length}
        processFinishedPaperPdf={processFinishedPaperPdf}
        autoScoreWholePaper={autoScoreWholePaper}
        loadCombinedMarkScheme={loadCombinedMarkScheme}
        setPendingBulkFiles={setPendingBulkFiles}
        uploadFinishedScriptPages={uploadFinishedScriptPages}
        showFeedback={showFeedback}
      />

      {questionRows.length === 0 ? <div className="border border-dashed border-text/15 px-6 py-12 text-center text-[0.8rem] text-text-muted">Upload the first response page to start reviewing this saved paper.</div> : activeRow ? (
        <div className="grid border-y border-text/10 xl:grid-cols-[12.5rem_minmax(0,1fr)]">
          <MarkingQuestionNavigation rows={questionRows} activeQuestionKey={activeQuestionKey} onSelect={setSelectedQuestionKey} />
          <div className="min-w-0 py-3 xl:pl-4">
            <ActiveQuestionPanel
              key={`${activeRow.questionKey}-${activeRow.score?.updatedAt ?? "empty"}`}
              row={activeRow}
              nextQuestion={nextQuestion}
              previousQuestion={previousQuestion}
              isPending={isPending}
              pageLabel={pageLabel}
              setPageLabel={setPageLabel}
              uploadPageForQuestion={uploadPageForQuestion}
              runOcr={runOcr}
              ocrLoadingKey={ocrLoadingKey}
              autoScore={autoScore}
              autoScoreLoadingKey={autoScoreLoadingKey}
              scoreLoadingKey={scoreLoadingKey}
              saveScore={saveScore}
              activeMarkSchemeEntry={activeMarkSchemeEntry}
              activeMarkSchemePreview={activeMarkSchemePreview}
              activeMarkSchemeUrl={activeMarkSchemeUrl}
              activeMarkSchemePages={activeMarkSchemePages}
              activeTopicLabel={activeTopicLabel}
              activeTopicIds={activeRow.savedQuestion?.canonicalLeafIds ?? []}
              subjectKey={initialBundle.submission.subjectKey}
              setSelectedQuestionKey={setSelectedQuestionKey}
              showFeedback={showFeedback}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
