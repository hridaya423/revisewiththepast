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

  it("reserves an answer page immediately after the question and attaches a footer to its last fragment", () => {
    const result = planGeneratedQuestions({
      questions: [{
        ...question("unit-1", 1, [fragment("question", 320, 100, 76)]),
        afterPage: { kind: "answer-space", marks: 8 },
        footer: { text: "Total for Question 1 = 8 marks", x: 42, y: 28, fontSize: 10.5 },
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

  it("splits an oversized support and question pair across pages", () => {
    const result = planGeneratedQuestions({
      questions: [question("unit-1", 1, [fragment("support", 300, 600), fragment("question", 300, 600, 550)])],
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.blocks[0].fragments.map((item) => item.outputPageIndex)).toEqual([0, 1]);
  });

  it("fits a multi-fragment support group using fixed gaps", () => {
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
    expect(fragments[0].scale).toBeLessThan(1);
    expect(fragments.map((item) => item.outputPageIndex)).toEqual([0, 0, 0]);
    expect(fragments[0].y - fragments[1].height * fragments[1].scale - fragments[1].y)
      .toBe(GENERATED_PAGE.fragmentGap);
    expect(fragments[1].y - fragments[2].height * fragments[2].scale - fragments[2].y)
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
