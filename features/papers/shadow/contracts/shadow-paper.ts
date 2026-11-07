import { z } from "zod";

export const SHADOW_LIMITS = {
  textLength: 600,
  mathNodes: 240,
  mathDepth: 6,
  blocksPerSection: 40,
  tableRows: 12,
  tableColumns: 14,
  diagramItems: 2400,
  diagramWidth: 479.28,
  diagramHeight: 640,
  workingHeight: 720,
  partsPerQuestion: 8,
  criteriaPerBranch: 12,
  branchesPerPart: 4,
} as const;

export const mathOperators = [
  "+", "−", "×", "÷", "=", ":", "<", ">", "≤", "≥", "±", ",", "π", "°", "(", ")", "%", "£", "∝", "≠", "≈",
] as const;
export type ShadowMathOperator = (typeof mathOperators)[number];

export type ShadowMathNode =
  | { k: "n"; v: string }
  | { k: "v"; v: string }
  | { k: "t"; v: string }
  | { k: "o"; v: ShadowMathOperator }
  | { k: "frac"; n: ShadowMathNode[]; d: ShadowMathNode[] }
  | { k: "sup"; b: ShadowMathNode[]; e: ShadowMathNode[] }
  | { k: "sqrt"; b: ShadowMathNode[] }
  | { k: "group"; b: ShadowMathNode[]; delim: "()" | "[]" }
  | { k: "vec"; top: ShadowMathNode[]; bottom: ShadowMathNode[] }
  | { k: "sp" };

const numeral = z.string().regex(/^\d+(?:\.\d+)?$/u, "Numerals are unsigned digit strings; use the − operator for signs.").max(24);
const nonEmptyMath = (schema: z.ZodType<ShadowMathNode>) => z.array(schema).min(1).max(SHADOW_LIMITS.mathNodes);

export const mathNodeSchema: z.ZodType<ShadowMathNode> = z.lazy(() => z.discriminatedUnion("k", [
  z.strictObject({ k: z.literal("n"), v: numeral }),
  z.strictObject({ k: z.literal("v"), v: z.string().regex(/^[A-Za-z]{1,3}$/u) }),
  z.strictObject({ k: z.literal("t"), v: z.string().min(1).max(40).regex(/^[\p{L}\p{N} ]+$/u) }),
  z.strictObject({ k: z.literal("o"), v: z.enum(mathOperators) }),
  z.strictObject({ k: z.literal("frac"), n: nonEmptyMath(mathNodeSchema), d: nonEmptyMath(mathNodeSchema) }),
  z.strictObject({ k: z.literal("sup"), b: nonEmptyMath(mathNodeSchema), e: nonEmptyMath(mathNodeSchema) }),
  z.strictObject({ k: z.literal("sqrt"), b: nonEmptyMath(mathNodeSchema) }),
  z.strictObject({ k: z.literal("group"), b: nonEmptyMath(mathNodeSchema), delim: z.enum(["()", "[]"]) }),
  z.strictObject({ k: z.literal("vec"), top: nonEmptyMath(mathNodeSchema), bottom: nonEmptyMath(mathNodeSchema) }),
  z.strictObject({ k: z.literal("sp") }),
]));

function childLists(node: ShadowMathNode): ShadowMathNode[][] {
  switch (node.k) {
    case "frac": return [node.n, node.d];
    case "sup": return [node.b, node.e];
    case "sqrt":
    case "group": return [node.b];
    case "vec": return [node.top, node.bottom];
    default: return [];
  }
}

export function measureMathTree(nodes: ShadowMathNode[], depth = 1): { count: number; depth: number } {
  let count = 0;
  let maxDepth = depth;
  for (const node of nodes) {
    count += 1;
    for (const list of childLists(node)) {
      const child = measureMathTree(list, depth + 1);
      count += child.count;
      maxDepth = Math.max(maxDepth, child.depth);
    }
  }
  return { count, depth: maxDepth };
}

export const mathExpressionSchema = z.array(mathNodeSchema).min(1).max(SHADOW_LIMITS.mathNodes).superRefine((nodes, ctx) => {
  const measured = measureMathTree(nodes);
  if (measured.count > SHADOW_LIMITS.mathNodes) ctx.addIssue({ code: "custom", message: "Maths expression has too many nodes." });
  if (measured.depth > SHADOW_LIMITS.mathDepth) ctx.addIssue({ code: "custom", message: "Maths expression is nested too deeply." });
});

