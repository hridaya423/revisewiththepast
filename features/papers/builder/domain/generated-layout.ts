import type { BoundingBox, QuestionIdentityAnchor } from "@/shared/domain/paper";

export type SourcePageCrop = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

export type PreparedQuestionFragment = {
  fragmentId: string;
  unitKey: string;
  sourcePageNumber: number;
  crop: SourcePageCrop;
  identity: QuestionIdentityAnchor | null;
  width: number;
  height: number;
  kind: "support" | "question" | "continuation";
};

export type NumberSlot = {
  outputPageIndex: number;
  x: number;
  baseline: number;
  fontSize: number;
};

export type PlacedFragment = PreparedQuestionFragment & {
  outputPageIndex: number;
  x: number;
  y: number;
  scale: number;
};

export type PlacedQuestionBlock = {
  unitKey: string;
  number: number;
  numberSlot: NumberSlot;
  fragments: [PlacedFragment, ...PlacedFragment[]];
  afterPage?: { kind: "answer-space"; marks: number; outputPageIndex: number };
  footer?: {
    text: string;
    outputPageIndex: number;
    x: number;
    y: number;
    fontSize: number;
  };
};

const generatedNumberX = 40;
const generatedContentLeft = 76;
const generatedContentRight = 555.28;

export const GENERATED_PAGE = {
  width: 595.28,
  height: 841.89,
  top: 48,
  bottom: 48,
  numberX: generatedNumberX,
  contentLeft: generatedContentLeft,
  contentRight: generatedContentRight,
  numberColumnWidth: generatedContentLeft - generatedNumberX,
  contentX: generatedContentLeft,
  contentWidth: generatedContentRight - generatedContentLeft,
  fragmentGap: 18,
  questionGap: 24,
  numberFontSize: 13,
  minimumReadableScale: 0.72,
} as const;

export type GeneratedLayoutUnrenderableReason =
  | "invalid-question-number"
  | "invalid-fragment"
  | "invalid-fragment-order"
  | "invalid-prompt-anchor"
  | "missing-prompt-anchor"
  | "minimum-readable-scale";

export type GeneratedLayoutPlan =
  | { kind: "success"; blocks: PlacedQuestionBlock[] }
  | { kind: "unrenderable"; unitKey: string; reason: GeneratedLayoutUnrenderableReason };

type QuestionToPlace = {
  unitKey: string;
  number: number;
  fragments: [PreparedQuestionFragment, ...PreparedQuestionFragment[]];
  afterPage?: { kind: "answer-space"; marks: number };
  footer?: { text: string; x: number; y: number; fontSize: number };
};

type PlacementState = {
  pageIndex: number;
  cursorTop: number;
};

const pageContentTop = GENERATED_PAGE.height - GENERATED_PAGE.top;
const availableHeight = GENERATED_PAGE.height - GENERATED_PAGE.top - GENERATED_PAGE.bottom;

function isFiniteOrderedCrop(box: SourcePageCrop): boolean {
  return Number.isFinite(box.left)
    && Number.isFinite(box.right)
    && Number.isFinite(box.bottom)
    && Number.isFinite(box.top)
    && box.left <= box.right
    && box.bottom <= box.top;
}

function isFiniteOrderedBox(box: BoundingBox): boolean {
  return Number.isFinite(box.x0)
    && Number.isFinite(box.x1)
    && Number.isFinite(box.y0)
    && Number.isFinite(box.y1)
    && box.x0 <= box.x1
    && box.y0 <= box.y1;
}

function isInsideCrop(inner: BoundingBox, outer: SourcePageCrop): boolean {
  return inner.x0 >= outer.left
    && inner.x1 <= outer.right
    && inner.y0 >= outer.bottom
    && inner.y1 <= outer.top;
}

function hasValidPromptAnchor(fragment: PreparedQuestionFragment): boolean {
  const identity = fragment.identity;
  if (identity === null) return true;
  return identity.pageNumber === fragment.sourcePageNumber
    && Number.isFinite(identity.promptBaseline)
    && isFiniteOrderedBox(identity.numberBounds)
    && isFiniteOrderedBox(identity.promptBounds)
    && isInsideCrop(identity.promptBounds, fragment.crop)
    && identity.promptBaseline >= fragment.crop.bottom
    && identity.promptBaseline <= fragment.crop.top
    && identity.promptBaseline >= identity.promptBounds.y0
    && identity.promptBaseline <= identity.promptBounds.y1;
}

