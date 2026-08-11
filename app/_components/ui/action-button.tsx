"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { motionTokens } from "./motion-tokens";

export type ActionState = "idle" | "pending" | "success" | "error";

type ActionButtonProps = Omit<React.ComponentProps<typeof motion.button>, "children"> & {
  state: ActionState;
  idleLabel: string;
  pendingLabel: string;
  successLabel?: string;
  errorLabel?: string;
};

export function ActionButton({
  state,
  idleLabel,
  pendingLabel,
  successLabel = "Done",
  errorLabel = "Try again",
  className = "",
  disabled,
  ...props
}: ActionButtonProps) {
  const reduce = useReducedMotion();
  const labels: Record<ActionState, string> = {
    idle: idleLabel,
    pending: pendingLabel,
    success: successLabel,
    error: errorLabel,
  };
  const pending = state === "pending";

  return (
    <motion.button
      {...props}
      type={props.type ?? "button"}
      disabled={disabled || pending}
      aria-busy={pending}
      data-state={state}
      whileTap={reduce || disabled || pending ? undefined : { scale: 0.97 }}
      transition={motionTokens.press}
      className={`btn-press inline-grid place-items-center ${className}`}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={state}
          className="col-start-1 row-start-1 inline-flex items-center justify-center gap-2"
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
          transition={motionTokens.control}
        >
          {pending ? <span className="operation-dot" aria-hidden="true" /> : null}
          {labels[state]}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
