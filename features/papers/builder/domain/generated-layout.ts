import type { BoundingBox, QuestionIdentityAnchor } from "@/shared/domain/paper";

export type SourcePageCrop = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

export type FragmentMarker = {
  numberBounds: QuestionIdentityAnchor["numberBounds"];
  promptBounds?: QuestionIdentityAnchor["promptBounds"];
  partNumber: string | null;
  text?: string;
};

export type FragmentCrossRef = {
  bounds: BoundingBox;
  baselineY: number;
  fontHeight: number;
  sourceNumber: string;
  generatedNumber?: number;
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
  markers?: FragmentMarker[];
  crossRefs?: FragmentCrossRef[];
  splitGaps?: Array<{ y: number; pageInk: number }>;
  sourceFragmentId?: string;
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
  sourceFragmentId?: string;
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
    ruleY: number;
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
  identityStripPad: { x: 4, y: 3.5 },
  identityWipePad: { x: 8, y: 5 },
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
  footer?: { text: string };
};

type PlacementState = {
  pageIndex: number;
  cursorTop: number;
};

const pageContentTop = GENERATED_PAGE.height - GENERATED_PAGE.top;
const availableHeight = GENERATED_PAGE.height - GENERATED_PAGE.top - GENERATED_PAGE.bottom;
const footerRuleGap = 12;
const footerTextGap = 26;
const footerReservedHeight = 32;
const minSplitPartHeight = 36;
// A question should only start near a page bottom if at least its prompt plus a
// couple of answer lines fit there — smaller slivers look broken.
const minLeadingQuestionHeight = 72;
// A split remainder can strand a page alone, so it must carry enough ink to
// read as real content — mirrors the near-blank preflight gate with margin.
const minRemainderPageInk = 0.0035;
// …and enough height: a couple of lines or a lone options table stranded on a
// fresh page reads as a defect even when the ink gate passes (~15% of the
// usable page).
const minRemainderHeight = 120;

