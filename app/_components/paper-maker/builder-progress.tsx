"use client";

import { Check } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { motionTokens } from "@/app/_components/ui/motion-tokens";

export type BuilderStage = "subject" | "topics" | "paper";

type BuilderProgressProps = {
  stage: BuilderStage;
  subjectReady: boolean;
  topicsReady: boolean;
  topicSelectionEnabled: boolean;
  onStageChange: (stage: BuilderStage) => void;
};

export function BuilderProgress({ stage, subjectReady, topicsReady, topicSelectionEnabled, onStageChange }: BuilderProgressProps) {
  const reduce = useReducedMotion();
  const steps: Array<{ key: BuilderStage; label: string; ready: boolean; disabled: boolean }> = [
    { key: "subject", label: "Subject", ready: subjectReady, disabled: false },
    ...(topicSelectionEnabled ? [{ key: "topics" as const, label: "Topics", ready: topicsReady, disabled: !subjectReady }] : []),
    { key: "paper", label: "Paper", ready: false, disabled: !subjectReady || (topicSelectionEnabled && !topicsReady) },
  ];

  return (
    <nav className="flex items-center gap-1" aria-label="Paper builder steps">
      {steps.map((step, index) => {
        const current = stage === step.key;
        return (
          <button key={step.key} type="button" onClick={() => onStageChange(step.key)} disabled={step.disabled} aria-current={current ? "step" : undefined} className={`relative inline-flex min-h-10 items-center gap-2 px-3 text-[0.74rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${current ? "text-accent" : "text-text-secondary hover:text-accent"}`}>
            {step.label}
            {step.ready && !current ? <Check className="h-4 w-4 text-success" /> : <span className="font-mono text-[0.66rem] text-text-subtle">{index + 1}</span>}
            {current ? <motion.span layoutId="builder-progress-indicator" className="absolute inset-x-1 bottom-0 h-0.5 bg-accent" transition={reduce ? { duration: 0 } : motionTokens.control} /> : null}
          </button>
        );
      })}
    </nav>
  );
}
