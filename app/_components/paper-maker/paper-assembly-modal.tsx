"use client";

import { useEffect, useRef } from "react";

import { DotCutCanvas } from "@/app/_components/paper-maker/dotcut/dotcut-canvas";
import { SubjectEmboss } from "@/app/_components/paper-maker/subject-emboss";

type PaperAssemblyModalProps = {
  includeMarkScheme: boolean;
  paperCount: number;
  subjectKey: string;
  subjectLabel: string;
  progress?: { message: string; progress: number } | null;
  onCancel?: () => void;
};

export function PaperAssemblyModal({ includeMarkScheme, paperCount, subjectKey, subjectLabel, progress, onCancel }: PaperAssemblyModalProps) {
  const modalRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = modalRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (dialog && !dialog.open) dialog.showModal();
    dialog?.focus({ preventScroll: true });
    return () => {
      if (dialog?.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog ref={modalRef} className="assembly-dialog" aria-busy="true" aria-labelledby="assembly-title" aria-describedby="assembly-description" tabIndex={-1} onCancel={(event) => event.preventDefault()}>
      <div className="assembly-surface">
        <div className="assembly-visual"><DotCutCanvas /></div>

        <div className="assembly-copy" role="status" aria-live="polite">
          <div className="flex items-center gap-3.5">
            <SubjectEmboss subjectKey={subjectKey} surface="#F3EFE6" size={42} />
            <div><p className="font-mono text-[0.56rem] font-bold uppercase tracking-[0.17em] text-accent">Preparing download</p><p className="mt-1 text-[0.65rem] text-text-muted">{subjectLabel}</p></div>
          </div>
          <h2 id="assembly-title" className="mt-5 font-serif text-[clamp(1.8rem,5vw,2.45rem)] font-semibold leading-[1.03] tracking-[-0.045em] text-text">Assembling your {paperCount > 1 ? "papers" : "paper"}</h2>
          <p id="assembly-description" className="mt-4 text-[0.78rem] leading-5 text-text-muted">Selecting {subjectLabel} questions and laying out each page{includeMarkScheme ? " with the matching mark scheme" : ""}.</p>
          <dl className="mt-7 border-y border-text/12 font-mono text-[0.61rem]">
            <div className="flex items-center justify-between gap-4 border-b border-text/10 py-3"><dt className="text-text-subtle">Course</dt><dd className="max-w-[65%] text-right font-semibold text-text-secondary">{subjectLabel}</dd></div>
            <div className="flex items-center justify-between gap-4 py-3"><dt className="text-text-subtle">Output</dt><dd className="text-right font-semibold text-text-secondary">{paperCount} {paperCount === 1 ? "paper" : "papers"}{includeMarkScheme ? " + mark scheme" : ""}</dd></div>
          </dl>
          <div className="mt-6">
            <div className="flex items-center justify-between gap-4 font-mono text-[0.61rem]">
              <span className="text-text-secondary">{progress?.message ?? "Starting generation"}</span>
              <span className="font-semibold text-text">{Math.round((progress?.progress ?? 0) * 100)}%</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-text/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress?.progress ?? 0) * 100)} aria-label="Generation progress">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${Math.round((progress?.progress ?? 0) * 100)}%` }} />
            </div>
          </div>
          <div className="mt-5 flex items-center justify-between gap-4">
            <p className="text-[0.67rem] leading-5 text-text-subtle">Keep this tab open. The download starts as soon as the document is ready.</p>
            {onCancel ? <button type="button" onClick={onCancel} className="shrink-0 text-[0.67rem] font-semibold text-text-muted underline-offset-2 hover:text-text hover:underline">Cancel</button> : null}
          </div>
        </div>
      </div>
    </dialog>
  );
}
