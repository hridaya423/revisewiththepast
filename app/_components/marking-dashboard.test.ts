import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { MarkingDashboard } from "./marking-dashboard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

type Submission = Parameters<typeof MarkingDashboard>[0]["initialSubmissions"][number];
const submission = (input: Partial<Submission> = {}): Submission => ({
  _id: "attempt", subjectKey: "aqa-business", subjectSlug: "business", boardCode: "aqa",
  savedPaperId: "paper", savedPaperTitle: "Unfinished paper", savedPaperQuestionCount: 8,
  status: "uploaded", updatedAt: 100, uploadedPageCount: 2, confirmedCount: 2, aiSuggestedCount: 1,
  confirmedAwardedMarks: 3, confirmedMaxMarks: 5, paperMaxMarks: 60, reviewRequiredCount: 0,
  questionProgress: [], gapTopics: [], ...input,
});

function render(submissions: Submission[]) {
  return renderToStaticMarkup(createElement(MarkingDashboard, { initialSavedPapers: [], initialSubmissions: submissions, userName: "Example student" }));
}

describe("My papers", () => {
  it("puts an unfinished attempt ahead of a newer reviewed paper", () => {
    const html = render([submission(), submission({ _id: "newer", savedPaperTitle: "Finished paper", updatedAt: 200, confirmedCount: 8 })]);
    expect(html).toMatch(/id="continue-marking-title"[^>]*>Unfinished paper</);
    expect(html).not.toContain("<iframe");
  });

  it("uses the reviewed denominator rather than treating unreviewed marks as zero", () => {
    const html = render([submission()]);
    expect(html).toContain("3 / 5");
    expect(html).not.toContain("3 / 60");
    expect(html).toContain("2 of 8 questions reviewed");
  });

  it("does not present a zero score before review", () => {
    const html = render([submission({ confirmedCount: 0, confirmedAwardedMarks: 0, confirmedMaxMarks: 0 })]);
    expect(html).toContain("No marks confirmed yet");
    expect(html).not.toContain("0 / 60");
  });

  it("does not ask students to continue a completed review", () => {
    expect(render([submission({ confirmedCount: 8 })])).not.toContain('id="continue-marking-title"');
  });
});
