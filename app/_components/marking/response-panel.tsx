"use client";

import Image from "next/image";
import { useState } from "react";
import { ExternalLink, FilePlus2, Minus, Plus, RotateCcw, ScanText } from "lucide-react";
import { MathRichText } from "@/app/_components/math-rich-text";
import type { QuestionRow } from "@/app/_components/marking/model";

const ZOOM_STEPS = [1, 1.5, 2, 3] as const;

function ScanViewer({ page, index, count }: { page: QuestionRow["pages"][number]; index: number; count: number }) {
  const [step, setStep] = useState(0);
  const zoom = ZOOM_STEPS[step];
  const label = page.pageLabel || (page.scriptPageNumber ? `Script page ${page.scriptPageNumber}` : page.fileName);
  return (
    <figure className="overflow-hidden rounded-[3px] border border-text/15 bg-white">
      <figcaption className="flex min-h-11 items-center justify-between gap-2 border-b border-text/10 px-3 text-sm text-text-secondary">
        <span className="min-w-0 truncate"><span className="font-semibold text-text">Page {index + 1}</span>{count > 1 ? ` of ${count}` : ""} · {label}</span>
        <span className="flex shrink-0 items-center" role="group" aria-label={`Zoom for page ${index + 1}`}>
          <button type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0} aria-label="Zoom out" className="flex h-11 w-11 items-center justify-center text-text-secondary hover:text-accent disabled:opacity-35"><Minus className="h-5 w-5" aria-hidden="true" /></button>
          <span className="w-11 text-center font-mono text-xs tabular-nums text-text-secondary" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setStep((current) => Math.min(ZOOM_STEPS.length - 1, current + 1))} disabled={step === ZOOM_STEPS.length - 1} aria-label="Zoom in" className="flex h-11 w-11 items-center justify-center text-text-secondary hover:text-accent disabled:opacity-35"><Plus className="h-5 w-5" aria-hidden="true" /></button>
          {step > 0 ? <button type="button" onClick={() => setStep(0)} className="min-h-11 px-2 text-sm font-semibold text-accent">Reset view</button> : null}
        </span>
      </figcaption>
      <div className="max-h-[70vh] overflow-auto bg-bg-soft overscroll-contain" tabIndex={step > 0 ? 0 : undefined} aria-label={step > 0 ? `Zoomed page ${index + 1}; scroll to see every edge` : undefined}>
        <Image
          src={page.sourceImageUrl}
          alt={`Your answer, page ${index + 1}`}
          width={1200}
          height={1600}
          unoptimized
          className="block h-auto max-w-none object-contain"
          style={{ width: `${zoom * 100}%` }}
        />
      </div>
      <div className="flex justify-end border-t border-text/10 px-3">
        <a href={page.sourceImageUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent">Open full size <ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
      </div>
    </figure>
  );
}

export function ResponsePanel({ row, ocrLoading, onRunOcr, onAddPages }: {
  row: QuestionRow;
  ocrLoading: boolean;
  onRunOcr: () => void;
  onAddPages: () => void;
}) {
  return (
    <div className="space-y-5">
      {row.savedQuestion?.promptText ? (
        <section aria-label="Question">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-secondary">Question</p>
          <MathRichText text={row.savedQuestion.promptText} className="mt-2 font-serif text-lg leading-7 text-text" />
          {row.savedQuestion.contextText ? <MathRichText text={row.savedQuestion.contextText} className="mt-2 text-base leading-6 text-text-secondary" /> : null}
        </section>
      ) : null}

      {row.pages.length > 0 ? (
        <div className="space-y-4">{row.pages.map((page, index) => <ScanViewer key={page._id} page={page} index={index} count={row.pages.length} />)}</div>
      ) : (
        <div className="rounded-[3px] border border-dashed border-text/25 bg-bg-soft px-5 py-10 text-center">
          <p className="text-base font-semibold text-text">No answer page for this question yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-5 text-text-secondary">Add a photo or scan of your working, then choose which questions it shows.</p>
          <button type="button" onClick={onAddPages} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-accent px-4 text-sm font-semibold text-accent hover:bg-accent-soft"><FilePlus2 className="h-5 w-5" aria-hidden="true" />Add answer pages</button>
        </div>
      )}

      {row.pages.length > 0 ? (
        <section aria-labelledby={`transcript-${row.questionKey}`} className="border-t border-text/10 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 id={`transcript-${row.questionKey}`} className="flex items-center gap-2 text-sm font-semibold text-text"><ScanText className="h-5 w-5 text-info" aria-hidden="true" />What we read</h4>
            <button type="button" onClick={onRunOcr} disabled={ocrLoading} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent disabled:opacity-50"><RotateCcw className={`h-4 w-4 ${ocrLoading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />{ocrLoading ? "Reading answer…" : row.response ? "Read again" : "Read answer"}</button>
          </div>
          {row.response?.ocrText
            ? <MathRichText text={row.response.ocrText} className="mt-2 whitespace-pre-line text-base leading-7 text-text-secondary" />
            : <p className="mt-2 text-sm leading-5 text-text-secondary">Not read yet. Reading turns your handwriting into text so it can be compared with the mark scheme.</p>}
        </section>
      ) : null}
    </div>
  );
}
