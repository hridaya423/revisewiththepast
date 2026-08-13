import { AlignLeft, List, Scale, type LucideIcon } from "lucide-react";
import type { QuestionMixProfile } from "@/shared/domain/paper";
export const QUESTION_MIX_OPTIONS: { key: QuestionMixProfile; label: string; description: string; icon: LucideIcon }[] = [
  { key: "balanced", label: "Balanced", description: "A mix of short and extended questions.", icon: Scale },
  { key: "short-form", label: "Short form", description: "More 1–4 mark questions.", icon: List },
  { key: "long-form", label: "Long form", description: "More extended-response questions.", icon: AlignLeft },
];
