import { describe, expect, it } from "vitest";

import {
  GENERATED_PAGE,
  planGeneratedQuestions,
  type PreparedQuestionFragment,
} from "./generated-layout";

function fragment(
  kind: PreparedQuestionFragment["kind"],
  width = 300,
  height = 120,
  promptBaseline?: number,
): PreparedQuestionFragment {
  return {
    fragmentId: `${kind}-${width}-${height}`,
    unitKey: "unit-1",
    sourcePageNumber: 1,
    crop: { left: 0, right: width, bottom: 0, top: height },
    width,
    height,
    kind,
    identity: promptBaseline === undefined ? null : {
      pageNumber: 1,
      numberBounds: { x0: 0, x1: 20, y0: 0, y1: 20 },
      promptBaseline,
      promptBounds: { x0: 20, x1: width, y0: 0, y1: height },
    },
  };
}

function question(
  unitKey: string,
  number: number,
  fragments: [PreparedQuestionFragment, ...PreparedQuestionFragment[]],
) {
  return { unitKey, number, fragments };
}

describe("planGeneratedQuestions", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid question number %s",
    (number) => {
      expect(planGeneratedQuestions({
        questions: [question("unit-1", number, [fragment("question", 320, 100, 76)])],
      })).toEqual({ kind: "unrenderable", unitKey: "unit-1", reason: "invalid-question-number" });
    },
  );

  it("rejects duplicate generated question numbers", () => {
    expect(planGeneratedQuestions({
      questions: [
        question("unit-1", 1, [fragment("question", 320, 100, 76)]),
        question("unit-2", 1, [fragment("question", 320, 100, 76)]),
      ],
    })).toEqual({ kind: "unrenderable", unitKey: "unit-2", reason: "invalid-question-number" });
  });

  it("uses the shared number column and aligns its baseline to the first question prompt", () => {
    const result = planGeneratedQuestions({
      questions: [question("unit-1", 7, [fragment("question", 320, 100, 76)])],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const [block] = result.blocks;
    const [placed] = block.fragments;
    expect(block.numberSlot.x).toBe(GENERATED_PAGE.numberX);
    expect(block.numberSlot.baseline).toBe(
      placed.y + ((placed.identity?.promptBaseline ?? 0) - placed.crop.bottom) * placed.scale,
    );
    expect(placed.x).toBe(GENERATED_PAGE.contentX);
  });

  it("accepts source number bounds in a separate stem crop", () => {
    const splitAnchorFragment = fragment("question", 320, 100, 76);
    if (splitAnchorFragment.identity === null) throw new Error("Missing test identity anchor");
    splitAnchorFragment.identity = {
      ...splitAnchorFragment.identity,
      numberBounds: { x0: 0, x1: 20, y0: 140, y1: 160 },
    };

    expect(planGeneratedQuestions({ questions: [question("unit-1", 1, [splitAnchorFragment])] }).kind).toBe("success");
  });

  it("anchors the generated number to the source number row when the prompt is on a later line", () => {
    const offRowFragment = fragment("question", 320, 400, 62);
    if (offRowFragment.identity === null) throw new Error("Missing test identity anchor");
    offRowFragment.identity = {
      ...offRowFragment.identity,
      numberBounds: { x0: 0, x1: 20, y0: 380, y1: 392 },
      promptBaseline: 62,
      promptBounds: { x0: 20, x1: 310, y0: 60, y1: 75 },
    };

    const result = planGeneratedQuestions({ questions: [question("unit-1", 1, [offRowFragment])] });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const [placed] = result.blocks[0].fragments;
    expect(result.blocks[0].numberSlot.baseline).toBe(
      placed.y + (380 - placed.crop.bottom) * placed.scale,
    );
  });

  // Edexcel anchors sometimes resolve numberBounds to an indented part-marker
  // column (x≈89) rather than the margin question number. When earlier content
  // sits above the marker row the real number row is unreachable, so the
  // generated number must head the unit's first fragment instead.
  function indentedAnchorFragment(height: number): PreparedQuestionFragment {
    const target = fragment("question", 400, height, height - 212);
    target.crop = { left: 63, right: 463, bottom: 0, top: height };
    if (target.identity === null) throw new Error("Missing test identity anchor");
    target.identity = {
      pageNumber: 1,
      numberBounds: { x0: 89, x1: 102, y0: height - 212, y1: height - 200 },
      promptBaseline: height - 205,
      promptBounds: { x0: 108, x1: 440, y0: height - 212, y1: height - 200 },
    };
    return target;
  }

  it("heads the question crop when the anchor resolves to a part marker below the stem", () => {
    const result = planGeneratedQuestions({
      questions: [question("unit-1", 1, [indentedAnchorFragment(500)])],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const [placed] = result.blocks[0].fragments;
    expect(result.blocks[0].numberSlot.baseline).toBe(
      placed.y + (placed.height - 12) * placed.scale,
    );
  });

  it("heads the support fragment when the part-marker anchor sits on a later source page", () => {
    const support = fragment("support", 400, 200);
    const result = planGeneratedQuestions({
      questions: [question("unit-1", 1, [support, indentedAnchorFragment(300)])],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const [placedSupport] = result.blocks[0].fragments;
    expect(result.blocks[0].numberSlot.outputPageIndex).toBe(placedSupport.outputPageIndex);
    expect(result.blocks[0].numberSlot.baseline).toBe(
      placedSupport.y + (placedSupport.height - 12) * placedSupport.scale,
    );
  });

  it("keeps the number beside a part marker that genuinely heads a stem-less question", () => {
    const stemless = indentedAnchorFragment(300);
    if (stemless.identity === null) throw new Error("Missing test identity anchor");
    stemless.identity = {
      ...stemless.identity,
      numberBounds: { x0: 89, x1: 102, y0: 288, y1: 300 },
      promptBaseline: 295,
      promptBounds: { x0: 108, x1: 440, y0: 288, y1: 300 },
    };

    const result = planGeneratedQuestions({
      questions: [question("unit-1", 1, [stemless])],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const [placed] = result.blocks[0].fragments;
    expect(result.blocks[0].numberSlot.baseline).toBe(
      placed.y + (295 - placed.crop.bottom) * placed.scale,
    );
  });

  it("reserves an answer page immediately after the question and attaches a footer to its last fragment", () => {
    const result = planGeneratedQuestions({
      questions: [{
        ...question("unit-1", 1, [fragment("question", 320, 100, 76)]),
        afterPage: { kind: "answer-space", marks: 8 },
        footer: { text: "Total for Question 1 = 8 marks" },
      }, {
        ...question("unit-2", 2, [fragment("question", 320, 100, 76)]),
      }],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.blocks[0]?.afterPage).toMatchObject({ outputPageIndex: 1, marks: 8 });
    expect(result.blocks[0]?.footer).toMatchObject({ outputPageIndex: 0, text: "Total for Question 1 = 8 marks" });
    expect(result.blocks[1]?.numberSlot.outputPageIndex).toBe(2);
  });

  it("attaches the maths footer directly below the last fragment with reserved space", () => {
    const result = planGeneratedQuestions({
      questions: [{
        ...question("unit-1", 1, [fragment("question", 320, 100, 76)]),
        footer: { text: "Total for Question 1 = 3 marks" },
      }, question("unit-2", 2, [fragment("question", 320, 100, 76)])],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const [first, second] = result.blocks;
    const lastFirstFragment = first.fragments[first.fragments.length - 1];
    expect(first.footer).toMatchObject({
      outputPageIndex: lastFirstFragment.outputPageIndex,
      x: GENERATED_PAGE.contentX,
      y: lastFirstFragment.y - 26,
      ruleY: lastFirstFragment.y - 12,
    });
    const secondTop = second.fragments[0].y + second.fragments[0].height * second.fragments[0].scale;
    expect(secondTop).toBeLessThanOrEqual((first.footer?.ruleY ?? 0) - GENERATED_PAGE.questionGap);
  });

  it("keeps support attached to the first question fragment", () => {
    const result = planGeneratedQuestions({
      questions: [question("unit-1", 1, [fragment("support", 450, 120), fragment("question", 450, 180, 90)])],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const [support, firstQuestion] = result.blocks[0].fragments;
    expect(support.outputPageIndex).toBe(firstQuestion.outputPageIndex);
    expect(firstQuestion.y + firstQuestion.height * firstQuestion.scale).toBe(
      support.y - GENERATED_PAGE.fragmentGap,
    );
  });

  it("breaks between questions and continues a question across pages", () => {
    const result = planGeneratedQuestions({
      questions: [
        question("unit-1", 1, [fragment("question", 479, 500, 450), fragment("continuation", 479, 500)]),
        question("unit-2", 2, [fragment("question", 479, 500, 450)]),
      ],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.blocks[0].fragments.map((item) => item.outputPageIndex)).toEqual([0, 1]);
    expect(result.blocks[1].fragments[0].outputPageIndex).toBe(2);
    expect(result.blocks[0].numberSlot.outputPageIndex).toBe(0);
    expect(result.blocks[0].fragments.filter((item) => item.kind === "question").length).toBe(1);
  });

  it("places a generated number once on the page containing the first question", () => {
    const result = planGeneratedQuestions({
      questions: [question("unit-1", 1, [
        fragment("question", 479, 500, 450),
        fragment("continuation", 479, 500),
        fragment("continuation", 479, 500),
      ])],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const block = result.blocks[0];
    const firstQuestion = block.fragments.find((item) => item.kind === "question");
    expect(firstQuestion).toBeDefined();
    expect(block.numberSlot.outputPageIndex).toBe(firstQuestion?.outputPageIndex);
    expect(block.fragments.filter((item) => item.kind === "question")).toHaveLength(1);
  });

  it("moves an attached support pair together at a page break", () => {
    const result = planGeneratedQuestions({
      questions: [
        question("unit-1", 1, [fragment("question", 479, 500, 450)]),
        question("unit-2", 2, [fragment("support", 479, 300), fragment("question", 479, 300, 250)]),
      ],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const [support, firstQuestion] = result.blocks[1].fragments;
    expect(support.outputPageIndex).toBe(1);
    expect(firstQuestion.outputPageIndex).toBe(1);
  });

  it("rejects content that would be smaller than the readable scale", () => {
    const result = planGeneratedQuestions({
      questions: [question("unit-1", 1, [fragment("question", 700, 100, 80)])],
    });

    expect(result).toEqual({
      kind: "unrenderable",
      unitKey: "unit-1",
      reason: "minimum-readable-scale",
    });
  });

  it("splits a question fragment at a white gap instead of leaving a near-empty page", () => {
    const splittable = fragment("question", 479, 500, 480);
    if (splittable.identity === null) throw new Error("Missing test identity anchor");
    splittable.identity = {
      ...splittable.identity,
      promptBounds: { x0: 20, x1: 479, y0: 420, y1: 500 },
    };
    splittable.splitGaps = [300, 380, 440].map((y) => ({ y, pageInk: 0.02 }));
    const result = planGeneratedQuestions({
      questions: [
        question("unit-1", 1, [fragment("question", 479, 500, 480)]),
        question("unit-2", 2, [splittable]),
      ],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const [first, second] = result.blocks[1].fragments;
    expect(first.outputPageIndex).toBe(0);
    expect(first.crop.bottom).toBe(300);
    expect(second.outputPageIndex).toBe(1);
    expect(second.crop.top).toBe(300);
    expect(second.identity).toBeNull();
    expect(second.sourceFragmentId).toBe(first.fragmentId);
    expect(result.blocks[1].numberSlot.outputPageIndex).toBe(0);
  });

  it("rejects a split gap that would strand a tiny remainder on the next page", () => {
    const splittable = fragment("question", 479, 500, 480);
    if (splittable.identity === null) throw new Error("Missing test identity anchor");
    splittable.identity = {
      ...splittable.identity,
      promptBounds: { x0: 20, x1: 479, y0: 420, y1: 500 },
    };
    splittable.splitGaps = [{ y: 110, pageInk: 0.02 }, { y: 300, pageInk: 0.02 }];
    const result = planGeneratedQuestions({
      questions: [
        question("unit-1", 1, [fragment("question", 479, 290, 270)]),
        question("unit-2", 2, [splittable]),
      ],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const [first, second] = result.blocks[1].fragments;
    expect(first.crop.bottom).toBe(300);
    expect(second.crop.top).toBe(300);
    // 100pt remainder (~a lone options table) is rejected for 280pt.
    expect(second.crop.top - second.crop.bottom).toBeGreaterThanOrEqual(120);
  });

  it("moves markers below the split onto the remainder fragment", () => {
    const splittable = fragment("question", 479, 500, 480);
    if (splittable.identity === null) throw new Error("Missing test identity anchor");
    splittable.identity = {
      ...splittable.identity,
      promptBounds: { x0: 20, x1: 479, y0: 420, y1: 500 },
    };
    splittable.splitGaps = [{ y: 300, pageInk: 0.02 }];
    splittable.markers = [
      { numberBounds: { x0: 0, x1: 30, y0: 430, y1: 450 }, partNumber: "1", text: "01.1" },
      { numberBounds: { x0: 0, x1: 30, y0: 100, y1: 120 }, partNumber: "2", text: "01.2" },
    ];
    const result = planGeneratedQuestions({
      questions: [
        question("unit-1", 1, [fragment("question", 479, 500, 480)]),
        question("unit-2", 2, [splittable]),
      ],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const [first, second] = result.blocks[1].fragments;
    expect(first.markers?.map((marker) => marker.partNumber)).toEqual(["1"]);
    expect(second.markers?.map((marker) => marker.partNumber)).toEqual(["2"]);
  });

  it("splits an oversized fragment repeatedly across multiple pages", () => {
    const splittable = fragment("question", 479, 1400, 1380);
    if (splittable.identity === null) throw new Error("Missing test identity anchor");
    splittable.identity = {
      ...splittable.identity,
      promptBounds: { x0: 20, x1: 479, y0: 1330, y1: 1400 },
    };
    splittable.splitGaps = [100, 300, 500, 700, 900, 1100, 1200].map((y) => ({ y, pageInk: 0.02 }));
    const result = planGeneratedQuestions({
      questions: [question("unit-1", 1, [splittable])],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const fragments = result.blocks[0].fragments;
    expect(fragments.length).toBeGreaterThanOrEqual(2);
    for (const placed of fragments) {
      expect(placed.y).toBeGreaterThanOrEqual(GENERATED_PAGE.bottom);
      expect(placed.y + placed.height * placed.scale).toBeLessThanOrEqual(
        GENERATED_PAGE.height - GENERATED_PAGE.top + 1e-9,
      );
    }
    expect(fragments[0].crop.top).toBe(1400);
    expect(fragments[fragments.length - 1].crop.bottom).toBe(0);
  });

  it("retries the split on a fresh page when an oversized fragment cannot split near a page bottom", () => {
    const filler = fragment("question", 479, 700, 690);
    const tall = fragment("question", 479, 820, 810);
    if (tall.identity === null) throw new Error("Missing test identity anchor");
    tall.fragmentId = "tall";
    tall.identity = { ...tall.identity, promptBounds: { x0: 20, x1: 479, y0: 790, y1: 820 } };
    tall.splitGaps = [{ y: 300, pageInk: 0.02 }];
    const result = planGeneratedQuestions({
      questions: [question("unit-1", 1, [filler]), question("unit-2", 2, [tall])],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const pieces = result.blocks[1].fragments;
    expect(pieces.map((piece) => [piece.outputPageIndex, piece.crop.bottom, piece.crop.top])).toEqual([[1, 300, 820], [2, 0, 300]]);
    for (const piece of pieces) expect(piece.y).toBeGreaterThanOrEqual(GENERATED_PAGE.bottom);
  });

  it("does not split when no white gap yields a large enough top part", () => {
    const unsplittable = fragment("question", 479, 500, 480);
    if (unsplittable.identity === null) throw new Error("Missing test identity anchor");
    unsplittable.identity = {
      ...unsplittable.identity,
      promptBounds: { x0: 20, x1: 479, y0: 420, y1: 500 },
    };
    unsplittable.splitGaps = [60, 100, 450].map((y) => ({ y, pageInk: 0.02 }));
    const result = planGeneratedQuestions({
      questions: [
        question("unit-1", 1, [fragment("question", 479, 500, 480)]),
        question("unit-2", 2, [unsplittable]),
      ],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.blocks[1].fragments).toHaveLength(1);
    expect(result.blocks[1].fragments[0].outputPageIndex).toBe(1);
  });

  it("refuses a split whose remainder would strand a near-blank page", () => {
    const splittable = fragment("question", 479, 500, 480);
    if (splittable.identity === null) throw new Error("Missing test identity anchor");
    splittable.identity = {
      ...splittable.identity,
      promptBounds: { x0: 20, x1: 479, y0: 420, y1: 500 },
    };
    splittable.splitGaps = [300, 380].map((y) => ({ y, pageInk: 0.0005 }));
    const result = planGeneratedQuestions({
      questions: [
        question("unit-1", 1, [fragment("question", 479, 500, 480)]),
        question("unit-2", 2, [splittable]),
      ],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.blocks[1].fragments).toHaveLength(1);
    expect(result.blocks[1].fragments[0].outputPageIndex).toBe(1);
  });

  it("splits an oversized support and question pair across pages", () => {
    const result = planGeneratedQuestions({
      questions: [question("unit-1", 1, [fragment("support", 300, 600), fragment("question", 300, 600, 550)])],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.blocks[0].fragments.map((item) => item.outputPageIndex)).toEqual([0, 1]);
  });

  it("flows a multi-fragment support group across pages at readable scale", () => {
    const result = planGeneratedQuestions({
      questions: [question("unit-1", 1, [
        fragment("support", 300, 300),
        fragment("support", 300, 300),
        fragment("question", 300, 380, 330),
      ])],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const fragments = result.blocks[0].fragments;
    expect(fragments[0].scale).toBe(1);
    expect(fragments.map((item) => item.outputPageIndex)).toEqual([0, 0, 1]);
    expect(fragments[0].y - fragments[1].height * fragments[1].scale - fragments[1].y)
      .toBe(GENERATED_PAGE.fragmentGap);
    for (const placed of fragments) {
      expect(placed.y).toBeGreaterThanOrEqual(GENERATED_PAGE.bottom);
      expect(placed.y + placed.height * placed.scale).toBeLessThanOrEqual(
        GENERATED_PAGE.height - GENERATED_PAGE.top + 1e-9,
      );
    }
  });

  it("uses questionGap between blocks and no fragmentGap across page breaks", () => {
    const result = planGeneratedQuestions({
      questions: [
        question("unit-1", 1, [fragment("question", 300, 300, 250)]),
        question("unit-2", 2, [fragment("question", 300, 400, 350)]),
      ],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const first = result.blocks[0].fragments[0];
    const second = result.blocks[1].fragments[0];
    expect(first.outputPageIndex).toBe(second.outputPageIndex);
    expect(first.y - second.height * second.scale - second.y).toBe(GENERATED_PAGE.questionGap);

    const continuationResult = planGeneratedQuestions({
      questions: [question("unit-1", 1, [
        fragment("question", 479, 500, 450),
        fragment("continuation", 479, 500),
      ])],
    });
    expect(continuationResult.kind).toBe("success");
    if (continuationResult.kind !== "success") return;
    const [firstFragment, continuation] = continuationResult.blocks[0].fragments;
    expect(continuation.outputPageIndex).toBe(firstFragment.outputPageIndex + 1);
    expect(continuation.y + continuation.height * continuation.scale)
      .toBeCloseTo(GENERATED_PAGE.height - GENERATED_PAGE.top);
  });

  const invalidOrders: Array<[string, [PreparedQuestionFragment, ...PreparedQuestionFragment[]]]> = [
    ["continuation before first question", [fragment("continuation"), fragment("question", 300, 100, 80)]],
    ["support after first question", [fragment("question", 300, 100, 80), fragment("support")]],
  ];

  it.each(invalidOrders)("rejects %s", (_description, fragments) => {
    expect(planGeneratedQuestions({ questions: [question("unit-1", 1, fragments)] })).toEqual({
      kind: "unrenderable",
      unitKey: "unit-1",
      reason: "invalid-fragment-order",
    });
  });

  it.each([
    ["NaN baseline", { ...fragment("question", 300, 100, 80), identity: {
      pageNumber: 1,
      numberBounds: { x0: 0, x1: 20, y0: 0, y1: 20 },
      promptBaseline: Number.NaN,
      promptBounds: { x0: 20, x1: 300, y0: 0, y1: 100 },
    } }],
    ["baseline outside crop", { ...fragment("question", 300, 100, 80), identity: {
      pageNumber: 1,
      numberBounds: { x0: 0, x1: 20, y0: 0, y1: 20 },
      promptBaseline: 101,
      promptBounds: { x0: 20, x1: 300, y0: 0, y1: 100 },
    } }],
    ["baseline outside prompt bounds", { ...fragment("question", 300, 100, 80), identity: {
      pageNumber: 1,
      numberBounds: { x0: 0, x1: 20, y0: 0, y1: 20 },
      promptBaseline: 80,
      promptBounds: { x0: 20, x1: 300, y0: 20, y1: 70 },
    } }],
  ] as const)("rejects %s prompt anchors", (_description, fragmentWithInvalidAnchor) => {
    expect(planGeneratedQuestions({ questions: [question("unit-1", 1, [fragmentWithInvalidAnchor])] })).toEqual({
      kind: "unrenderable",
      unitKey: "unit-1",
      reason: "invalid-prompt-anchor",
    });
  });

  it("keeps every placed fragment inside the generated page bounds", () => {
    const result = planGeneratedQuestions({
      questions: [question("unit-1", 1, [fragment("question", 300, 300, 240), fragment("continuation", 300, 300)])],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    for (const placed of result.blocks[0].fragments) {
      expect(placed.x).toBeGreaterThanOrEqual(GENERATED_PAGE.contentX);
      expect(placed.x + placed.width * placed.scale).toBeLessThanOrEqual(
        GENERATED_PAGE.contentX + GENERATED_PAGE.contentWidth,
      );
      expect(placed.y).toBeGreaterThanOrEqual(GENERATED_PAGE.bottom);
      expect(placed.y + placed.height * placed.scale).toBeLessThanOrEqual(
        GENERATED_PAGE.height - GENERATED_PAGE.top + 1e-9,
      );
    }
  });

  it("is deterministic and has no board or subject input", () => {
    const input = {
      questions: [question("unit-1", 1, [fragment("question", 300, 100, 80)])],
    };
    expect(planGeneratedQuestions(input)).toEqual(planGeneratedQuestions(input));
  });
});
