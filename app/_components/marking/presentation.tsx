import { Check, CircleAlert, CircleDot, Clock3, FileCheck2, ScanText, Upload } from "lucide-react";

export type MarkingTone = "neutral" | "active" | "confirmed" | "review" | "failure";

export function statusToneClass(tone: MarkingTone) {
  if (tone === "confirmed") return "border-success/20 bg-success-soft text-success";
  if (tone === "review") return "border-warning/25 bg-warning-soft text-warning";
  if (tone === "failure") return "border-danger/25 bg-danger-soft text-danger";
  if (tone === "active") return "border-accent/20 bg-accent-soft text-accent-deep";
  return "border-text/10 bg-bg-warm text-text-muted";
}

export function ProgressTrail({
  uploaded,
  ocrComplete,
  scored,
  reviewRequiredCount,
}: {
  uploaded: boolean;
  ocrComplete: boolean;
  scored: boolean;
  reviewRequiredCount: number;
}) {
  const steps = [
    { label: "Uploaded", icon: Upload, complete: uploaded },
    { label: "OCR", icon: ScanText, complete: ocrComplete },
    { label: "Scored", icon: FileCheck2, complete: scored },
    { label: reviewRequiredCount > 0 ? `${reviewRequiredCount} review` : "Confirmed", icon: reviewRequiredCount > 0 ? CircleAlert : Check, complete: scored && reviewRequiredCount === 0 },
  ];
  const firstIncompleteIndex = steps.findIndex((step) => !step.complete);

  return (
    <ol className="flex min-w-0 items-center gap-1.5" aria-label="Marking progress">
      {steps.map((step, index) => {
        const Icon = step.icon;
        return (
          <li key={step.label} className="flex min-w-0 items-center gap-1.5">
            <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${step.complete ? "border-success/20 bg-success-soft text-success" : index === firstIncompleteIndex ? "border-accent/20 bg-accent-soft text-accent" : "border-text/10 bg-bg-warm text-text-subtle"}`}>
              <Icon className="h-3 w-3" />
            </span>
            <span className={`hidden truncate text-[0.64rem] font-semibold sm:inline ${step.complete ? "text-success" : index === firstIncompleteIndex ? "text-accent-deep" : "text-text-muted"}`}>{step.label}</span>
            {index < steps.length - 1 ? <span className="h-px w-4 bg-text/10" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function OperationNotice({
  message,
  tone = "failure",
}: {
  message: string;
  tone?: "failure" | "review" | "confirmed" | "active";
}) {
  const Icon = tone === "failure" ? CircleAlert : tone === "review" ? CircleDot : tone === "confirmed" ? Check : Clock3;
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[0.72rem] leading-5 ${statusToneClass(tone)}`} role={tone === "failure" ? "alert" : "status"}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