export const inlineSchema = z.discriminatedUnion("t", [
  z.strictObject({ t: z.literal("text"), v: z.string().min(1).max(SHADOW_LIMITS.textLength), style: z.enum(["b", "i"]).optional() }),
  z.strictObject({ t: z.literal("math"), m: mathExpressionSchema }),
]);
export type ShadowInline = z.infer<typeof inlineSchema>;

const inlineRunsSchema = z.array(inlineSchema).min(1).max(60);

const finite = z.number().finite();
const coordinate = finite.min(-1).max(2000);
const strokeWidth = finite.min(0.1).max(4).optional();
const point = z.tuple([coordinate, coordinate]);

export const diagramItemSchema = z.discriminatedUnion("d", [
  z.strictObject({
    d: z.literal("line"),
    x1: coordinate, y1: coordinate, x2: coordinate, y2: coordinate,
    w: strokeWidth,
    dash: z.boolean().optional(),
    tone: z.enum(["ink", "grid", "gridMajor"]).optional(),
    arrow: z.enum(["none", "end", "both"]).optional(),
  }),
  z.strictObject({
    d: z.literal("poly"),
    pts: z.array(point).min(2).max(64),
    closed: z.boolean(),
    fill: z.enum(["none", "shade"]).optional(),
    w: strokeWidth,
    dash: z.boolean().optional(),
  }),
  z.strictObject({
    d: z.literal("circle"),
    cx: coordinate, cy: coordinate, r: finite.positive().max(400),
    fill: z.enum(["none", "shade", "sphere"]).optional(),
    w: strokeWidth,
    dash: z.boolean().optional(),
  }),
  z.strictObject({
    d: z.literal("ellipse"),
    cx: coordinate, cy: coordinate, rx: finite.positive().max(400), ry: finite.positive().max(400),
    half: z.enum(["full", "upper", "lower"]).optional(),
    w: strokeWidth,
    dash: z.boolean().optional(),
  }),
  z.strictObject({
    d: z.literal("rect"),
    x: coordinate, y: coordinate, w: finite.positive().max(2000), h: finite.positive().max(2000),
    fill: z.enum(["none", "shade", "light", "white"]).optional(),
    stroke: z.boolean().optional(),
    radius: finite.min(0).max(40).optional(),
    lineWidth: strokeWidth,
  }),
  z.strictObject({
    d: z.literal("text"),
    x: coordinate, y: coordinate,
    runs: inlineRunsSchema,
    size: finite.min(6).max(16).optional(),
    anchor: z.enum(["start", "middle", "end"]).optional(),
    bold: z.boolean().optional(),
  }),
]);
export type ShadowDiagramItem = z.infer<typeof diagramItemSchema>;

export const diagramSchema = z.strictObject({
  w: finite.positive().max(SHADOW_LIMITS.diagramWidth),
  h: finite.positive().max(SHADOW_LIMITS.diagramHeight),
  items: z.array(diagramItemSchema).min(1).max(SHADOW_LIMITS.diagramItems),
  scale: z.enum(["not-to-scale", "calibrated"]),
  description: z.string().min(1).max(SHADOW_LIMITS.textLength),
});
export type ShadowDiagram = z.infer<typeof diagramSchema>;

export type ShadowBlock =
  | { b: "p"; runs: ShadowInline[]; indent?: number }
  | { b: "math"; m: ShadowMathNode[]; align?: "center" | "left"; indent?: number }
  | { b: "table"; rows: ShadowInline[][][]; headerColumn?: boolean; borders?: boolean; colWidth?: number; firstColWidth?: number; align?: "center" | "left" }
  | { b: "figure"; diagram: ShadowDiagram; align?: "center" | "left" }
  | { b: "gap"; h: number };

const tableCell = z.array(inlineSchema).max(8);
export const blockSchema: z.ZodType<ShadowBlock> = z.discriminatedUnion("b", [
  z.strictObject({ b: z.literal("p"), runs: inlineRunsSchema, indent: z.number().int().min(0).max(6).optional() }),
  z.strictObject({ b: z.literal("math"), m: mathExpressionSchema, align: z.enum(["center", "left"]).optional(), indent: z.number().int().min(0).max(6).optional() }),
  z.strictObject({
    b: z.literal("table"),
    rows: z.array(z.array(tableCell).min(1).max(SHADOW_LIMITS.tableColumns)).min(1).max(SHADOW_LIMITS.tableRows),
    headerColumn: z.boolean().optional(),
    borders: z.boolean().optional(),
    colWidth: finite.min(16).max(240).optional(),
    firstColWidth: finite.min(16).max(240).optional(),
    align: z.enum(["center", "left"]).optional(),
  }).superRefine((table, ctx) => {
    const width = table.rows[0]!.length;
    if (table.rows.some((row) => row.length !== width)) ctx.addIssue({ code: "custom", message: "Table rows must have equal column counts." });
  }),
  z.strictObject({ b: z.literal("figure"), diagram: diagramSchema, align: z.enum(["center", "left"]).optional() }),
  z.strictObject({ b: z.literal("gap"), h: finite.min(0).max(200) }),
]);

