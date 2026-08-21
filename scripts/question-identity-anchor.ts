import type { BoundingBox, QuestionIdentityAnchor } from "@/shared/domain/paper";

export type IdentityAnchorLine = {
  text: string;
  bbox: BoundingBox;
  y: number;
  spans?: Array<{ text: string; bbox: BoundingBox }>;
};

export type IdentityAnchorPage = {
  pageNumber: number;
  lines: IdentityAnchorLine[];
};

export type IdentityAnchorResult =
  | { status: "found"; anchor: QuestionIdentityAnchor }
  | { status: "missing"; reason: string }
  | { status: "ambiguous"; candidates: Array<{ pageNumber: number; numberBounds: BoundingBox | null }> };

type Candidate = {
  pageNumber: number;
  line: IdentityAnchorLine;
  markerText: string;
  strength: "major" | "compound" | "question-part" | "part" | "normal";
};

export type GroupedIdentityPart = {
  questionId: string;
  questionNumber: string;
  questionPartNumber: string | null;
  sectionCode: string | null;
  choiceGroupId: string | null;
  pageNumber: number;
  pageNumbers: number[];
  identity_anchor: QuestionIdentityAnchor | null;
};

export type GroupedIdentityResult = {
  anchor: QuestionIdentityAnchor | null;
  result: IdentityAnchorResult;
};

const normalize = (value: string) => value.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
const normalizeNumber = (value: string) => value.replace(/\s+/g, "").replace(/^0+/, "") || "0";
const normalizeTokenContent = (value: string) => value.replace(/\s+/g, "");
const MAX_PROMPT_DISTANCE = 80;

function boundedBaseline(baseline: number, bounds: BoundingBox) {
  return Math.min(bounds.y1, Math.max(bounds.y0, baseline));
}

function isFurniture(text: string) {
  const normalized = normalize(text);
  return !normalized
    || /^(?:\[?\d+\s+marks?\]?|turn over|pmt|question \d+ continues|total for question|total for paper|do not write|section [a-z]|end of)/i.test(normalized)
    || /(?:barcode|page\s*code|page\s+\d+(?:\s+of\s+\d+)?$)/i.test(normalized)
    || /^(?:[A-Z0-9]{2,}[/-]){1,}[A-Z0-9/-]+$/i.test(normalized)
    || /^(?:\d[\s-]*){6,}$/.test(normalized)
    || /^[_—-]{3,}$/.test(normalized);
}

function aqaCompoundMarker(text: string) {
  return text.match(/^((?:\d\s*)+)\.\s*((?:\d\s*)+)(?=\s|$)/);
}

function aqaMajorMarker(text: string, expectedQuestion: string) {
  const match = text.match(/^((?:\d\s+)+\d)(?=\s|$)/);
  if (!match || normalizeNumber(match[1]) !== expectedQuestion) return null;
  const remainder = text.slice(match[1].length).trim();
  if (remainder.startsWith(".")) return null;
  return match[1];
}

function partMarker(text: string, expectedPart: string) {
  const token = normalizeTokenContent(expectedPart);
  const normalizedToken = /^\d+$/.test(token) ? normalizeNumber(token) : token;
  const escapedToken = normalizedToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const numericSuffix = /^\d+$/.test(normalizedToken) ? "\\.?" : "";
  const parenthesized = text.match(new RegExp(`^(\\(${escapedToken}\\)(?:\\s*\\([a-zivx0-9]+\\))*)(?=\\s|$)`, "i"));
  if (parenthesized) return parenthesized[1];
  const match = text.match(new RegExp(`^(${escapedToken}${numericSuffix})(?=\\s|$)`, /^\d+$/.test(normalizedToken) ? "i" : ""));
  return match?.[1] ?? null;
}

