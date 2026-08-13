"use client";

import { AnimatePresence, m, useReducedMotion } from "motion/react";

import { motionTokens } from "./motion-tokens";

type AnimatedValueProps = {
  value: string | number;
  label?: string;
  className?: string;
};

export function AnimatedValue({ value, label, className = "" }: AnimatedValueProps) {
  const reduce = useReducedMotion();
  const spoken = `${value}${label ? ` ${label}` : ""}`;

  return (
    <span className={`relative inline-grid overflow-hidden tabular-nums ${className}`}>
      <AnimatePresence initial={false} mode="popLayout">
        <m.span
          key={String(value)}
          aria-hidden="true"
          className="col-start-1 row-start-1"
          initial={reduce ? false : { opacity: 0, y: "35%" }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: "-35%" }}
          transition={motionTokens.control}
        >
          {value}
        </m.span>
      </AnimatePresence>
      <span className="sr-only" aria-live="polite">{spoken}</span>
    </span>
  );
}
