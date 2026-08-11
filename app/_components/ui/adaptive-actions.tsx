"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

export type AdaptiveAction = {
  id: string;
  label: string;
  priority: number;
  onSelect: () => void;
  disabled?: boolean;
};

export function prioritizeActions(actions: AdaptiveAction[]) {
  return [...actions].sort((left, right) => right.priority - left.priority);
}

export function AdaptiveActions({ actions, label, className = "" }: { actions: AdaptiveAction[]; label: string; className?: string }) {
  const ordered = prioritizeActions(actions);
  const ref = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(ordered.length);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = new ResizeObserver(([entry]) => {
      const available = entry.contentRect.width;
      setVisibleCount(Math.max(1, Math.min(ordered.length, Math.floor((available - 52) / 132))));
    });
    resize.observe(element);
    return () => resize.disconnect();
  }, [ordered.length]);

  const visible = ordered.slice(0, visibleCount);
  const overflow = ordered.slice(visibleCount);

  return (
    <div ref={ref} aria-label={label} className={`flex min-w-0 items-center justify-end gap-2 ${className}`}>
      {visible.map((action) => (
        <button key={action.id} type="button" onClick={action.onSelect} disabled={action.disabled} className="btn-press min-h-10 whitespace-nowrap border border-text/15 bg-white px-3 text-[0.75rem] font-semibold text-text-secondary disabled:opacity-40">
          {action.label}
        </button>
      ))}
      {overflow.length ? (
        <details className="relative">
          <summary className="btn-press flex h-10 w-10 cursor-pointer list-none items-center justify-center border border-text/15 bg-white text-text-secondary" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></summary>
          <div className="absolute right-0 z-30 mt-2 min-w-48 border border-text/12 bg-bg-elevated p-1.5 shadow-[0_16px_44px_var(--shadow-lg)]">
            {overflow.map((action) => <button key={action.id} type="button" onClick={action.onSelect} disabled={action.disabled} className="block min-h-10 w-full px-3 text-left text-[0.75rem] font-semibold text-text-secondary hover:bg-bg-soft disabled:opacity-40">{action.label}</button>)}
          </div>
        </details>
      ) : null}
    </div>
  );
}
