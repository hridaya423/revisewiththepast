import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { ActionButton } from "./action-button";
import { AdaptiveActions, prioritizeActions } from "./adaptive-actions";
import { AnimatedValue } from "./animated-value";
import { InlineNotice } from "./inline-notice";
import { MorphingSurface } from "./morphing-surface";
import { MotionTabs } from "./motion-tabs";
import { OperationProgress } from "./operation-progress";
import { PaperPreview } from "./paper-preview";

const render = (element: React.ReactNode) => renderToStaticMarkup(element);

describe("interaction primitives", () => {
  test("action button exposes its pending state", () => {
    const html = render(createElement(ActionButton, {
      state: "pending",
      idleLabel: "Generate paper",
      pendingLabel: "Building paper",
    }));

    expect(html).toContain("Building paper");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
  });

  test("operation progress announces specific work", () => {
    const html = render(createElement(OperationProgress, {
      kind: "ocr",
      label: "Reading response",
      compact: true,
    }));

    expect(html).toContain('role="status"');
    expect(html).toContain("Reading response");
    expect(html).toContain('data-operation="ocr"');
  });

  test("motion tabs render accessible tab relationships", () => {
    const html = render(createElement(MotionTabs, {
      label: "Paper builder steps",
      items: [
        { value: "subject", label: "Subject", content: "Choose a subject" },
        { value: "topics", label: "Topics", content: "Choose topics" },
      ],
      defaultValue: "subject",
    }));

    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-controls="');
  });

  test("inline notices use alert only for failures", () => {
    expect(render(createElement(InlineNotice, { tone: "failure", message: "Could not save" }))).toContain('role="alert"');
    expect(render(createElement(InlineNotice, { tone: "confirmed", message: "Saved" }))).toContain('role="status"');
  });

  test("animated values separate visual digits from announcements", () => {
    const html = render(createElement(AnimatedValue, { value: 42, label: "marks" }));

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("42 marks");
  });

  test("morphing surfaces keep trigger and dialog semantics", () => {
    const html = render(createElement(MorphingSurface, {
      title: "Paper preview",
      trigger: "Open paper",
    }, "Paper content"));

    expect(html).toContain("Open paper");
    expect(html).toContain("<dialog");
    expect(html).toContain('aria-labelledby="');
  });

  test("paper previews use real image descriptions", () => {
    const html = render(createElement(PaperPreview, {
      images: [{ src: "/landing/aqa-geography-paper-page.png", alt: "Geography paper" }],
    }));

    expect(html).toContain('alt="Geography paper"');
  });

  test("adaptive actions preserve priority ordering", () => {
    const actions = prioritizeActions([
      { id: "scheme", label: "Mark scheme", priority: 1, onSelect: () => undefined },
      { id: "score", label: "Auto-score", priority: 3, onSelect: () => undefined },
      { id: "source", label: "Source PDF", priority: 2, onSelect: () => undefined },
    ]);

    expect(actions.map((action) => action.id)).toEqual(["score", "source", "scheme"]);
    expect(render(createElement(AdaptiveActions, { actions, label: "Question actions" }))).toContain('aria-label="Question actions"');
  });
});
