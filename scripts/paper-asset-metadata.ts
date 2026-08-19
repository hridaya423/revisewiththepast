export type ExamSession = "june" | "november" | "january" | "unknown";

export function extractExamSession(text: string): ExamSession {
  const normalized = text.toLowerCase();
  if (/(?:^|[^a-z])nov(?:ember)?(?:[-_ ]?\d{2,4})?(?=$|[^a-z])/.test(normalized)) return "november";
  if (/(?:^|[^a-z])jun(?:e)?(?:[-_ ]?\d{2,4})?(?=$|[^a-z])/.test(normalized)) return "june";
  if (/(?:^|[^a-z])jan(?:uary)?(?:[-_ ]?\d{2,4})?(?=$|[^a-z])/.test(normalized)) return "january";
  return "unknown";
}
