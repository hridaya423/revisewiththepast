"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createMarkingSubmission } from "@/features/papers/client";

export default function StartMarkingPage({ params }: { params: Promise<{ savedPaperId: string }> }) {
  const { savedPaperId } = use(params);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    let ignore = false;
    const startMarking = async () => {
      try {
        const payload = await createMarkingSubmission({ savedPaperId });
        if (!ignore) router.replace(`/marking/${payload.submissionId}`);
      } catch (cause) {
        if (!ignore) setError(cause instanceof Error ? cause.message : "Could not start marking this paper.");
      }
    };
    void startMarking();
    return () => { ignore = true; };
  }, [router, savedPaperId]);

  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-accent">Marking studio</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-text">{error ? "Marking could not start" : "Preparing your paper…"}</h1>
      {error ? <><p className="mt-3 text-sm leading-6 text-danger">{error}</p><Link href="/marking" className="btn-press mt-6 inline-flex bg-accent px-5 py-3 text-sm font-bold text-white">Return to marking studio</Link></> : <p className="mt-3 text-sm text-text-muted">Creating a marking submission from your saved paper.</p>}
    </div>
  );
}
