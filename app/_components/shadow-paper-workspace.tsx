"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, FileText, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { useAuth } from "@/app/_components/auth-provider";
import { ActionButton } from "@/app/_components/ui/action-button";
import { InlineNotice } from "@/app/_components/ui/inline-notice";
import { OperationProgress } from "@/app/_components/ui/operation-progress";
import { ShadowApiError, shadowApi, type ShadowSourcePaper } from "@/features/papers/shadow/presentation/api-client";
import {
  downloadHref,
  initialShadowState,
  isWaiting,
  newIdempotencyKey,
  pollDelay,
  progressLabel,
  shadowPageHref,
  shadowReducer,
  signInHref,
} from "@/features/papers/shadow/presentation/state";

type ShadowPaperWorkspaceProps = {
  papers: ShadowSourcePaper[];
  enabled: boolean;
  initialPaperId: string | null;
  initialJobId: string | null;
};

const sessionLabel = (paper: ShadowSourcePaper) => `${paper.session === "june" ? "June" : "November"} ${paper.year}`;
const tierLabel = (paper: ShadowSourcePaper) => (paper.tier === "higher" ? "Higher" : "Foundation");
const calculatorLabel = (paper: ShadowSourcePaper) => (paper.calculator === "not-allowed" ? "Non-calculator" : "Calculator");

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function PaperFacts({ paper }: { paper: ShadowSourcePaper }) {
  return (
    <dl className="mt-3 grid grid-cols-3 border-y border-text/10 text-center">
      {[
        [String(paper.durationMinutes), "minutes"],
        [String(paper.totalMarks), "marks"],
        [String(paper.questionCount), "questions"],
      ].map(([value, label]) => (
        <div key={label} className="border-r border-text/10 py-3 last:border-r-0">
          <dt className="sr-only">{label}</dt>
          <dd className="font-mono text-lg font-semibold text-text">{value}</dd>
          <dd className="text-xs font-medium text-text-muted">{label}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ShadowPaperWorkspace({ papers, enabled, initialPaperId, initialJobId }: ShadowPaperWorkspaceProps) {
  const router = useRouter();
  const { isAuthenticated, isLoaded } = useAuth();
  const validInitial = papers.some((paper) => paper.sourcePaperId === initialPaperId) ? initialPaperId : papers.length === 1 ? papers[0]!.sourcePaperId : null;
  const [state, dispatch] = useReducer(shadowReducer, { sourcePaperId: validInitial, jobId: initialJobId }, initialShadowState);
  const pollAttempt = useRef(0);
  const statusRef = useRef<HTMLHeadingElement>(null);

  const selected = useMemo(() => papers.find((paper) => paper.sourcePaperId === state.sourcePaperId) ?? null, [papers, state.sourcePaperId]);
  const jobId = state.phase === "running" || state.phase === "ready" ? state.job.jobId : state.phase === "restoring" ? state.jobId : null;

  const syncUrl = useCallback((sourcePaperId: string | null, nextJobId: string | null) => {
    router.replace(shadowPageHref({ sourcePaperId, jobId: nextJobId }), { scroll: false });
  }, [router]);

  useEffect(() => {
    if (state.phase !== "starting" || !selected) return;
    let cancelled = false;
    shadowApi.start({ sourcePaperId: selected.sourcePaperId, manifestRevision: selected.manifestRevision, idempotencyKey: state.idempotencyKey })
      .then((job) => {
        if (cancelled) return;
        dispatch({ type: "job", job });
        syncUrl(job.sourcePaperId, job.jobId);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const code = error instanceof ShadowApiError ? error.code : "UNKNOWN";
        dispatch({ type: "start-failed", code, message: error instanceof Error ? error.message : "Could not start generation." });
        if (code === "MANIFEST_STALE") router.refresh();
      });
    return () => {
      cancelled = true;
    };
  }, [state, selected, router, syncUrl]);

  useEffect(() => {
    if (!isWaiting(state) || !jobId || !isAuthenticated) return;
    let stopped = false;
    const tick = async () => {
      try {
        const job = await shadowApi.job(jobId);
        if (stopped) return;
        pollAttempt.current += 1;
        dispatch({ type: "online" });
        dispatch({ type: "job", job });
      } catch (error) {
        if (stopped) return;
        if (error instanceof ShadowApiError && error.status === 404) {
          dispatch({ type: "job-missing" });
          syncUrl(state.sourcePaperId, null);
          return;
        }
        if (error instanceof ShadowApiError && error.code === "NETWORK") dispatch({ type: "offline" });
      }
    };
    const delay = state.phase === "restoring" ? 0 : pollDelay(pollAttempt.current, state.phase === "running" && state.offline);
    const timer = window.setTimeout(() => void tick(), delay);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [state, jobId, isAuthenticated, syncUrl]);

  useEffect(() => {
    if (!isAuthenticated || initialJobId || state.phase !== "choose") return;
    let cancelled = false;
    shadowApi.activeJob().then((job) => {
      if (cancelled || !job) return;
      dispatch({ type: "job", job });
      syncUrl(job.sourcePaperId, job.jobId);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    const offline = () => dispatch({ type: "offline" });
    const online = () => dispatch({ type: "online" });
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);

  useEffect(() => {
    if (state.phase === "ready" || state.phase === "failed" || state.phase === "cancelled" || state.phase === "expired") statusRef.current?.focus();
  }, [state.phase]);

  const start = () => {
    pollAttempt.current = 0;
    dispatch({ type: "start", idempotencyKey: newIdempotencyKey(crypto.getRandomValues(new Uint8Array(32))) });
  };

  const cancel = async () => {
    if (state.phase !== "running") return;
    dispatch({ type: "cancel" });
    try {
      dispatch({ type: "job", job: await shadowApi.cancel(state.job.jobId) });
    } catch {
      dispatch({ type: "cancel-failed" });
    }
  };

  const save = async () => {
    if (state.phase !== "ready") return;
    dispatch({ type: "save" });
    try {
      const result = await shadowApi.save(state.variant.variantId);
      dispatch({ type: "saved", savedPaperId: result.savedPaperId });
    } catch {
      dispatch({ type: "save-failed" });
    }
  };

  const backToChooser = () => {
    dispatch({ type: "back" });
    syncUrl(state.sourcePaperId, null);
  };

  const locked = state.phase === "starting" || state.phase === "running" || state.phase === "restoring";

  return (
    <div className="pb-24 lg:pb-0">
      <header className="mx-auto max-w-[1180px] pb-5">
        <Link href="/paper-maker" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-accent">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Build a topic paper instead
        </Link>
        <h1 className="mt-2 text-[clamp(1.85rem,3vw,2.55rem)] font-bold leading-tight tracking-[-0.05em] text-text">Shadow paper</h1>
        <p className="mt-1.5 max-w-[62ch] text-sm leading-6 text-text-muted">
          Pick a real past paper. Every question keeps its structure and marks, with new numbers, and you get a matching worked mark scheme.
        </p>
      </header>

      <div className="mx-auto grid max-w-[1180px] gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="shadow-source-heading">
          <h2 id="shadow-source-heading" className="text-[1.08rem] font-semibold tracking-[-0.035em] text-text">Choose a paper</h2>
          {papers.length === 0 ? (
            <p className="mt-3 border-y border-text/10 py-6 text-sm text-text-muted">No shadow papers are available yet.</p>
          ) : (
            <fieldset className="mt-3 border-t border-text/12" disabled={locked}>
              <legend className="sr-only">Source paper</legend>
              {papers.map((paper) => {
                const checked = paper.sourcePaperId === state.sourcePaperId;
                return (
                  <label
                    key={paper.sourcePaperId}
                    className={`flex cursor-pointer items-start gap-4 border-b border-text/12 px-1 py-4 transition-colors duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${checked ? "bg-accent-soft/60" : "hover:bg-bg-soft"} ${locked ? "cursor-default opacity-70" : ""}`}
                  >
                    <input
                      type="radio"
                      name="shadow-source"
                      value={paper.sourcePaperId}
                      checked={checked}
                      onChange={() => {
                        dispatch({ type: "select", sourcePaperId: paper.sourcePaperId });
                        syncUrl(paper.sourcePaperId, null);
                      }}
                      className="mt-1 h-4 w-4 accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-text">{sessionLabel(paper)} · {paper.paperTitle}</span>
                      <span className="mt-0.5 block text-sm text-text-secondary">{paper.board.label} GCSE {paper.subject.label} · {tierLabel(paper)} tier</span>
                      <span className="mt-1.5 block font-mono text-xs text-text-muted">
                        {paper.specCode}/{paper.componentCode} · {paper.durationMinutes} min · {paper.totalMarks} marks · {calculatorLabel(paper)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
        </section>

        <aside aria-labelledby="shadow-summary-heading" className="lg:sticky lg:top-24 lg:self-start">
          <div className="border border-text/12 bg-white p-5">
            {selected ? (
              <>
                <p className="font-mono text-xs text-text-muted">{selected.board.label} {selected.specCode}/{selected.componentCode}</p>
                <h2 id="shadow-summary-heading" className="mt-1 text-lg font-semibold tracking-[-0.03em] text-text">{sessionLabel(selected)} {selected.paperTitle}</h2>
                <p className="mt-1 text-sm text-text-secondary">{tierLabel(selected)} tier · first sat {formatDate(selected.sittingDate)}</p>
                <PaperFacts paper={selected} />
                <p className="mt-3 text-sm leading-6 text-text-secondary">
                  {selected.unchangedQuestionCount === 0
                    ? `All ${selected.questionCount} questions get new numbers.`
                    : `${selected.questionCount - selected.unchangedQuestionCount} of ${selected.questionCount} questions get new numbers; ${selected.unchangedQuestionCount} stay as printed.`}
                </p>
              </>
            ) : (
              <h2 id="shadow-summary-heading" className="text-lg font-semibold text-text">Choose a paper to begin</h2>
            )}

            <div className="mt-5" aria-live="polite">
              <ShadowAction
                state={state}
                enabled={enabled}
                hasSelection={Boolean(selected)}
                isAuthenticated={isAuthenticated}
                authLoaded={isLoaded}
                statusRef={statusRef}
                onStart={start}
                onCancel={cancel}
                onSave={save}
                onBack={backToChooser}
              />
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-text-muted">Independent practice material, not produced or endorsed by the exam board. Mark it with the scheme that shows the same variant code.</p>
        </aside>
      </div>
    </div>
  );
}

type ShadowActionProps = {
  state: ReturnType<typeof initialShadowState>;
  enabled: boolean;
  hasSelection: boolean;
  isAuthenticated: boolean;
  authLoaded: boolean;
  statusRef: React.RefObject<HTMLHeadingElement | null>;
  onStart(): void;
  onCancel(): void;
  onSave(): void;
  onBack(): void;
};

const primary = "btn-press flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-accent px-5 text-sm font-bold text-white hover:bg-accent-deep disabled:opacity-40";
const secondary = "btn-press flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-text/15 bg-white px-4 text-sm font-semibold text-text-secondary hover:border-accent hover:text-accent";

function ShadowAction({ state, enabled, hasSelection, isAuthenticated, authLoaded, statusRef, onStart, onCancel, onSave, onBack }: ShadowActionProps) {
  switch (state.phase) {
    case "restoring":
      if (authLoaded && !isAuthenticated) return <Link href={signInHref(state.sourcePaperId)} className={primary}>Sign in to see your paper</Link>;
      return <OperationProgress kind="paper" label="Finding your shadow paper" compact />;
    case "starting":
      return <OperationProgress kind="paper" label="Starting" compact />;
    case "running":
      return (
        <div className="space-y-3">
          <OperationProgress kind="paper" label={progressLabel(state.job)} startedAt={state.job.createdAt} compact />
          <div className="h-1 w-full overflow-hidden bg-text/8" aria-hidden="true">
            <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${stageProgress(state.job)}%` }} />
          </div>
          {state.offline ? <InlineNotice tone="review" message="Connection lost. Your paper keeps generating; we will check again when you are back online." /> : null}
          <p className="text-xs text-text-muted">You can leave this page. Your paper keeps generating and will be here when you come back.</p>
          <button type="button" onClick={onCancel} disabled={state.cancelling} className={secondary}>{state.cancelling ? "Cancelling…" : "Cancel"}</button>
        </div>
      );
    case "ready":
      return (
        <div className="space-y-3">
          <h3 ref={statusRef} tabIndex={-1} className="flex items-center justify-between gap-3 text-sm font-semibold text-success outline-none">
            <span>Your shadow paper is ready</span>
            <span className="font-mono text-xs text-text">{state.variant.displayCode}</span>
          </h3>
          <a href={downloadHref(state.variant.variantId, "paper")} className={primary} download>
            <Download className="h-4 w-4" aria-hidden="true" />Download paper
          </a>
          <a href={downloadHref(state.variant.variantId, "mark-scheme")} className={secondary} download>
            <FileText className="h-4 w-4" aria-hidden="true" />Download mark scheme
          </a>
          <ActionButton
            state={state.save.status === "pending" ? "pending" : state.save.status === "saved" ? "success" : state.save.status === "error" ? "error" : "idle"}
            idleLabel="Save paper"
            pendingLabel="Saving"
            successLabel="Saved to your papers"
            errorLabel="Save failed. Try again"
            disabled={state.save.status === "saved"}
            onClick={onSave}
            className={secondary}
          />
          {state.save.status === "saved" ? <Link href="/marking" className="block text-center text-sm font-semibold text-accent">Open saved papers</Link> : null}
          <button type="button" onClick={onStart} className={secondary}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Generate another version
          </button>
          {state.variant.expiresAt && state.save.status !== "saved" ? (
            <p className="text-xs text-text-muted">Unsaved papers are kept until {new Date(state.variant.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.</p>
          ) : null}
        </div>
      );
    case "failed":
      return (
        <div className="space-y-3">
          <h3 ref={statusRef} tabIndex={-1} className="sr-only">Generation stopped</h3>
          <InlineNotice tone="failure" message={state.message} />
          {enabled ? <button type="button" onClick={onStart} className={primary}>Try again</button> : null}
          <button type="button" onClick={onBack} className={secondary}>Choose another paper</button>
        </div>
      );
    case "cancelled":
      return (
        <div className="space-y-3">
          <h3 ref={statusRef} tabIndex={-1} className="text-sm font-semibold text-text outline-none">Generation cancelled</h3>
          {enabled ? <button type="button" onClick={onStart} className={primary}>Generate shadow paper</button> : null}
          <button type="button" onClick={onBack} className={secondary}>Choose another paper</button>
        </div>
      );
    case "expired":
      return (
        <div className="space-y-3">
          <h3 ref={statusRef} tabIndex={-1} className="sr-only">Result expired</h3>
          <InlineNotice tone="review" message="This unsaved shadow paper has expired. Generate a new version of the same paper." />
          {enabled ? <button type="button" onClick={onStart} className={primary}>Generate a new version</button> : null}
        </div>
      );
    case "choose":
      return (
        <div className="space-y-3">
          {state.notice ? <InlineNotice tone="review" message={state.notice} /> : null}
          {!enabled ? (
            <InlineNotice tone="review" message="Shadow paper generation is turned off right now. Saved shadow papers are still available." />
          ) : authLoaded && !isAuthenticated ? (
            <Link href={signInHref(state.sourcePaperId)} className={`${primary} ${hasSelection ? "" : "pointer-events-none opacity-40"}`} aria-disabled={!hasSelection}>
              Sign in to generate
            </Link>
          ) : (
            <button type="button" onClick={onStart} disabled={!hasSelection || !authLoaded} className={primary}>Generate shadow paper</button>
          )}
        </div>
      );
  }
}

function stageProgress(job: { status: string; progress: { completedUnits: number; totalUnits: number } }) {
  if (job.status === "queued") return 4;
  if (job.status === "generating") return 8 + 52 * (job.progress.completedUnits / Math.max(1, job.progress.totalUnits));
  if (job.status === "validating") return 66;
  if (job.status === "rendering") return 82;
  return 100;
}
