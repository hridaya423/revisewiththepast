import { EmbossIcon } from "@/app/_components/emboss/emboss-icon";
import { EMBOSS_PRESETS } from "@/app/_components/emboss/params";
import { SUBJECT_COLORS, SUBJECT_ICONS } from "@/app/_components/subject-presentation";

export function SubjectEmboss({ subjectKey, surface, size = 52 }: { subjectKey: string; surface: string; size?: number }) {
  const presentation = SUBJECT_COLORS[subjectKey] ?? { accent: "#4747D8", soft: "#F0F0FF" };
  const Icon = SUBJECT_ICONS[subjectKey];
  if (!Icon) return null;
  return <EmbossIcon icon={Icon} flag={subjectKey === "edexcel-french-reading" ? "fr" : undefined} color={presentation.accent} surface={surface} params={EMBOSS_PRESETS.subject} size={size} />;
}
