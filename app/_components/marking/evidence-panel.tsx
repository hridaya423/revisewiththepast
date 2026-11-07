"use client";

import { ExternalLink } from "lucide-react";
import { MathRichText } from "@/app/_components/math-rich-text";
import type { CombinedMarkSchemeEntry } from "@/app/_components/marking/model";

export function EvidencePanel({ entry, preview, url, pages, loading, onLoad }: {
  entry: CombinedMarkSchemeEntry | null;
  preview: string | null;
  url: string | undefined;
  pages: number[] | undefined;
  loading: boolean;
  onLoad: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {entry ? <p className="text-sm text-text-secondary">{entry.label}{pages?.length ? ` · page${pages.length === 1 ? "" : "s"} ${pages.join(", ")}` : ""}</p> : null}
        {url ? <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent">Open PDF <ExternalLink className="h-4 w-4" aria-hidden="true" /></a> : null}
      </div>
      {preview ? (
        <div className="rounded-[3px] border-l-2 border-success/50 bg-white px-4 py-3">
          <MathRichText text={preview} className="text-base leading-7 text-text" />
        </div>
      ) : (
        <div className="rounded-[3px] border border-dashed border-text/25 bg-bg-soft px-4 py-6">
          <p className="text-sm leading-5 text-text-secondary">{loading ? "Loading the mark scheme for this question…" : "The mark scheme for this question isn’t loaded yet."}</p>
          {!loading ? <button type="button" onClick={onLoad} className="mt-3 inline-flex min-h-11 items-center rounded-md border border-accent px-4 text-sm font-semibold text-accent hover:bg-accent-soft">Load mark scheme</button> : null}
        </div>
      )}
    </div>
  );
}