const blocksSchema = z.array(blockSchema).max(SHADOW_LIMITS.blocksPerSection);

const answerLineSchema = z.strictObject({ prefix: z.array(inlineSchema).max(6).optional(), suffix: z.array(inlineSchema).max(6).optional() });
export const answerSpaceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("line"), prefix: z.array(inlineSchema).max(6).optional(), suffix: z.array(inlineSchema).max(6).optional() }),
  z.strictObject({ kind: z.literal("multi"), lines: z.array(answerLineSchema).min(2).max(4) }),
  z.strictObject({ kind: z.literal("coordinate") }),
  z.strictObject({ kind: z.literal("reason"), lines: z.number().int().min(1).max(6) }),
  z.strictObject({ kind: z.literal("none") }),
]);
export type ShadowAnswerSpace = z.infer<typeof answerSpaceSchema>;

const partIdSchema = z.string().regex(/^(?:|[a-h]|i{1,3}|iv|v)$/u);

export const questionPartSchema = z.strictObject({
  id: partIdSchema,
  label: z.string().regex(/^\((?:[a-h]|i{1,3}|iv|v)\)$/u).nullable(),
  lead: blocksSchema,
  prompt: blocksSchema.min(1),
  marks: z.number().int().min(1).max(12),
  working: z.number().finite().min(0).max(SHADOW_LIMITS.workingHeight),
  answer: answerSpaceSchema,
});
export type ShadowQuestionPart = z.infer<typeof questionPartSchema>;

export const questionDocumentSchema = z.strictObject({
  number: z.number().int().min(1).max(40),
  stem: blocksSchema,
  parts: z.array(questionPartSchema).min(1).max(SHADOW_LIMITS.partsPerQuestion),
  totalMarks: z.number().int().min(1).max(30),
}).superRefine((document, ctx) => {
  const ids = document.parts.map((part) => part.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Part IDs must be unique." });
  if (document.parts.length > 1 && document.parts.some((part) => part.id === "" || part.label === null)) {
    ctx.addIssue({ code: "custom", message: "Multipart questions need a label on every part." });
  }
  if (document.parts.length === 1 && document.parts[0]!.id !== "" && document.parts[0]!.label === null) {
    ctx.addIssue({ code: "custom", message: "A labelled part needs its printed label." });
  }
  const sum = document.parts.reduce((total, part) => total + part.marks, 0);
  if (sum !== document.totalMarks) ctx.addIssue({ code: "custom", message: `Part marks total ${sum}, not ${document.totalMarks}.` });
});
export type ShadowQuestionDocument = z.infer<typeof questionDocumentSchema>;

const criterionCode = z.string().regex(/^(?:[PMABC][1-5])$/u);
export const markCriterionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,32}$/u),
  code: criterionCode,
  text: inlineRunsSchema,
  dependsOn: z.array(z.string().regex(/^[a-z0-9-]{1,32}$/u)).max(4).optional(),
  followThrough: z.boolean().optional(),
});
export type ShadowMarkCriterion = z.infer<typeof markCriterionSchema>;

export function criterionMarks(code: string) {
  return Number.parseInt(code.slice(-1), 10);
}

export const markBranchSchema = z.strictObject({
  label: z.string().max(60).optional(),
  criteria: z.array(markCriterionSchema).min(1).max(SHADOW_LIMITS.criteriaPerBranch),
  partialCredit: z.array(z.strictObject({ code: criterionCode, text: inlineRunsSchema })).max(4).optional(),
});

export const specialCaseSchema = z.strictObject({
  code: z.string().regex(/^SC [PMABC][1-5]$/u),
  text: inlineRunsSchema,
});

