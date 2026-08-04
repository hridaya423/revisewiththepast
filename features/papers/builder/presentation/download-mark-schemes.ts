import { requestMarkScheme } from "./api-client";

export async function downloadMarkSchemePdfs({ unitKeysByPaper, subjectKey, subjectTier }: { unitKeysByPaper: string[][]; subjectKey: string; subjectTier?: string }) {
  if (!unitKeysByPaper.some((keys) => keys.length > 0)) return { generated: false, warning: "No mark-scheme source data was returned for this paper." };
  let warning: string | null = null;
  let generated = false;
  for (let index = 0; index < unitKeysByPaper.length; index += 1) {
    const unitKeys = unitKeysByPaper[index];
    if (unitKeys.length === 0) continue;
    try {
      const result = await requestMarkScheme({ subjectKey, subjectTier, selectedUnitKeys: unitKeys });
      if (result.failureCount > 0) warning = `${result.failureCount} mark scheme section${result.failureCount === 1 ? "" : "s"} could not be assembled. The PDF includes placeholder pages with details.`;
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = unitKeysByPaper.filter((keys) => keys.length > 0).length === 1 ? `${subjectKey}-mark-scheme.pdf` : `${subjectKey}-mark-scheme-${index + 1}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      generated = true;
    } catch (cause) {
      warning = cause instanceof Error ? cause.message : "The paper downloaded, but its mark scheme could not be generated.";
    }
  }
  return { generated, warning };
}
