"use client";

import { useRef, type CSSProperties } from "react";

export type ExamBoardOption = {
  label: string;
  courseCount: number;
};

export function examBoardTabId(label: string) {
  return `exam-board-tab-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function ExamBoardDrum({
  boards,
  value,
  onChange,
}: {
  boards: ExamBoardOption[];
  value: string;
  onChange: (board: string) => void;
}) {
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(0, boards.findIndex((board) => board.label === value));

  const selectAt = (index: number) => {
    const next = (index + boards.length) % boards.length;
    onChange(boards[next].label);
    window.requestAnimationFrame(() => tabsRef.current[next]?.focus());
  };

  return (
    <div className="exam-board-shell">
      <div
        aria-label="Choose an exam board"
        className="exam-board-drum"
        role="tablist"
        style={{ "--board-index": activeIndex } as CSSProperties}
      >
        <span className="exam-board-indicator" aria-hidden="true" />
        {boards.map((board, index) => {
          const selected = board.label === value;
          return (
            <button
              aria-controls={`exam-board-panel-${board.label.toLowerCase()}`}
              aria-selected={selected}
              className="exam-board-tab"
              id={examBoardTabId(board.label)}
              key={board.label}
              onClick={() => onChange(board.label)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  selectAt(activeIndex + 1);
                } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  selectAt(activeIndex - 1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  selectAt(0);
                } else if (event.key === "End") {
                  event.preventDefault();
                  selectAt(boards.length - 1);
                }
              }}
              ref={(node) => { tabsRef.current[index] = node; }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <span className="exam-board-name">{board.label}</span>
              <span className="exam-board-count">{board.courseCount} course{board.courseCount === 1 ? "" : "s"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