export const solutionPartSchema = z.strictObject({
  partId: partIdSchema,
  marks: z.number().int().min(1).max(12),
  answer: inlineRunsSchema,
  accepted: z.array(inlineRunsSchema).max(6),
  branches: z.array(markBranchSchema).min(1).max(SHADOW_LIMITS.branchesPerPart),
  specialCases: z.array(specialCaseSchema).max(4),
  working: blocksSchema.min(1),
  dependsOnParts: z.array(partIdSchema).max(4),
  manualMarking: z.boolean(),
}).superRefine((part, ctx) => {
  part.branches.forEach((branch, index) => {
    const total = branch.criteria.reduce((sum, criterion) => sum + criterionMarks(criterion.code), 0);
    if (total !== part.marks) {
      ctx.addIssue({ code: "custom", message: `Branch ${index + 1} awards ${total} marks; part ${part.partId || "(single)"} is worth ${part.marks}.` });
    }
    const ids = new Set<string>();
    for (const criterion of branch.criteria) {
      for (const dependency of criterion.dependsOn ?? []) {
        if (!ids.has(dependency)) ctx.addIssue({ code: "custom", message: `Criterion ${criterion.id} depends on ${dependency}, which is not an earlier criterion.` });
      }
      if (ids.has(criterion.id)) ctx.addIssue({ code: "custom", message: `Duplicate criterion ${criterion.id}.` });
      ids.add(criterion.id);
    }
  });
});
export type ShadowSolutionPart = z.infer<typeof solutionPartSchema>;

export const solutionSchema = z.strictObject({
  parts: z.array(solutionPartSchema).min(1).max(SHADOW_LIMITS.partsPerQuestion),
}).superRefine((solution, ctx) => {
  const ids = solution.parts.map((part) => part.partId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Solution part IDs must be unique." });
  const graph = Object.fromEntries(solution.parts.map((part) => [part.partId, part.dependsOnParts]));
  const cycle = findDependencyCycle(graph);
  if (cycle) ctx.addIssue({ code: "custom", message: `Part dependencies form a cycle: ${cycle.join(" → ")}.` });
  for (const part of solution.parts) {
    for (const dependency of part.dependsOnParts) {
      if (!ids.includes(dependency)) ctx.addIssue({ code: "custom", message: `Part ${part.partId} depends on unknown part ${dependency}.` });
    }
  }
});
export type ShadowSolution = z.infer<typeof solutionSchema>;

export function findDependencyCycle(graph: Record<string, readonly string[]>): string[] | null {
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    if (state.get(node) === "done") return null;
    if (state.get(node) === "visiting") return [...stack.slice(stack.indexOf(node)), node];
    state.set(node, "visiting");
    stack.push(node);
    for (const next of graph[node] ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(node, "done");
    return null;
  };
  for (const node of Object.keys(graph)) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

export const validationReportSchema = z.strictObject({
  ok: z.boolean(),
  checks: z.array(z.strictObject({
    name: z.string().min(1).max(80),
    ok: z.boolean(),
    detail: z.string().max(400).optional(),
  })).min(1).max(80),
});
export type ShadowValidationReport = z.infer<typeof validationReportSchema>;

export const exactValueSchema = z.string().regex(/^-?\d{1,40}(?:\/[1-9]\d{0,39})?$/u, "Exact values are normalised integer or numerator/denominator strings.");

export const sourcePaperIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+){3,12}$/u).max(120);
export const manifestRevisionSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d{1,3}$/u);
export const templateRevisionSchema = z.string().regex(/^[a-z0-9-]{3,80}@\d{1,4}$/u);

export const manifestUnitSchema = z.strictObject({
  questionNumber: z.number().int().min(1).max(40),
  sourceUnitKey: z.string().min(1).max(200),
  parts: z.array(z.strictObject({ path: z.string().regex(/^\d{1,2}(?:\((?:[a-h]|i{1,3}|iv|v)\))?$/u), marks: z.number().int().min(1).max(12) })).min(1).max(8),
  marks: z.number().int().min(1).max(30),
  classification: z.enum(["template", "unchanged"]),
  templateRevision: templateRevisionSchema.optional(),
  unchangedReason: z.string().max(400).optional(),
  topics: z.array(z.string().max(60)).max(6),
}).superRefine((unit, ctx) => {
  const sum = unit.parts.reduce((total, part) => total + part.marks, 0);
  if (sum !== unit.marks) ctx.addIssue({ code: "custom", message: `Question ${unit.questionNumber} parts total ${sum}, not ${unit.marks}.` });
  if (unit.classification === "template" && !unit.templateRevision) ctx.addIssue({ code: "custom", message: `Question ${unit.questionNumber} needs a template revision.` });
  if (unit.classification === "unchanged" && !unit.unchangedReason) ctx.addIssue({ code: "custom", message: `Question ${unit.questionNumber} needs an unchanged-question reason.` });
});

const reviewSchema = z.strictObject({
  status: z.enum(["pending", "approved", "changes-requested"]),
  reviewer: z.string().max(80).optional(),
  reviewedAt: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
});