// Chooses the deepest white-gap split that keeps the fragment's top portion
// within the remaining page space, so answer spaces flow across page turns.
function chooseFragmentSplit(
  fragment: PreparedQuestionFragment,
  remainingOutputHeight: number,
  scale: number,
  minTopOutput = minSplitPartHeight,
): number | null {
  const gaps = fragment.splitGaps;
  if (!gaps || gaps.length === 0) return null;
  const lowestAllowed = fragment.crop.bottom + minRemainderHeight / scale;
  let highestAllowed = fragment.crop.top - minTopOutput / scale;
  if (fragment.identity) {
    highestAllowed = Math.min(highestAllowed, fragment.identity.promptBounds.y0 - 1);
  }
  const fitFloor = fragment.crop.top - remainingOutputHeight / scale;
  const inkFloor = minRemainderPageInk / (scale * scale);
  let best: number | null = null;
  for (const gap of gaps) {
    if (gap.y < lowestAllowed || gap.y > highestAllowed || gap.y < fitFloor || gap.pageInk < inkFloor) continue;
    if (best === null || gap.y < best) best = gap.y;
  }
  return best;
}

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
    const heightScale = availableHeight / Math.max(...question.fragments.map((fragment) => (
      fragment.splitGaps?.length ? Math.min(fragment.height, availableHeight) : fragment.height
    )));
    const scale = Math.min(widthScale, heightScale);
    if (scale < GENERATED_PAGE.minimumReadableScale) {
      return { kind: "unrenderable", unitKey: question.unitKey, reason: "minimum-readable-scale" };
    }

    const blockGap = blocks.length > 0 ? GENERATED_PAGE.questionGap : 0;
    const leadingSourceHeight = question.fragments.slice(0, firstQuestionIndex + 1)
      .reduce((total, fragment) => total + fragment.height, 0);
    const leadingHeight = leadingSourceHeight * scale + firstQuestionIndex * GENERATED_PAGE.fragmentGap;
    const supportOutputHeight = question.fragments.slice(0, firstQuestionIndex)
      .reduce((total, fragment) => total + fragment.height, 0) * scale + firstQuestionIndex * GENERATED_PAGE.fragmentGap;
    const firstQuestionFragment = question.fragments[firstQuestionIndex];
    const remainingForQuestion = state.cursorTop - blockGap - supportOutputHeight - GENERATED_PAGE.bottom;
    const canStartHere = firstQuestionFragment.height * scale <= remainingForQuestion
      || chooseFragmentSplit(firstQuestionFragment, remainingForQuestion, scale, minLeadingQuestionHeight) !== null;
    if (leadingHeight <= availableHeight && !canStartHere) {
      state.pageIndex += 1;
      state.cursorTop = pageContentTop;
    } else {
      state.cursorTop -= blockGap;
    }

    const placedFragments: PlacedFragment[] = [];
    const queue = [...question.fragments];
    let pieceIndex = 0;
    let splitCount = 0;
    while (queue.length > 0) {
      const fragment = queue.shift()!;
      const fragmentHeight = fragment.height * scale;
      const isLast = queue.length === 0;
      const footerReserve = isLast && question.footer ? footerReservedHeight : 0;
      const gap = pieceIndex > 0 && placedFragments[placedFragments.length - 1]?.outputPageIndex === state.pageIndex
        ? GENERATED_PAGE.fragmentGap
        : 0;
      const overflows = state.cursorTop - gap - fragmentHeight - footerReserve < GENERATED_PAGE.bottom;
      // Trailing slivers that spill onto a fresh page are dropped rather than
      // leaving a near-blank page with a strip of answer lines.
      if (overflows && isLast && fragment.kind !== "question" && fragmentHeight < availableHeight * 0.22) {
        continue;
      }
      if (overflows) {
        const splitY = chooseFragmentSplit(fragment, state.cursorTop - gap - footerReserve - GENERATED_PAGE.bottom, scale);
        if (process.env.PAPER_LAYOUT_DEBUG) console.error("OVERFLOW", question.unitKey.split("::").at(-1), fragment.kind, "h", fragmentHeight.toFixed(0), "page", state.pageIndex, "cursor", state.cursorTop.toFixed(0), "splitY", splitY, "last", isLast);
        if (splitY !== null) {
          const topCrop = { ...fragment.crop, bottom: splitY };
          const topFragment: PreparedQuestionFragment = {
            ...fragment,
            crop: topCrop,
            height: topCrop.top - topCrop.bottom,
            markers: fragment.markers?.filter((marker) => marker.numberBounds.y0 >= splitY),
            crossRefs: fragment.crossRefs?.filter((ref) => ref.bounds.y0 >= splitY),
            splitGaps: fragment.splitGaps?.filter((gap) => gap.y > splitY),
          };
          const remainderCrop = { ...fragment.crop, top: splitY };
          splitCount += 1;
          const remainder: PreparedQuestionFragment = {
            ...fragment,
            fragmentId: `${fragment.fragmentId}#split-${splitCount}`,
            sourceFragmentId: fragment.sourceFragmentId ?? fragment.fragmentId,
            crop: remainderCrop,
            height: remainderCrop.top - remainderCrop.bottom,
            identity: null,
            markers: fragment.markers?.filter((marker) => marker.numberBounds.y1 <= splitY),
            crossRefs: fragment.crossRefs?.filter((ref) => ref.bounds.y1 <= splitY),
            splitGaps: fragment.splitGaps?.filter((gap) => gap.y < splitY),
          };
          state.cursorTop -= gap;
          const topPlaced = {
            ...topFragment,
            outputPageIndex: state.pageIndex,
            x: GENERATED_PAGE.contentX,
            y: Math.min(state.cursorTop - topFragment.height * scale, pageContentTop - topFragment.height * scale),
            scale,
          } satisfies PlacedFragment;
          placedFragments.push(topPlaced);
          state.pageIndex += 1;
          state.cursorTop = pageContentTop;
          queue.unshift(remainder);
          pieceIndex += 1;
          continue;
        }
        // Only advance when this page already holds content — an over-tall
        // fragment at a fresh page top must still land here.
        if (state.cursorTop < pageContentTop) {
          state.pageIndex += 1;
          state.cursorTop = pageContentTop;
          // Retry on the fresh page, where a split that did not fit the old page may now apply.
          if (fragmentHeight + footerReserve > availableHeight && fragment.splitGaps?.length) {
            queue.unshift(fragment);
            continue;
          }
        }
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
      pieceIndex += 1;
      if (process.env.PAPER_LAYOUT_DEBUG) console.error("PLACE", question.unitKey.split("::").at(-1), fragment.kind, "h", fragmentHeight.toFixed(0), "page", placed.outputPageIndex, "y", placed.y.toFixed(0), "last", isLast);
    }

    const lastPlacedFragment = placedFragments[placedFragments.length - 1];
    if (question.footer && lastPlacedFragment) {
      state.cursorTop = Math.max(GENERATED_PAGE.bottom, lastPlacedFragment.y - footerReservedHeight);
    }

    const firstQuestion = placedFragments.find((fragment) => fragment.kind === "question" && fragment.identity !== null) ?? placedFragments[firstQuestionIndex];
    const identity = firstQuestion.identity;
    if (identity === null) {
      return { kind: "unrenderable", unitKey: question.unitKey, reason: "missing-prompt-anchor" };
    }
    const [firstPlacedFragment, ...remainingPlacedFragments] = placedFragments;
    if (!firstPlacedFragment) {
      return { kind: "unrenderable", unitKey: question.unitKey, reason: "invalid-fragment" };
    }
    // The generated number replaces the source number — it belongs on the
    // source number's own row. Some bank anchors carry a degenerate prompt on
    // a later line (a "(a)" row hundreds of points below); aligning to that
    // prompt drops the number mid-question beside a part label.
    const promptOnNumberRow = identity.promptBounds.y0 <= identity.numberBounds.y1
      && identity.promptBounds.y1 >= identity.numberBounds.y0;
    const numberRowInsideCrop = identity.numberBounds.y0 >= firstQuestion.crop.bottom
      && identity.numberBounds.y0 <= firstQuestion.crop.top;
    const promptBaseline = firstQuestion.y
      + (identity.promptBaseline - firstQuestion.crop.bottom) * scale;
    const numberRowBaseline = firstQuestion.y
      + (identity.numberBounds.y0 - firstQuestion.crop.bottom) * scale;
    // Some anchors resolve to a part marker instead of the margin question
    // number — their number bounds sit in the indented "(a)" column rather
    // than at the crop's left edge. When earlier content exists (a stem or
    // support fragment above the marker row) the real number row is
    // unreachable, so the number heads the block's first fragment instead.
    // Stem-less questions that genuinely start on the marker row keep the
    // anchor position.
    const anchorIndented = identity.numberBounds.x0 - firstQuestion.crop.left > 18
      && identity.numberBounds.x0 > 55;
    const anchorBelowHead = anchorIndented
      && (firstQuestionIndex > 0 || firstQuestion.crop.top - identity.numberBounds.y1 > 30);
    const numberBaseline = anchorBelowHead
      ? firstPlacedFragment.y
        + Math.max(6, firstPlacedFragment.height - Math.max(10, identity.numberBounds.y1 - identity.numberBounds.y0)) * scale
      : promptOnNumberRow || !numberRowInsideCrop
        ? promptBaseline
        : numberRowBaseline;
    const numberPageIndex = anchorBelowHead
      ? firstPlacedFragment.outputPageIndex
      : firstQuestion.outputPageIndex;
    if (process.env.PAPER_LAYOUT_DEBUG) console.error("NUM", question.unitKey.split("::").at(-1), "num", question.number, "slotPage", firstQuestion.outputPageIndex, "onRow", promptOnNumberRow, "inCrop", numberRowInsideCrop, "numX", identity.numberBounds.x0.toFixed(0), "-", identity.numberBounds.x1.toFixed(0), "numY", identity.numberBounds.y0.toFixed(0), "-", identity.numberBounds.y1.toFixed(0), "promptX", identity.promptBounds.x0.toFixed(0), "promptY", identity.promptBounds.y0.toFixed(0), "-", identity.promptBounds.y1.toFixed(0), "cropX", firstQuestion.crop.left.toFixed(0), "cropY", firstQuestion.crop.bottom.toFixed(0), "-", firstQuestion.crop.top.toFixed(0), "kind", firstQuestion.kind);
    if (numberBaseline < GENERATED_PAGE.bottom || numberBaseline > pageContentTop) {
      return { kind: "unrenderable", unitKey: question.unitKey, reason: "invalid-prompt-anchor" };
    }
    blocks.push({
      unitKey: question.unitKey,
      number: question.number,
      numberSlot: {
        outputPageIndex: numberPageIndex,
        x: GENERATED_PAGE.numberX,
        baseline: numberBaseline,
        fontSize: GENERATED_PAGE.numberFontSize,
      },
      fragments: [firstPlacedFragment, ...remainingPlacedFragments],
      afterPage: question.afterPage ? {
        ...question.afterPage,
        outputPageIndex: state.pageIndex + 1,
      } : undefined,
      footer: question.footer && lastPlacedFragment ? {
        text: question.footer.text,
        outputPageIndex: lastPlacedFragment.outputPageIndex,
        x: GENERATED_PAGE.contentX,
        y: lastPlacedFragment.y - footerTextGap,
        ruleY: lastPlacedFragment.y - footerRuleGap,
        fontSize: 10.5,
      } : undefined,
    });

    if (question.afterPage) {
      state.pageIndex += 2;
      state.cursorTop = pageContentTop;
    }
  }

  return { kind: "success", blocks };
}
