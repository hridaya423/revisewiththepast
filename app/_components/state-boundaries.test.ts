import { describe, expect, it } from "vitest";
import { authFormReducer, initialAuthFormState } from "./auth-form-model";
import { builderSelectionReducer, mergeSubjectDetail } from "./paper-maker/state-model";

describe("auth form state boundary", () => {
  it("clears field errors and server feedback when switching mode", () => {
    const state = { ...initialAuthFormState, serverError: "bad", emailField: { value: "x", error: "invalid", touched: true } };
    const next = authFormReducer(state, { type: "mode-changed", mode: "sign-up" });
    expect(next.mode).toBe("sign-up");
    expect(next.serverError).toBeNull();
    expect(next.emailField).toMatchObject({ value: "x", error: "", touched: false });
  });

  it("clears stale validation errors when a later submission is valid", () => {
    const state = { ...initialAuthFormState, emailField: { value: "valid@example.com", error: "Old error", touched: true } };
    const next = authFormReducer(state, { type: "validation-failed", fields: {} });
    expect(next.emailField).toMatchObject({ value: "valid@example.com", error: "", touched: true });
  });
});

describe("paper maker state boundary", () => {
  it("overlays loaded detail onto the latest subject props", () => {
    const subjects = [{ key: "aqa-geography", label: "old", topics: [], tiers: [], detailLoaded: false } as never];
    const result = mergeSubjectDetail(subjects, { key: "aqa-geography", taggedQuestionUnits: 2, benchmarkMinutesPerMark: 1, topics: [], topicsByTier: {}, tiers: [], detailLoaded: true });
    expect(result[0]).toMatchObject({ label: "old", taggedQuestionUnits: 2, detailLoaded: true });
  });

  it("keeps coupled target values together when marks change", () => {
    const state = { selectedSubjectKey: "aqa-geography", selectedLeafIds: new Set<string>(), selectedPaperCodes: new Set<string>(), paperSourcesCustomized: false, selectedTier: "foundation", targetMarks: 40, timeMinutes: 60, targetMode: "marks", questionMix: "balanced" } as never;
    expect(builderSelectionReducer(state, { type: "time-changed", targetMarks: 50, timeMinutes: 75 })).toMatchObject({ targetMarks: 50, timeMinutes: 75, targetMode: "time" });
  });

  it("resets subject selections while preserving target mode", () => {
    const state = { selectedSubjectKey: "aqa-geography", selectedLeafIds: new Set(["old"]), selectedPaperCodes: new Set(["old-paper"]), paperSourcesCustomized: true, selectedTier: "foundation", targetMarks: 40, timeMinutes: 60, targetMode: "time", questionMix: "balanced" } as never;
    const next = builderSelectionReducer(state, { type: "subject-changed", subjectKey: "aqa-geography", tier: "foundation", paperCodes: new Set(["1"]), targetMarks: 30, timeMinutes: 45 });
    expect(next).toMatchObject({ selectedSubjectKey: "aqa-geography", selectedTier: "foundation", paperSourcesCustomized: false, targetMarks: 30, timeMinutes: 45, targetMode: "time" });
    expect(next.selectedLeafIds).toEqual(new Set());
    expect(next.selectedPaperCodes).toEqual(new Set(["1"]));
  });

  it("keeps only available topics when changing tier", () => {
    const state = { selectedSubjectKey: "edexcel-mathematics", selectedLeafIds: new Set(["shared", "removed"]), selectedPaperCodes: new Set(), paperSourcesCustomized: false, selectedTier: "foundation", targetMarks: 40, timeMinutes: 60, targetMode: "marks", questionMix: "balanced" } as never;
    const next = builderSelectionReducer(state, { type: "tier-changed", tier: "higher", leafIds: new Set(["shared"]) });
    expect(next.selectedTier).toBe("higher");
    expect(next.selectedLeafIds).toEqual(new Set(["shared"]));
  });

  it("applies sequential topic toggles and removals from the latest selection", () => {
    const state = { selectedSubjectKey: "aqa-geography", selectedLeafIds: new Set<string>(), selectedPaperCodes: new Set<string>(), paperSourcesCustomized: false, selectedTier: "foundation", targetMarks: 40, timeMinutes: 60, targetMode: "marks", questionMix: "balanced" } as never;
    const afterFirstToggle = builderSelectionReducer(state, { type: "leaf-selection-toggled", leafIds: ["algebra"] });
    const afterSecondToggle = builderSelectionReducer(afterFirstToggle, { type: "leaf-selection-toggled", leafIds: ["geometry"] });
    const afterRemoval = builderSelectionReducer(afterSecondToggle, { type: "leaf-selection-removed", leafIds: ["algebra"] });
    expect(afterSecondToggle.selectedLeafIds).toEqual(new Set(["algebra", "geometry"]));
    expect(afterRemoval.selectedLeafIds).toEqual(new Set(["geometry"]));
  });

  it("selects every leaf when toggling a partially selected topic group", () => {
    const state = { selectedSubjectKey: "aqa-geography", selectedLeafIds: new Set(["algebra"]), selectedPaperCodes: new Set<string>(), paperSourcesCustomized: false, selectedTier: "foundation", targetMarks: 40, timeMinutes: 60, targetMode: "marks", questionMix: "balanced" } as never;
    const next = builderSelectionReducer(state, { type: "leaf-selection-toggled", leafIds: ["algebra", "geometry"] });
    expect(next.selectedLeafIds).toEqual(new Set(["algebra", "geometry"]));
  });
});