export const sourceIdentitySchema = z.strictObject({
  sourcePaperId: sourcePaperIdSchema,
  boardCode: z.string().min(1).max(20),
  boardLabel: z.string().min(1).max(40),
  qualification: z.literal("gcse"),
  subjectKey: z.string().min(1).max(60),
  subjectSlug: z.string().regex(/^[a-z0-9-]{2,40}$/u),
  subjectLabel: z.string().min(1).max(60),
  specCode: z.string().min(1).max(20),
  componentCode: z.string().min(1).max(20),
  tier: z.enum(["higher", "foundation"]),
  year: z.number().int().min(2000).max(2100),
  session: z.enum(["june", "november"]),
  sittingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  paperCode: z.string().regex(/^paper-\d$/u),
  paperTitle: z.string().min(1).max(80),
  calculator: z.enum(["allowed", "not-allowed"]),
  durationMinutes: z.number().int().min(15).max(240),
  totalMarks: z.number().int().min(1).max(200),
  equipment: z.string().max(400),
});
export type ShadowSourceIdentity = z.infer<typeof sourceIdentitySchema>;

export const manifestSchema = z.strictObject({
  manifestId: z.string().regex(/^[a-z0-9-]{3,120}$/u),
  revision: manifestRevisionSchema,
  publicationStatus: z.enum(["draft", "approved", "withdrawn"]),
  source: sourceIdentitySchema,
  provenance: z.strictObject({
    questionPdfSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    markSchemePdfSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    questionPaperPaths: z.array(z.string().max(300)).min(1).max(6),
    markSchemePaths: z.array(z.string().max(300)).min(1).max(6),
    inventoryCommand: z.string().max(200),
  }),
  units: z.array(manifestUnitSchema).min(1).max(40),
  review: z.strictObject({ mathematics: reviewSchema, visual: reviewSchema }),
}).superRefine((manifest, ctx) => {
  const numbers = manifest.units.map((unit) => unit.questionNumber);
  numbers.forEach((number, index) => {
    if (number !== index + 1) ctx.addIssue({ code: "custom", message: `Units must be ordered 1..n without gaps; found ${number} at position ${index + 1}.` });
  });
  const total = manifest.units.reduce((sum, unit) => sum + unit.marks, 0);
  if (total !== manifest.source.totalMarks) ctx.addIssue({ code: "custom", message: `Units total ${total} marks, not ${manifest.source.totalMarks}.` });
  if (manifest.publicationStatus === "approved" && (manifest.review.mathematics.status !== "approved" || manifest.review.visual.status !== "approved")) {
    ctx.addIssue({ code: "custom", message: "An approved manifest needs approved mathematics and visual reviews." });
  }
});
export type ShadowManifest = z.infer<typeof manifestSchema>;

export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/u);
export const convexIdSchema = z.string().regex(/^[a-z0-9]{16,40}$/u);

export const startShadowJobRequestSchema = z.strictObject({
  sourcePaperId: sourcePaperIdSchema,
  manifestRevision: manifestRevisionSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type StartShadowJobRequest = z.infer<typeof startShadowJobRequestSchema>;

export const artifactKindSchema = z.enum(["paper", "mark-scheme"]);
export type ShadowArtifactKind = z.infer<typeof artifactKindSchema>;

export const shadowJobStatusSchema = z.enum(["queued", "generating", "validating", "rendering", "ready", "failed", "cancelled"]);
export type ShadowJobStatus = z.infer<typeof shadowJobStatusSchema>;

export const shadowJobViewSchema = z.strictObject({
  jobId: z.string(),
  status: shadowJobStatusSchema,
  sourcePaperId: sourcePaperIdSchema,
  manifestRevision: manifestRevisionSchema,
  progress: z.strictObject({ completedUnits: z.number().int().min(0), totalUnits: z.number().int().min(0) }),
  errorCode: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  variant: z.strictObject({
    variantId: z.string(),
    displayCode: z.string(),
    totalMarks: z.number().int(),
    expiresAt: z.number().nullable(),
    savedPaperId: z.string().nullable(),
  }).nullable(),
});
export type ShadowJobView = z.infer<typeof shadowJobViewSchema>;

export const SHADOW_ERROR_CODES = [
  "NO_VALID_VARIANT",
  "VALIDATION_FAILED",
  "RENDER_FAILED",
  "STORAGE_FAILED",
  "MANIFEST_UNAVAILABLE",
  "WORKER_UNAVAILABLE",
  "LEASE_LOST",
] as const;
export type ShadowErrorCode = (typeof SHADOW_ERROR_CODES)[number];