function questionPartHeading(text: string, expectedQuestion: string, expectedPart: string) {
  const escapedPart = normalizeTokenContent(expectedPart).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^(\\d{1,3})(?:\\s*\\.)?\\s+\\(${escapedPart}\\)(?=\\s|$)`, "i"));
  return match && normalizeNumber(match[1]) === expectedQuestion ? match[1] : null;
}

function withoutLeadingFurniture(line: IdentityAnchorLine): IdentityAnchorLine {
  const spans = [...(line.spans ?? [])];
  while (spans[0] && isFurniture(spans[0].text)) spans.shift();
  if (spans.length === 0 || spans.length === line.spans?.length) return line;
  return {
    text: spans.map((span) => span.text).join(" "),
    y: line.y,
    bbox: {
      x0: Math.min(...spans.map((span) => span.bbox.x0)),
      y0: Math.min(...spans.map((span) => span.bbox.y0)),
      x1: Math.max(...spans.map((span) => span.bbox.x1)),
      y1: Math.max(...spans.map((span) => span.bbox.y1)),
    },
    spans,
  };
}

function isQuestionMarkerLine(line: IdentityAnchorLine, boardCode: string) {
  const text = normalize(line.text);
  if (boardCode === "aqa" && aqaCompoundMarker(text)) return true;
  return /^\d{1,3}(?:\s*\.)?(?:\s|$)/.test(text);
}

function geometryForMarker(line: IdentityAnchorLine, markerText: string) {
  const spans = line.spans ?? [];
  if (spans.length === 0) return { status: "missing" as const, reason: "identity marker has no extracted spans" };

  const markerContent = normalizeTokenContent(markerText);
  let consumed = "";
  const markerSpans: typeof spans = [];
  for (const span of spans) {
    const spanContent = normalizeTokenContent(span.text);
    if (!spanContent) continue;
    if (`${consumed}${spanContent}`.length > markerContent.length) {
      return { status: "missing" as const, reason: "identity marker and prompt share an inseparable extracted span" };
    }
    markerSpans.push(span);
    consumed += spanContent;
    if (consumed === markerContent) {
      return {
        status: "found" as const,
        numberBounds: {
          x0: Math.min(...markerSpans.map((item) => item.bbox.x0)),
          y0: Math.min(...markerSpans.map((item) => item.bbox.y0)),
          x1: Math.max(...markerSpans.map((item) => item.bbox.x1)),
          y1: Math.max(...markerSpans.map((item) => item.bbox.y1)),
        },
        markerSpanCount: spans.indexOf(span) + 1,
      };
    }
  }
  return { status: "missing" as const, reason: "extracted spans do not provide the complete identity marker" };
}

function promptBounds(line: IdentityAnchorLine, markerText: string, markerSpanCount: number) {
  const remainder = normalize(line.text).slice(normalize(line.text).indexOf(normalize(markerText)) + normalize(markerText).length).trim();
  if (!remainder || isFurniture(remainder)) return null;
  const promptSpans = [];
  for (const span of line.spans?.slice(markerSpanCount) ?? []) {
    if (isFurniture(span.text)) break;
    promptSpans.push(span);
  }
  if (!promptSpans || promptSpans.length === 0) return null;
  return {
    bounds: {
      x0: Math.min(...promptSpans.map((span) => span.bbox.x0)),
      y0: Math.min(...promptSpans.map((span) => span.bbox.y0)),
      x1: Math.max(...promptSpans.map((span) => span.bbox.x1)),
      y1: Math.max(...promptSpans.map((span) => span.bbox.y1)),
    },
  };
}

function findPrompt(
  page: IdentityAnchorPage,
  candidate: Candidate,
  markerSpanCount: number,
  boardCode: string,
  candidateRegion?: { yTop: number; yBottom: number },
) {
  const sameLine = promptBounds(candidate.line, candidate.markerText, markerSpanCount);
  if (sameLine) return { bounds: sameLine.bounds, baseline: boundedBaseline(candidate.line.y, sameLine.bounds) };

  const next = page.lines
    .map(withoutLeadingFurniture)
    .filter((line) => line.bbox.y1 <= candidate.line.bbox.y0 + 1
      && (candidateRegion
        ? line.bbox.y0 >= candidateRegion.yBottom && line.bbox.y1 <= candidateRegion.yTop
          && (normalize(line.text).match(/[A-Za-z]{2,}/g)?.length ?? 0) >= 2
        : candidate.line.bbox.y0 - line.bbox.y1 <= MAX_PROMPT_DISTANCE)
      && !isFurniture(line.text)
      && !isQuestionMarkerLine(line, boardCode))
    .sort((left, right) => right.bbox.y1 - left.bbox.y1);
  const prompt = next[0];
  return prompt ? { bounds: prompt.bbox, baseline: boundedBaseline(prompt.y, prompt.bbox) } : null;
}

function candidateGeometry(candidate: Candidate) {
  const geometry = geometryForMarker(candidate.line, candidate.markerText);
  if (geometry.status === "missing") return geometry;
  return geometry;
}

function candidatesForPage(
  page: IdentityAnchorPage,
  boardCode: string,
  subjectSlug: string,
  questionNumber: string,
  questionPartNumber: string | null,
  candidateRegion?: { yTop: number; yBottom: number },
) {
  const expectedQuestion = normalizeNumber(questionNumber);
  const expectedPart = questionPartNumber ? normalizeNumber(questionPartNumber) : null;
  const candidates: Candidate[] = [];
  const hasMajorHeading = boardCode === "aqa" && expectedPart === null && page.lines.some((line) => {
    const match = normalize(line.text).match(/^Question\s+(\d{1,3})(?=\s|$)/i);
    return match ? normalizeNumber(match[1]) === expectedQuestion : false;
  });

  for (const line of page.lines) {
    if (candidateRegion && (line.bbox.y0 < candidateRegion.yBottom || line.bbox.y1 > candidateRegion.yTop)) continue;
    const contentLine = withoutLeadingFurniture(line);
    const text = normalize(contentLine.text).replace(/^\*+/, "");
    if (!text || isFurniture(text)) continue;

    const compound = boardCode === "aqa" ? aqaCompoundMarker(text) : null;
    if (compound) {
      if (normalizeNumber(compound[1]) !== expectedQuestion) continue;
      if (expectedPart === null ? !hasMajorHeading : normalizeNumber(compound[2]) !== expectedPart) continue;
       candidates.push({ pageNumber: page.pageNumber, line: contentLine, markerText: compound[0], strength: "compound" });
      continue;
    }

    if (boardCode === "aqa" && expectedPart === null) {
      const majorMarker = aqaMajorMarker(text, expectedQuestion);
      if (majorMarker) {
        candidates.push({ pageNumber: page.pageNumber, line: contentLine, markerText: majorMarker, strength: "major" });
        continue;
      }
    }

    if (expectedPart !== null) {
      const combinedMarker = questionPartHeading(text, expectedQuestion, expectedPart);
      if (combinedMarker) {
        candidates.push({ pageNumber: page.pageNumber, line: contentLine, markerText: combinedMarker, strength: "question-part" });
        continue;
      }
      const marker = partMarker(text, expectedPart);
      if (marker) candidates.push({ pageNumber: page.pageNumber, line: contentLine, markerText: marker, strength: "part" });
      continue;
    }

    const match = text.match(/^(\d{1,3})(?:\s*\.)?(?=\s|$)/);
    if (!match || normalizeNumber(match[1]) !== expectedQuestion) continue;
    if (subjectSlug === "mathematics") {
      if (line.bbox.x0 > 180 || /total\s+for\s+question/i.test(text)) continue;
    }
    candidates.push({ pageNumber: page.pageNumber, line: contentLine, markerText: match[0], strength: "normal" });
  }
  return candidates;
}

function preferredCandidates(candidates: Candidate[]) {
  return candidates.some((candidate) => candidate.strength === "major")
    ? candidates.filter((candidate) => candidate.strength === "major")
    : candidates.some((candidate) => candidate.strength === "compound")
      ? candidates.filter((candidate) => candidate.strength === "compound")
      : candidates.some((candidate) => candidate.strength === "question-part")
        ? candidates.filter((candidate) => candidate.strength === "question-part")
        : candidates.some((candidate) => candidate.strength === "part")
          ? candidates.filter((candidate) => candidate.strength === "part")
          : candidates;
}

function candidatesAtRegionTop(candidates: Candidate[], candidateRegion?: { yTop: number; yBottom: number }) {
  if (candidates.length < 2 || !candidateRegion) return candidates;
  const topCandidates = candidates.filter((candidate) => candidateRegion.yTop - candidate.line.bbox.y1 <= 8);
  return topCandidates.length === 1 ? topCandidates : candidates;
}

function candidatesAtRegionStart(candidates: Candidate[], candidateRegion: { yTop: number; yBottom: number }) {
  const topCandidates = candidatesAtRegionTop(candidates, candidateRegion);
  if (topCandidates.length < 2) return topCandidates;
  const left = Math.min(...topCandidates.map((candidate) => candidate.line.bbox.x0));
  const leftCandidates = topCandidates.filter((candidate) => candidate.line.bbox.x0 === left);
  return leftCandidates.length === 1 ? leftCandidates : topCandidates;
}

function trustedMathsCandidates(candidates: Candidate[], subjectSlug: string) {
  if (subjectSlug !== "mathematics" || candidates.length < 2) return candidates;
  const exact = candidates.filter((candidate) => candidateGeometry(candidate).status === "found");
  if (exact.length === 1) return exact;
  const left = Math.min(...exact.map((candidate) => candidate.line.bbox.x0));
  const leftCandidates = exact.filter((candidate) => candidate.line.bbox.x0 === left);
  return leftCandidates.length === 1 ? leftCandidates : candidates;
}

export function discoverQuestionIdentityAnchor(input: {
  boardCode: string;
  subjectSlug: string;
  questionNumber: string;
  questionPartNumber?: string | null;
  pages: IdentityAnchorPage[];
  startPageNumber?: number;
  candidateRegion?: { yTop: number; yBottom: number };
}): IdentityAnchorResult {
  const pages = input.startPageNumber === undefined
    ? input.pages
    : input.pages.filter((page) => page.pageNumber === input.startPageNumber);
  const allCandidates = pages.flatMap((page) => candidatesForPage(page, input.boardCode, input.subjectSlug, input.questionNumber, input.questionPartNumber ?? null, input.candidateRegion));
  const candidates = trustedMathsCandidates(
    candidatesAtRegionTop(preferredCandidates(allCandidates), input.candidateRegion),
    input.subjectSlug,
  );
  if (candidates.length === 0) return { status: "missing", reason: "no identity marker on the requested page" };
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      candidates: candidates.map((candidate) => {
        const geometry = candidateGeometry(candidate);
        return { pageNumber: candidate.pageNumber, numberBounds: geometry.status === "found" ? geometry.numberBounds : null };
      }),
    };
  }

  const candidate = candidates[0];
  const geometry = candidateGeometry(candidate);
  if (geometry.status === "missing") return geometry;
  const prompt = findPrompt(pages.find((page) => page.pageNumber === candidate.pageNumber) ?? pages[0], candidate, geometry.markerSpanCount, input.boardCode, input.candidateRegion);
  if (!prompt) return { status: "missing", reason: "identity marker has no meaningful prompt line" };
  return {
    status: "found",
    anchor: {
      pageNumber: candidate.pageNumber,
      numberBounds: geometry.numberBounds,
      promptBaseline: prompt.baseline,
      promptBounds: prompt.bounds,
    },
  };
}

export function discoverSplitQuestionIdentityAnchor(input: {
  boardCode: string;
  subjectSlug: string;
  questionNumber: string;
  questionPartNumber: string;
  pages: IdentityAnchorPage[];
  pageNumber: number;
  numberRegion: { yTop: number; yBottom: number };
  promptRegion: { yTop: number; yBottom: number };
}): IdentityAnchorResult {
  const page = input.pages.find((candidate) => candidate.pageNumber === input.pageNumber);
  if (!page) return { status: "missing", reason: "requested identity page is unavailable" };

  const numberCandidates = candidatesAtRegionStart(preferredCandidates(candidatesForPage(
    page,
    input.boardCode,
    input.subjectSlug,
    input.questionNumber,
    null,
    input.numberRegion,
  )), input.numberRegion);
  const promptCandidates = preferredCandidates(candidatesForPage(
    page,
    input.boardCode,
    input.subjectSlug,
    input.questionNumber,
    input.questionPartNumber,
    input.promptRegion,
  ));
  if (numberCandidates.length === 0) return { status: "missing", reason: "split stem number marker is unavailable" };
  if (promptCandidates.length === 0) return { status: "missing", reason: "split first prompt marker is unavailable" };
  if (numberCandidates.length > 1 || promptCandidates.length > 1) {
    return {
      status: "ambiguous",
      candidates: numberCandidates.map((candidate) => {
        const geometry = candidateGeometry(candidate);
        return { pageNumber: candidate.pageNumber, numberBounds: geometry.status === "found" ? geometry.numberBounds : null };
      }),
    };
  }

  const numberGeometry = candidateGeometry(numberCandidates[0]);
  if (numberGeometry.status === "missing") return numberGeometry;
  const promptCandidate = promptCandidates[0];
  const promptGeometry = candidateGeometry(promptCandidate);
  const prompt = promptGeometry.status === "found"
    ? findPrompt(page, promptCandidate, promptGeometry.markerSpanCount, input.boardCode, input.promptRegion)
    : { bounds: promptCandidate.line.bbox, baseline: promptCandidate.line.y };
  if (!prompt) return { status: "missing", reason: "split identity marker has no meaningful prompt line" };

  return {
    status: "found",
    anchor: {
      pageNumber: input.pageNumber,
      numberBounds: numberGeometry.numberBounds,
      promptBaseline: prompt.baseline,
      promptBounds: prompt.bounds,
    },
  };
}

export function assignQuestionIdentityAnchors<T extends {
  section_code: string | null;
  question_number: string;
  choiceGroupId: string | null;
  identity_anchor: QuestionIdentityAnchor | null;
}>(parts: T[], anchors: ReadonlyMap<string, QuestionIdentityAnchor | null>) {
  return parts.map((part) => ({
    ...part,
    identity_anchor: anchors.get(`${part.section_code ?? "-"}::${part.question_number}::${part.choiceGroupId ?? "-"}`) ?? null,
  }));
}

export function hasDuplicateQuestionPartNumbers(parts: ReadonlyArray<{ question_part_number?: string | null; questionPartNumber?: string | null }>) {
  const seen = new Set<string | null>();
  for (const part of parts) {
    const questionPartNumber = part.question_part_number ?? part.questionPartNumber ?? null;
    if (seen.has(questionPartNumber)) return true;
    seen.add(questionPartNumber);
  }
  return false;
}

export function discoverGroupedQuestionIdentityAnchors<T extends GroupedIdentityPart>(input: {
  boardCode: string;
  subjectSlug: string;
  pages: IdentityAnchorPage[];
  parts: T[];
}) {
  const outcomes = new Map<string, GroupedIdentityResult>();
  for (const part of input.parts) {
    const attempts = [part.questionPartNumber, null];
    let outcome: GroupedIdentityResult = { anchor: null, result: { status: "missing", reason: "no identity marker on the requested page" } };
    for (const questionPartNumber of attempts) {
      const result = discoverQuestionIdentityAnchor({
        boardCode: input.boardCode,
        subjectSlug: input.subjectSlug,
        questionNumber: part.questionNumber,
        questionPartNumber,
        pages: input.pages,
        startPageNumber: part.pageNumber,
      });
      outcome = { anchor: result.status === "found" ? result.anchor : null, result };
      if (result.status !== "missing") break;
    }

    if (outcome.anchor && part.pageNumbers.some((pageNumber) => pageNumber !== part.pageNumber)) {
      const continuationPages = part.pageNumbers.filter((pageNumber) => pageNumber !== part.pageNumber);
      const conflictingCandidate = continuationPages.some((pageNumber) => attempts.some((questionPartNumber) => {
        const result = discoverQuestionIdentityAnchor({
          boardCode: input.boardCode,
          subjectSlug: input.subjectSlug,
          questionNumber: part.questionNumber,
          questionPartNumber,
          pages: input.pages,
          startPageNumber: pageNumber,
        });
        return result.status === "found" || result.status === "ambiguous";
      }));
      if (conflictingCandidate) outcome = { anchor: null, result: { status: "missing", reason: "continuation page contains a conflicting identity marker" } };
    }
    outcomes.set(part.questionId, outcome);
  }

  return {
    outcomes,
    parts: input.parts.map((part) => ({ ...part, identity_anchor: outcomes.get(part.questionId)?.anchor ?? null })),
  };
}
