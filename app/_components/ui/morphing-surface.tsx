"use client";

import { useId, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";

import { motionTokens } from "./motion-tokens";

type MorphingSurfaceProps = {
  title: string;
  trigger: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

export function MorphingSurface({ title, trigger, children, className = "" }: MorphingSurfaceProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();

  const close = () => dialogRef.current?.close();

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => dialogRef.current?.showModal()} className={className}>
        {trigger}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => triggerRef.current?.focus()}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}
        className="m-auto max-h-[90dvh] w-[min(92vw,980px)] overflow-visible bg-transparent p-0 backdrop:bg-text/45"
      >
        <motion.div
          initial={reduce ? false : { opacity: 0, scale: 0.98, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={motionTokens.continuity}
          className="relative max-h-[90dvh] overflow-auto rounded-[8px] border border-text/12 bg-bg-elevated p-4 shadow-[0_24px_80px_var(--shadow-lg)] sm:p-6"
        >
          <h2 id={titleId} className="sr-only">{title}</h2>
          <button type="button" onClick={close} className="btn-press absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-[6px] border border-text/10 bg-bg-elevated text-text-secondary" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
          {children}
        </motion.div>
      </dialog>
    </>
  );
}
