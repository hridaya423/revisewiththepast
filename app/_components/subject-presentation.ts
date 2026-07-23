import {
  Atom,
  BriefcaseBusiness,
  Dna,
  Feather,
  Flag,
  FlaskConical,
  MapPinned,
  MessageSquareText,
  Monitor,
  Sigma,
  type LucideIcon,
} from "lucide-react";

export const SUBJECT_ICONS: Record<string, LucideIcon> = {
  "aqa-geography": MapPinned,
  "aqa-business": BriefcaseBusiness,
  "aqa-english-language": MessageSquareText,
  "aqa-english-literature": Feather,
  "edexcel-business": BriefcaseBusiness,
  "edexcel-combined-science": Atom,
  "edexcel-biology": Dna,
  "edexcel-chemistry": FlaskConical,
  "edexcel-physics": Atom,
  "edexcel-french-reading": Flag,
  "edexcel-mathematics-higher": Sigma,
  "ocr-computer-science": Monitor,
};

export const SUBJECT_COLORS: Record<string, { accent: string; soft: string }> = {
  "aqa-geography": { accent: "#4E7760", soft: "#E5EEE7" },
  "aqa-business": { accent: "#8B6449", soft: "#F1E8E0" },
  "aqa-english-language": { accent: "#9A5949", soft: "#F5E5E0" },
  "aqa-english-literature": { accent: "#795C7E", soft: "#EEE7EF" },
  "edexcel-business": { accent: "#8B6449", soft: "#F1E8E0" },
  "edexcel-combined-science": { accent: "#497A7A", soft: "#E1EEEE" },
  "edexcel-biology": { accent: "#568056", soft: "#E5F0E5" },
  "edexcel-chemistry": { accent: "#4B7286", soft: "#E3ECF1" },
  "edexcel-physics": { accent: "#A06C32", soft: "#F4E9D9" },
  "edexcel-french-reading": { accent: "#A65E62", soft: "#F6E5E6" },
  "edexcel-mathematics-higher": { accent: "#4F668E", soft: "#E5EAF3" },
  "ocr-computer-science": { accent: "#4E6B62", soft: "#E3EBE8" },
};
