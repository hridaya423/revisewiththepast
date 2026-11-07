import { Check, CircleAlert, CircleDot, Clock3 } from "lucide-react";
import { statusToneClass } from "./model";

export function OperationNotice({
  message,
  tone = "failure",
}: {
  message: string;
  tone?: "failure" | "review" | "confirmed" | "active";
}) {
  const Icon = tone === "failure" ? CircleAlert : tone === "review" ? CircleDot : tone === "confirmed" ? Check : Clock3;
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm leading-5 ${statusToneClass(tone)}`} role={tone === "failure" ? "alert" : "status"}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
