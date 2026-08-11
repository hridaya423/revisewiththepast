"use client";

import { useEffect, useState } from "react";

export type OperationKind = "route" | "subject" | "paper" | "upload" | "ocr" | "score" | "save";

type OperationProgressProps = {
  kind: OperationKind;
  label: string;
  startedAt?: number;
  compact?: boolean;
  className?: string;
};

export function OperationProgress({ kind, label, startedAt, compact = false, className = "" }: OperationProgressProps) {
  const [elapsed, setElapsed] = useState(() => startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : null);

  useEffect(() => {
    if (!startedAt) return;
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return (
    <span
      role="status"
      aria-live="polite"
      data-operation={kind}
      className={`inline-flex items-center gap-2 text-text-secondary ${compact ? "text-[0.7rem]" : "text-[0.82rem]"} ${className}`}
    >
      <span className="operation-orbit" aria-hidden="true"><span /></span>
      <span>{label}{elapsed === null ? "" : ` · ${elapsed}s`}</span>
    </span>
  );
}
