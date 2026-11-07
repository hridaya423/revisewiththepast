import { describe, expect, it } from "vitest";

import { BUILDER_DRAFT_MAX_AGE, parseBuilderDraft, serializeBuilderDraft } from "./builder-draft";
import type { WorkspaceSubjectOption } from "./state-model";

const now = 1_000_000_000;
const subject: WorkspaceSubjectOption = {
  key: "edexcel-mathematics-higher",
  label: "Mathematics",
  boardLabel: "Edexcel",
  description: "",
  taggedQuestionUnits: 2,
  topicSelectionEnabled: true,
  generationEnabled: true,
  availabilityNote: "",
  recommendedMinutesPerMark: 1,
  benchmarkMinutesPerMark: null,
  paperOptions: [{ code: "1H", label: "Paper 1" }],
  defaultPaperCodes: ["1H"],
  topics: [],
  topicsByTier: { higher: [{ id: "algebra", label: "Algebra", leafTopicIds: ["a"], questionUnitCount: 2 }] },
  tiers: [{ key: "higher", label: "Higher", taggedQuestionUnits: 2 }],
  detailLoaded: true,
};
const saved = {
  version: 1,
  updatedAt: now,
  subjectKey: subject.key,
  tier: "higher",
  leafIds: ["a", "removed"],
  paperCodes: ["1H", "removed"],
  paperSourcesCustomized: true,
  targetMarks: 40,
  timeMinutes: 40,
  targetMode: "time",
  questionMix: "balanced",
  paperCount: 2,
  stage: "paper",
};

describe("builder draft recovery", () => {
  it("restores choices and removes topics and source papers no longer in the course", () => {
    const result = parseBuilderDraft(JSON.stringify(saved), [subject], now);
    expect(result?.selection.selectedLeafIds).toEqual(new Set(["a"]));
    expect(result?.selection.selectedPaperCodes).toEqual(new Set(["1H"]));
    expect(result).toMatchObject({ paperCount: 2, stage: "paper", selection: { targetMode: "time" } });
  });

  it("round-trips only builder preferences, not unrelated private data", () => {
    const draft = parseBuilderDraft(JSON.stringify(saved), [subject], now);
    expect(draft).not.toBeNull();
    const serialized = serializeBuilderDraft(draft!, now);
    expect(parseBuilderDraft(serialized, [subject], now)).toEqual(draft);
    expect(Object.keys(JSON.parse(serialized))).toEqual([
      "version", "updatedAt", "subjectKey", "tier", "leafIds", "paperCodes",
      "paperSourcesCustomized", "targetMarks", "timeMinutes", "targetMode", "questionMix", "paperCount", "stage",
    ]);
  });

  it("keeps topic IDs until the catalogue's course detail has loaded", () => {
    const result = parseBuilderDraft(JSON.stringify(saved), [{ ...subject, detailLoaded: false }], now);
    expect(result?.selection.selectedLeafIds).toEqual(new Set(["a", "removed"]));
  });

  it("returns to topics if every saved topic was removed", () => {
    const result = parseBuilderDraft(JSON.stringify({ ...saved, leafIds: ["removed"] }), [subject], now);
    expect(result?.stage).toBe("topics");
  });

  it("resets incompatible topic choices when the tier is no longer available", () => {
    const result = parseBuilderDraft(JSON.stringify({ ...saved, tier: "foundation" }), [subject], now);
    expect(result?.selection.selectedTier).toBe("higher");
    expect(result?.selection.selectedLeafIds.size).toBe(0);
    expect(result?.stage).toBe("topics");
  });

  it.each([null, "", "{", "null", JSON.stringify({ ...saved, version: 2 }), JSON.stringify({ ...saved, subjectKey: "missing" }), JSON.stringify({ ...saved, targetMarks: -1 }), JSON.stringify({ ...saved, paperCount: 4 }), JSON.stringify({ ...saved, updatedAt: now - BUILDER_DRAFT_MAX_AGE - 1 }), JSON.stringify({ ...saved, updatedAt: now + 60_000 })])("ignores invalid, expired or unknown drafts: %s", (raw) => {
    expect(parseBuilderDraft(raw, [subject], now)).toBeNull();
  });
});
