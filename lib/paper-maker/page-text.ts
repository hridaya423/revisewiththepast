
export type SupportLabelKind =
  | "figure"
  | "table"
  | "diagram"
  | "graph"
  | "photo"
  | "map"
  | "chart"
  | "resource";

const SUPPORT_KIND_ALIASES: Record<string, SupportLabelKind> = {
  figure: "figure",
  figures: "figure",
  fig: "figure",
  figs: "figure",
  table: "table",
  tables: "table",
  diagram: "diagram",
  diagrams: "diagram",
  graph: "graph",
  graphs: "graph",
  photo: "photo",
  photos: "photo",
  photograph: "photo",
  photographs: "photo",
  map: "map",
  maps: "map",
  chart: "chart",
  charts: "chart",
  resource: "resource",
  resources: "resource",
};

const SUPPORT_KIND_PATTERN = "figures?|figs?|tables?|diagrams?|graphs?|photographs?|photos?|maps?|charts?|resources?";

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeSupportNumber(raw: string) {
  return raw.replace(/\s+/g, "").toLowerCase();
}

export function normalizeSupportLabel(kindRaw: string, numberRaw: string): string | null {
  const kind = SUPPORT_KIND_ALIASES[kindRaw.toLowerCase()];
  if (!kind) return null;
  const number = normalizeSupportNumber(numberRaw);
  if (!/^\d{1,3}[a-z]?$/.test(number)) return null;
  return `${kind} ${number}`;
}


export function extractReferencedSupportLabels(text: string): string[] {
  const labels = new Set<string>();
  const normalized = normalizeWhitespace(text).toLowerCase();
  const referenceRe = new RegExp(
    `\\b(${SUPPORT_KIND_PATTERN})\\s+(\\d{1,3}\\s?[a-z]?)\\b((?:\\s*(?:,|and|or)\\s*\\d{1,3}\\s?[a-z]?\\b)*)`,
    "g",
  );

  let match = referenceRe.exec(normalized);
  while (match) {
    const label = normalizeSupportLabel(match[1], match[2]);
    if (label) {
      labels.add(label);
      const kind = label.split(" ")[0];
      const continuation = match[3] ?? "";
      const continuationRe = /(?:,|and|or)\s*(\d{1,3}\s?[a-z]?)\b/g;
      let continuationMatch = continuationRe.exec(continuation);
      while (continuationMatch) {
        const extra = normalizeSupportLabel(kind, continuationMatch[1]);
        if (extra) labels.add(extra);
        continuationMatch = continuationRe.exec(continuation);
      }
    }
    match = referenceRe.exec(normalized);
  }

  return Array.from(labels).sort();
}

export type SupportCaptionForm = "bare" | "titled" | "prose";

export function matchSupportCaption(
  text: string,
): { label: string; kind: SupportLabelKind; form: SupportCaptionForm } | null {
  const normalized = normalizeWhitespace(text);
  const labelPart = `^(${SUPPORT_KIND_PATTERN})\\s+(\\d{1,3}\\s?[a-z]?)`;
  const bareMatch = normalized.match(new RegExp(`${labelPart}$`, "i"));
  const titledMatch = normalized.match(new RegExp(`${labelPart}\\s*[–—:-]`, "i"));
  const proseMatch = normalized.match(
    new RegExp(`${labelPart}\\s+\\b(?:shows?|is|are|gives?|presents?|compares?)\\b`, "i"),
  );
  const form: SupportCaptionForm | null = bareMatch ? "bare" : titledMatch ? "titled" : proseMatch ? "prose" : null;
  const match = bareMatch ?? titledMatch ?? proseMatch;
  if (!match || !form) return null;
  const label = normalizeSupportLabel(match[1], match[2]);
  if (!label) return null;
  if (/s$/i.test(match[1]) && !/^(figs)$/i.test(match[1])) return null;
  return { label, kind: label.split(" ")[0] as SupportLabelKind, form };
}
export const HEADER_FURNITURE_PATTERNS: RegExp[] = [
  /^answer all questions/i,
  /^answer (?:either|both|one|any|two|three)\b/i,
  /^answer the questions in the spaces provided/i,
  /^write your answers in the spaces provided/i,
  /^you must write down all the stages in your working/i,
  /^there may be more space than you need/i,
  /^some questions must be answered with a cross/i,
  /^if you change your mind about an answer/i,
  /^mark your new answer with a cross/i,
  /^for the multiple[- ]choice questions/i,
  /^correct method\b/i,
  /^wrong methods?\b/i,
  /^if you want to change your answer/i,
  /^if you wish to return to an answer/i,
  /^select as shown\b/i,
  /^calculators? (?:may|must|cannot|are)\b/i,
  /^instructions\b/i,
  /^information\b/i,
  /^advice\b/i,
  /^do not write outside the/i,
  /^answer all questions in the spaces provided/i,
  /^section [a-z]\b.{0,40}$/i,
  /^additional answer space$/i,
  /^if additional space is required/i,
  /^end of sources$/i,
];

export const FOOTER_FURNITURE_PATTERNS: RegExp[] = [
  /^turn over\b/i,
  /^\*?p\d{4,}[a-z0-9]*\*?(\s+(turn over|\d{1,3}|[►▶]))*\s*$/i,
  /^(?:ib\/)?[a-z]{1,3}\/(?:jun|nov)\d{2}\/[a-z0-9\/.]+$/i,
  /^©/,
  /^copyright/i,
  /^end of question(s| paper)?\b/i,
  /^oxford cambridge and rsa\b/i,
  /^ocr is (an exempt charity|committed)\b/i,
  /^\d{1,3}$/,
  /^pmt$/i,
];

export function isHeaderFurnitureLine(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return true;
  return HEADER_FURNITURE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isFooterFurnitureLine(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return true;
  return FOOTER_FURNITURE_PATTERNS.some((pattern) => pattern.test(normalized));
}
