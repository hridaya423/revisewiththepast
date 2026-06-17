
import type { QuestionUnit } from "@/lib/paper-maker/aqa-geography";
import type { RegionFigure } from "@/lib/paper-maker/region-render";
import { isUnitRegionRenderable, type RegionPageLayout } from "@/lib/paper-maker/region-render";

export type FigureGateResult = {
  kept: QuestionUnit[];
  excluded: Array<{ unitKey: string; missingFigures: string[] }>;
};

function referencedFigureLabels(unit: QuestionUnit): string[] {
  const labels = new Set<string>();
  for (const part of unit.parts) {
    for (const label of part.referencedFigures ?? []) labels.add(label);
  }
  return Array.from(labels);
}

export function filterUnitsByFigureResolvability(
  units: QuestionUnit[],
  options: {
    figuresBySource: Map<string, RegionFigure[]>;
    pageLayoutsBySource: Map<string, RegionPageLayout[]>;
    subjectUsesInserts: boolean;
  },
): FigureGateResult {
  const labelSetBySource = new Map<string, Set<string>>();
  const getLabels = (sourceRelativePath: string) => {
    let set = labelSetBySource.get(sourceRelativePath);
    if (!set) {
      set = new Set((options.figuresBySource.get(sourceRelativePath) ?? []).map((figure) => figure.label));
      labelSetBySource.set(sourceRelativePath, set);
    }
    return set;
  };
  const layoutMapBySource = new Map<string, Map<number, RegionPageLayout>>();
  const getLayoutMap = (sourceRelativePath: string) => {
    let map = layoutMapBySource.get(sourceRelativePath);
    if (!map) {
      map = new Map((options.pageLayoutsBySource.get(sourceRelativePath) ?? []).map((layout) => [layout.pageNumber, layout]));
      layoutMapBySource.set(sourceRelativePath, map);
    }
    return map;
  };

  const kept: QuestionUnit[] = [];
  const excluded: FigureGateResult["excluded"] = [];

  for (const unit of units) {
    if (!isUnitRegionRenderable(unit, getLayoutMap(unit.sourceRelativePath))) {
      kept.push(unit);
      continue;
    }

    const referenced = referencedFigureLabels(unit);
    if (referenced.length === 0) {
      kept.push(unit);
      continue;
    }

    const available = getLabels(unit.sourceRelativePath);
    const missing = referenced.filter((label) => !available.has(label));
    if (missing.length === 0 || options.subjectUsesInserts) {
      kept.push(unit);
      continue;
    }

    excluded.push({ unitKey: unit.unitKey, missingFigures: missing });
  }

  return { kept, excluded };
}

export type ContextGateResult = {
  kept: QuestionUnit[];
  excluded: Array<{ unitKey: string; reason: string }>;
};

const DANGLING_CONTEXT_PATTERNS: RegExp[] = [
  /\b(these|the|those|both|following)\s+(two\s+|three\s+)?options\b/i,
  /\b(the|this|that|above|below|following|each)\s+(extract|source|passage)\b/i,
  /\bitem\s+[a-z]\b/i,
];

function unitText(unit: QuestionUnit): string {
  return unit.parts
    .map((part) => `${part.promptText ?? ""} ${part.contextText ?? ""}`)
    .join(" ")
    .toLowerCase();
}

function unitHasCapturedContext(unit: QuestionUnit): boolean {
  return unit.parts.some((part) =>
    (part.stemSpans?.length ?? 0) > 0
    || (part.referencedFigures?.length ?? 0) > 0
    || ((part.contextText ?? "").trim().length > 0),
  );
}

export function filterUnitsByDanglingContext(
  units: QuestionUnit[],
  options: { pageLayoutsBySource: Map<string, RegionPageLayout[]> },
): ContextGateResult {
  const layoutMapBySource = new Map<string, Map<number, RegionPageLayout>>();
  const getLayoutMap = (sourceRelativePath: string) => {
    let map = layoutMapBySource.get(sourceRelativePath);
    if (!map) {
      map = new Map((options.pageLayoutsBySource.get(sourceRelativePath) ?? []).map((layout) => [layout.pageNumber, layout]));
      layoutMapBySource.set(sourceRelativePath, map);
    }
    return map;
  };

  const kept: QuestionUnit[] = [];
  const excluded: ContextGateResult["excluded"] = [];

  for (const unit of units) {
    if (!isUnitRegionRenderable(unit, getLayoutMap(unit.sourceRelativePath)) || unitHasCapturedContext(unit)) {
      kept.push(unit);
      continue;
    }
    const text = unitText(unit);
    const matched = DANGLING_CONTEXT_PATTERNS.find((pattern) => pattern.test(text));
    const optionsResolvedInline = /\boptions\b/.test(text) && /\boption\s*1\b/.test(text);
    if (matched && !optionsResolvedInline) {
      excluded.push({ unitKey: unit.unitKey, reason: matched.source });
      continue;
    }
    kept.push(unit);
  }

  return { kept, excluded };
}
