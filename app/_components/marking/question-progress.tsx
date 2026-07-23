export type QuestionProgressState = "confirmed" | "current" | "review" | "ready" | "waiting" | "failed";

export type QuestionProgressItem = {
  key: string;
  label: string;
  state: QuestionProgressState;
};

function stateClasses(state: QuestionProgressState) {
  if (state === "confirmed") return "border-success bg-success-soft text-success";
  if (state === "current") return "border-accent bg-accent text-white";
  if (state === "review") return "border-warning bg-warning-soft text-warning";
  if (state === "failed") return "border-danger bg-danger-soft text-danger";
  if (state === "ready") return "border-accent/45 bg-accent-soft text-accent-deep";
  return "border-text/20 bg-white text-text-muted";
}

function connectorClasses(left: QuestionProgressState, right: QuestionProgressState) {
  if (left === "confirmed" && right === "confirmed") return "bg-success";
  if (left === "confirmed" && (right === "current" || right === "ready")) return "bg-accent";
  if (left === "current" && right === "review") return "bg-warning";
  return "bg-text/20";
}

export function QuestionProgressRail({
  items,
  activeKey,
  onSelect,
  className = "",
}: {
  items: QuestionProgressItem[];
  activeKey?: string | null;
  onSelect?: (key: string) => void;
  className?: string;
}) {
  return (
    <ol className={`flex min-w-max items-start ${className}`} aria-label="Question progress">
      {items.map((item, index) => {
        const isActive = item.key === activeKey || item.state === "current";
        const marker = (
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-full border text-[0.72rem] font-semibold tabular-nums ${stateClasses(isActive ? "current" : item.state)}`}
            aria-hidden="true"
          >
            {item.label}
          </span>
        );
        return (
          <li key={item.key} className="flex items-start">
            <div className="flex w-10 flex-col items-center gap-1.5">
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(item.key)}
                  aria-label={`Open question ${item.label}`}
                  aria-current={isActive ? "step" : undefined}
                  className="rounded-full"
                >
                  {marker}
                </button>
              ) : marker}
              {item.state === "confirmed" ? <span className="text-[0.62rem] font-bold text-success">✓</span> : null}
              {item.state === "review" ? <span className="text-[0.6rem] font-semibold text-warning">Review</span> : null}
              {isActive ? <span className="text-[0.6rem] font-semibold text-accent">Current</span> : null}
            </div>
            {index < items.length - 1 ? (
              <span className={`mt-[15px] h-px w-8 sm:w-12 lg:w-16 ${connectorClasses(item.state, items[index + 1].state)}`} aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
