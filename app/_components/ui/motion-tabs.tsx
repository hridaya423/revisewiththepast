"use client";

import { useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { motionTokens } from "./motion-tokens";

export type MotionTabItem = {
  value: string;
  label: React.ReactNode;
  content: React.ReactNode;
  disabled?: boolean;
};

type MotionTabsProps = {
  items: MotionTabItem[];
  label: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
};

export function MotionTabs({ items, label, value, defaultValue, onValueChange, className = "" }: MotionTabsProps) {
  const id = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const [internalValue, setInternalValue] = useState(defaultValue ?? items[0]?.value ?? "");
  const selected = value ?? internalValue;
  const active = items.find((item) => item.value === selected) ?? items[0];

  const select = (next: string) => {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  };

  const move = (currentIndex: number, direction: 1 | -1) => {
    for (let offset = 1; offset <= items.length; offset += 1) {
      const nextIndex = (currentIndex + direction * offset + items.length) % items.length;
      if (!items[nextIndex]?.disabled) {
        select(items[nextIndex].value);
        document.getElementById(`${id}-tab-${items[nextIndex].value}`)?.focus();
        return;
      }
    }
  };

  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="inline-flex border-b border-text/12">
        {items.map((item, index) => {
          const isSelected = item.value === active?.value;
          return (
            <button
              key={item.value}
              id={`${id}-tab-${item.value}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={`${id}-panel-${item.value}`}
              tabIndex={isSelected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") { event.preventDefault(); move(index, 1); }
                if (event.key === "ArrowLeft") { event.preventDefault(); move(index, -1); }
                if (event.key === "Home") { event.preventDefault(); move(-1, 1); }
                if (event.key === "End") { event.preventDefault(); move(0, -1); }
              }}
              className="relative min-h-10 px-3 text-[0.76rem] font-semibold text-text-secondary disabled:opacity-35"
            >
              {item.label}
              {isSelected ? <motion.span layoutId={`${id}-indicator`} className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" transition={reduce ? { duration: 0 } : motionTokens.continuity} /> : null}
            </button>
          );
        })}
      </div>
      {active ? (
        <motion.div
          key={active.value}
          id={`${id}-panel-${active.value}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${active.value}`}
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={motionTokens.control}
        >
          {active.content}
        </motion.div>
      ) : null}
    </div>
  );
}
