import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-bg px-5 py-12">
      <section className="w-full max-w-xl text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[4px] border border-text/10 bg-bg-elevated text-accent">
          <FileQuestion className="h-6 w-6" strokeWidth={1.7} />
        </div>
        <h1 className="mt-7 text-[clamp(2rem,7vw,3.4rem)] font-bold leading-[1.02] tracking-[-0.045em] text-text">This page is not in the paper.</h1>
        <p className="mt-3 font-mono text-[0.7rem] text-text-subtle">Error 404</p>
        <p className="mx-auto mt-5 max-w-[48ch] text-[0.95rem] leading-7 text-text-muted">The link may be out of date, or the paper may no longer be available.</p>
        <Link href="/paper-maker" className="btn-press mt-8 inline-flex items-center gap-2 rounded-[4px] bg-accent px-5 py-3 text-[0.84rem] font-bold text-white hover:bg-accent-deep">
          <ArrowLeft className="h-4 w-4" />
          Return to paper builder
        </Link>
      </section>
    </main>
  );
}
