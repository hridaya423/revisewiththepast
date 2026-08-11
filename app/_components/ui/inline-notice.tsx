import { Check, CircleAlert, CircleDot, Clock3 } from "lucide-react";

export type NoticeTone = "failure" | "review" | "confirmed" | "active";

type InlineNoticeProps = {
  message: string;
  tone?: NoticeTone;
  action?: { label: string; onSelect: () => void };
  className?: string;
};

const toneClasses: Record<NoticeTone, string> = {
  failure: "border-danger/25 bg-danger-soft text-danger",
  review: "border-warning/25 bg-warning-soft text-warning",
  confirmed: "border-success/20 bg-success-soft text-success",
  active: "border-accent/20 bg-accent-soft text-accent-deep",
};

export function InlineNotice({ message, tone = "failure", action, className = "" }: InlineNoticeProps) {
  const Icon = tone === "failure" ? CircleAlert : tone === "review" ? CircleDot : tone === "confirmed" ? Check : Clock3;

  return (
    <div role={tone === "failure" ? "alert" : "status"} className={`flex items-start gap-2 border px-3 py-2.5 text-[0.72rem] leading-5 ${toneClasses[tone]} ${className}`}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{message}</span>
      {action ? <button type="button" onClick={action.onSelect} className="shrink-0 font-bold underline underline-offset-2">{action.label}</button> : null}
    </div>
  );
}