export function planGeneratedQuestions(input: { questions: QuestionToPlace[] }): GeneratedLayoutPlan {
  const blocks: PlacedQuestionBlock[] = [];
  const state: PlacementState = { pageIndex: 0, cursorTop: pageContentTop };
  const questionNumbers = new Set<number>();

  for (const question of input.questions) {
    if (!Number.isFinite(question.number) || !Number.isInteger(question.number) || question.number <= 0 || questionNumbers.has(question.number)) {
      return { kind: "unrenderable", unitKey: question.unitKey, reason: "invalid-question-number" };
    }
    questionNumbers.add(question.number);

    const invalidFragment = question.fragments.find((fragment) => (
      !isFiniteOrderedCrop(fragment.crop)
      || !Number.isFinite(fragment.width)
      || !Number.isFinite(fragment.height)
      || fragment.width <= 0
      || fragment.height <= 0
    ));
    if (invalidFragment) return { kind: "unrenderable", unitKey: question.unitKey, reason: "invalid-fragment" };

    const invalidPromptAnchor = question.fragments.find((fragment) => (
      fragment.identity !== null && !hasValidPromptAnchor(fragment)
    ));
    if (invalidPromptAnchor) {
      return { kind: "unrenderable", unitKey: question.unitKey, reason: "invalid-prompt-anchor" };
    }

    const firstQuestionIndex = question.fragments.findIndex((fragment) => fragment.kind === "question");
    if (firstQuestionIndex < 0 || question.fragments[firstQuestionIndex].identity === null) {
      return { kind: "unrenderable", unitKey: question.unitKey, reason: "missing-prompt-anchor" };
    }

    if (question.fragments.some((fragment, index) => (
      index < firstQuestionIndex && fragment.kind !== "support"
    )) || question.fragments.some((fragment, index) => (
      index > firstQuestionIndex && fragment.kind !== "continuation"
    ))) {
      return { kind: "unrenderable", unitKey: question.unitKey, reason: "invalid-fragment-order" };
    }

    const widthScale = Math.min(
      1,
      (GENERATED_PAGE.contentRight - GENERATED_PAGE.contentLeft)
        / Math.max(...question.fragments.map((fragment) => fragment.width)),
    );
    const heightScale = availableHeight / Math.max(...question.fragments.map((fragment) => fragment.height));
    let scale = Math.min(widthScale, heightScale);
    if (scale < GENERATED_PAGE.minimumReadableScale) {
      return { kind: "unrenderable", unitKey: question.unitKey, reason: "minimum-readable-scale" };
    }

    const leadingFragments = question.fragments.slice(0, firstQuestionIndex + 1);
    const leadingGapHeight = firstQuestionIndex * GENERATED_PAGE.fragmentGap;
    const leadingSourceHeight = leadingFragments.reduce((total, fragment) => total + fragment.height, 0);
    if (firstQuestionIndex > 0) {
      const attachedScale = Math.min(scale, (availableHeight - leadingGapHeight) / leadingSourceHeight);
      if (attachedScale >= GENERATED_PAGE.minimumReadableScale) scale = attachedScale;
    }

    const blockGap = blocks.length > 0 ? GENERATED_PAGE.questionGap : 0;
    const leadingHeight = leadingSourceHeight * scale + leadingGapHeight;
    if (leadingHeight <= availableHeight && state.cursorTop - blockGap - leadingHeight < GENERATED_PAGE.bottom) {
      state.pageIndex += 1;
      state.cursorTop = pageContentTop;
    } else {
      state.cursorTop -= blockGap;
    }

    const placedFragments: PlacedFragment[] = [];
    for (let index = 0; index < question.fragments.length; index += 1) {
      const fragment = question.fragments[index];
      const fragmentHeight = fragment.height * scale;
      const gap = index > 0 && placedFragments[index - 1].outputPageIndex === state.pageIndex
        ? GENERATED_PAGE.fragmentGap
        : 0;
      if (state.cursorTop - gap - fragmentHeight < GENERATED_PAGE.bottom) {
        state.pageIndex += 1;
        state.cursorTop = pageContentTop;
      } else {
        state.cursorTop -= gap;
      }

      const placed = {
        ...fragment,
        outputPageIndex: state.pageIndex,
        x: GENERATED_PAGE.contentX,
        y: Math.min(state.cursorTop - fragmentHeight, pageContentTop - fragmentHeight),
        scale,
      } satisfies PlacedFragment;
      placedFragments.push(placed);
      state.cursorTop = placed.y;
    }

    const firstQuestion = placedFragments[firstQuestionIndex];
    const identity = firstQuestion.identity;
    if (identity === null) {
      return { kind: "unrenderable", unitKey: question.unitKey, reason: "missing-prompt-anchor" };
    }
    const [firstPlacedFragment, ...remainingPlacedFragments] = placedFragments;
    if (!firstPlacedFragment) {
      return { kind: "unrenderable", unitKey: question.unitKey, reason: "invalid-fragment" };
    }
    const numberBaseline = firstQuestion.y
      + (identity.promptBaseline - firstQuestion.crop.bottom) * scale;
    if (numberBaseline < GENERATED_PAGE.bottom || numberBaseline > pageContentTop) {
      return { kind: "unrenderable", unitKey: question.unitKey, reason: "invalid-prompt-anchor" };
    }
    blocks.push({
      unitKey: question.unitKey,
      number: question.number,
      numberSlot: {
        outputPageIndex: firstQuestion.outputPageIndex,
        x: GENERATED_PAGE.numberX,
        baseline: numberBaseline,
        fontSize: GENERATED_PAGE.numberFontSize,
      },
      fragments: [firstPlacedFragment, ...remainingPlacedFragments],
      afterPage: question.afterPage ? {
        ...question.afterPage,
        outputPageIndex: state.pageIndex + 1,
      } : undefined,
      footer: question.footer ? {
        ...question.footer,
        outputPageIndex: placedFragments[placedFragments.length - 1]?.outputPageIndex ?? firstQuestion.outputPageIndex,
      } : undefined,
    });

    if (question.afterPage) {
      state.pageIndex += 2;
      state.cursorTop = pageContentTop;
    }
  }

  return { kind: "success", blocks };
}
