import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { ActionButton } from "./action-button";
import { AnimatedValue } from "./animated-value";
import { InlineNotice } from "./inline-notice";
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

  test("paper previews use real image descriptions", () => {
    const html = render(createElement(PaperPreview, {
      images: [{ src: "/landing/aqa-geography-paper-page.png", alt: "Geography paper" }],
    }));

    expect(html).toContain('alt="Geography paper"');
  });

});
