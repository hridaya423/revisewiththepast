"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-bg px-5 py-12">
      <section className="w-full max-w-lg border-t border-text/15 pt-7 sm:pt-9">
        <div className="flex h-10 w-10 items-center justify-center rounded-[4px] bg-danger-soft text-danger">
          <TriangleAlert className="h-5 w-5" />
        </div>
        <h1 className="mt-6 text-[2rem] font-bold leading-tight tracking-[-0.035em] text-text">We could not load this page.</h1>
        <p className="mt-3 max-w-[48ch] text-base leading-7 text-text-secondary">The service may be temporarily unavailable. Try again, or return home.</p>
        <button type="button" onClick={reset} className="btn-press mt-7 inline-flex items-center gap-2 rounded-[4px] bg-accent px-4 py-3 text-[0.82rem] font-bold text-white hover:bg-accent-deep">
          <RotateCcw className="h-4 w-4" />
          Try this page again
        </button>
        <Link href="/" className="ml-4 inline-flex min-h-12 items-center text-sm font-semibold text-accent">Return home</Link>
      </section>
    </main>
  );
}
