"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";

import { downloadMarkSchemePdfs } from "./download-mark-schemes";
import type { GenerationResult } from "./types";

export function SuccessModal({
  result,
  subjectKey,
  subjectTier,
  subjectLabel,
  tierLabel,
  minutesPerMark,
  isAuthenticated,
  onOpenMarking,
  onClose,
  onBuildAnother,
}: {
  result: GenerationResult;
  subjectKey: string;
  subjectTier?: string;
  subjectLabel: string;
  tierLabel?: string;
  minutesPerMark: number;
  isAuthenticated: boolean;
  onOpenMarking: () => Promise<void>;
  onClose: () => void;
  onBuildAnother: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = "paper-ready-title";
  const [markSchemeState, setMarkSchemeState] = useState<{ status: "idle" | "loading" | "error" | "warning"; message?: string }>({ status: "idle" });
  const [markingState, setMarkingState] = useState<{ status: "idle" | "loading" | "error"; message?: string }>({ status: "idle" });
  const hasUnitKeys = result.markSchemeUnitKeys.some((keys) => keys.length > 0);

  const openMarkingStudio = async () => {
    setMarkingState({ status: "loading" });
    try {
      await onOpenMarking();
    } catch (cause) {
      setMarkingState({ status: "error", message: cause instanceof Error ? cause.message : "Could not start marking this paper." });
    }
  };

  const generateMarkScheme = async () => {
    if (!hasUnitKeys) {
      setMarkSchemeState({ status: "error", message: "Mark scheme is only available for a freshly generated paper." });
      return;
    }
    setMarkSchemeState({ status: "loading" });
    const outcome = await downloadMarkSchemePdfs({ unitKeysByPaper: result.markSchemeUnitKeys, subjectKey, subjectTier });
    const generated = outcome.generated;
    const warning = outcome.warning;
    if (!generated) setMarkSchemeState({ status: "error", message: warning ?? "Could not generate the mark scheme." });
    else setMarkSchemeState(warning ? { status: "warning", message: warning } : { status: "idle" });
  };

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-text/30 p-4 backdrop-blur-[3px]" onClick={onClose}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="max-h-[calc(100dvh-2rem)] w-full max-w-[520px] overflow-y-auto border border-text/15 bg-bg-workspace shadow-[0_24px_70px_rgba(13,23,52,0.2)] outline-none" onClick={(event) => event.stopPropagation()}>
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-5">
            <div>
              <h3 id={titleId} className="text-[1.7rem] font-semibold tracking-[-0.05em] text-text">Paper ready.</h3>
              <p className="mt-1.5 max-w-[42ch] text-[0.78rem] leading-5 text-text-muted">Your custom {result.paperCount === 1 ? "paper has" : `${result.paperCount} papers have`} been generated and downloaded.</p>
            </div>
            <button type="button" onClick={onClose} className="btn-press -mr-2 -mt-2 flex h-9 w-9 shrink-0 items-center justify-center text-text-muted hover:bg-white/70 hover:text-text" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>

          <section className="mt-6 border-y border-text/12 py-5" aria-label="Generated paper summary">
            <p className="text-[0.65rem] font-bold tracking-[-0.01em] text-accent">{subjectLabel}{tierLabel ? ` · ${tierLabel}` : ""}</p>
            <dl className="mt-4 grid grid-cols-3 divide-x divide-text/10">
              <div className="pr-4"><dt className="text-[0.6rem] text-text-muted">Papers</dt><dd className="mt-1 font-mono text-[1.05rem] font-semibold tabular-nums text-text">{result.paperCount}</dd></div>
              <div className="px-4"><dt className="text-[0.6rem] text-text-muted">Marks</dt><dd className="mt-1 font-mono text-[1.05rem] font-semibold tabular-nums text-text">{result.totalMarks}</dd></div>
              <div className="pl-4"><dt className="text-[0.6rem] text-text-muted">Duration</dt><dd className="mt-1 font-mono text-[1.05rem] font-semibold tabular-nums text-text">{result.timeMinutes} min</dd></div>
            </dl>
            <p className="mt-4 text-[0.6rem] text-text-muted">About {minutesPerMark.toFixed(2)} minutes per mark</p>
          </section>

          <div className="mt-5 space-y-3">
            {result.markSchemeGenerated ? <div className="flex items-center gap-2 border-l-2 border-success bg-success-soft/70 px-3 py-2.5 text-[0.7rem] font-semibold text-success"><Check className="h-3.5 w-3.5 shrink-0" />{result.paperCount > 1 ? "Papers and mark schemes downloaded" : "Paper and mark scheme downloaded"}</div> : <button type="button" onClick={generateMarkScheme} disabled={!hasUnitKeys || markSchemeState.status === "loading"} className="btn-press inline-flex min-h-10 w-full items-center justify-center border border-text/12 bg-white/55 px-4 text-[0.7rem] font-semibold text-text-secondary hover:border-accent/50 hover:text-accent disabled:opacity-50">{markSchemeState.status === "loading" ? "Building mark scheme…" : result.paperCount > 1 ? `Generate ${result.paperCount} mark schemes` : "Generate mark scheme"}</button>}
            {markSchemeState.status === "error" ? <p className="text-[0.7rem] text-danger">{markSchemeState.message}</p> : null}
            {markSchemeState.status === "warning" ? <p className="text-[0.7rem] text-warning">{markSchemeState.message}</p> : null}
            {result.markSchemeWarning ? <p className="text-[0.7rem] text-warning">{result.markSchemeWarning}</p> : null}
            {result.saveWarning ? <p className="border-l-2 border-warning bg-warning-soft px-3 py-2.5 text-[0.7rem] leading-5 text-text-secondary">{result.saveWarning}</p> : null}
            <div className="grid gap-2.5 sm:grid-cols-2">
              {result.saveWarning && isAuthenticated ? null : <button type="button" onClick={openMarkingStudio} disabled={markingState.status === "loading"} className="btn-press inline-flex min-h-11 items-center justify-center border border-text/15 bg-white px-4 text-[0.7rem] font-semibold text-text hover:border-accent hover:text-accent disabled:opacity-50">{markingState.status === "loading" ? "Opening studio…" : "Open marking studio"}</button>}
              <button type="button" onClick={onClose} className={`btn-press inline-flex min-h-11 items-center justify-center gap-2 bg-accent px-4 text-[0.7rem] font-bold text-white hover:bg-accent-deep ${result.saveWarning && isAuthenticated ? "sm:col-span-2" : ""}`}>Back to builder<ArrowRight className="h-3.5 w-3.5" /></button>
            </div>
            {markingState.status === "error" ? <p className="text-[0.7rem] text-danger">{markingState.message}</p> : null}
            <button type="button" onClick={onBuildAnother} className="btn-press mx-auto block px-4 py-2 text-[0.68rem] font-semibold text-text-muted hover:text-accent">Build another paper</button>
          </div>
        </div>
      </div>
    </div>
  );
}
