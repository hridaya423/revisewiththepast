import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { OpenRouter } from "@openrouter/sdk";
import { ConvexHttpClient } from "convex/browser";
import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: false, quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env"), override: false, quiet: true });

type ExtractedQuestionPart = {
  question_id: string;
  page_number: number;
  page_numbers: number[];
  question_number: string;
  question_part_number: string | null;
  section_code: string | null;
  section_name: string | null;
  paper_code: string;
  paper_name: string;
  context_text: string | null;
  marks: number | null;
  command_word: string | null;
  prompt_text: string;
  normalized_text: string;
  source_mode: string;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  asset_ids: string[];
  parser_notes: string[];
  isChoiceQuestion: boolean;
  choiceGroupId: string | null;
  choiceGroupType: string | null;
  choiceOptionLabel: string | null;
  choiceOptionIndex: number | null;
  choiceSiblingQuestionIds: string[];
  sharedChoiceStem: string | null;
};

type ExtractedPaper = {
  source_file: string;
  board_code: string;
  subject_slug: string;
  paper_code: string;
  year: number | null;
  session: string | null;
  parser_version: string;
  question_parts: ExtractedQuestionPart[];
};

type TaxonomyTopic = {
  id: string;
  parentId: string | null;
  label: string;
  kind: "branch" | "leaf";
  paperCodes?: string[];
  sectionCodes?: string[];
  aliases?: string[];
};

type Taxonomy = {
  metadata: {
    boardCode: string;
    subjectSlug: string;
    specCode: string;
    version: string;
  };
  topics: TaxonomyTopic[];
};

function normalizePaperCode(extracted: ExtractedPaper): string {
  const raw = (extracted.paper_code || "").trim();
  const source = (extracted.source_file || "").toLowerCase();

  if (extracted.subject_slug === "combined-science") {
    if (/biology[-\s_]?1/.test(source)) return "biology-1";
    if (/biology[-\s_]?2/.test(source)) return "biology-2";
    if (/chemistry[-\s_]?1/.test(source)) return "chemistry-1";
    if (/chemistry[-\s_]?2/.test(source)) return "chemistry-2";
    if (/physics[-\s_]?1/.test(source)) return "physics-1";
    if (/physics[-\s_]?2/.test(source)) return "physics-2";
  }

  if (extracted.subject_slug === "french" || extracted.subject_slug === "spanish") {
    if (/listening|[-\s_]1[fh]\b/.test(source)) return "listening";
    if (/speaking|[-\s_]2[fh]\b/.test(source)) return "speaking";
    if (/reading|[-\s_]3[fh]\b/.test(source)) return "reading";
    if (/writing|[-\s_]4[fh]\b/.test(source)) return "writing";
  }

  if ((extracted.board_code === "ocr" && extracted.subject_slug === "english-language")
    || (extracted.board_code === "ocr" && extracted.subject_slug === "english-literature")) {
    if (/component[-\s_]?1|j35[12]\/01/.test(source)) return "paper-1";
    if (/component[-\s_]?2|j35[12]\/02/.test(source)) return "paper-2";
  }

  return raw || "unknown";
}

function deriveSourceRelativePath(sourceFile: string) {
  const normalized = sourceFile.replaceAll("\\", "/");
  const marker = "/data/downloads/";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + marker.length);
  }
  return basename(normalized);
}

type TaggedQuestionPart = {
  question_id: string;
  canonical_leaf: string;
  knowledge_points: string[];
  skills_tested: string[];
  bloom_level: "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
  difficulty: "low" | "medium" | "high";
  question_type: "multiple-choice" | "short-answer" | "structured" | "extended-writing" | "data-response" | "case-study";
  key_terms: string[];
  spec_references: string[];
  confidence: number;
  evidence_snippet: string;
  taxonomy_version: string;
  setText: string | null;
  cluster: string | null;
  namedPoem: string[];
  characters: string[];
  themes: string[];
  taskMode: string | null;
  domain: string | null;
  subtopic: string | null;
  representation: string | null;
  subskill: string[];
  errorTrap: string[];
  unit: string | null;
  caseStudy: string[];
  resourceTrack: string | null;
  process: string[];
};

type TaggedPaperResponse = {
  question_parts: Array<{
    question_id: string;
    canonical_leaf: string;
    knowledge_points: string[];
    skills_tested: string[];
    bloom_level?: TaggedQuestionPart["bloom_level"];
    difficulty?: TaggedQuestionPart["difficulty"];
    question_type?: TaggedQuestionPart["question_type"];
    key_terms: string[];
    spec_references: string[];
    confidence: number;
    evidence_snippet: string;
    setText?: string | null;
    cluster?: string | null;
    namedPoem?: string[];
    characters?: string[];
    themes?: string[];
    taskMode?: string | null;
    domain?: string | null;
    subtopic?: string | null;
    representation?: string | null;
    subskill?: string[];
    errorTrap?: string[];
    unit?: string | null;
    caseStudy?: string[];
    resourceTrack?: string | null;
    process?: string[];
  }>;
};

type TaggedBatchResponse = {
  papers: Array<{
    source_file: string;
    question_parts: TaggedPaperResponse["question_parts"];
  }>;
};

const BLOOM_MAP: Record<string, TaggedQuestionPart["bloom_level"]> = {
  name: "remember", state: "remember", give: "remember",
  identify: "understand", describe: "understand", outline: "understand",
  calculate: "apply", complete: "apply",
  suggest: "analyze", explain: "analyze", compare: "analyze",
  discuss: "evaluate", evaluate: "evaluate", assess: "evaluate", justify: "evaluate",
  design: "create", plan: "create",
};

function deriveBloomLevel(commandWord: string | null): TaggedQuestionPart["bloom_level"] {
  if (!commandWord) return "understand";
  return BLOOM_MAP[commandWord.toLowerCase()] ?? "understand";
}

function deriveDifficulty(marks: number | null, bloomLevel: TaggedQuestionPart["bloom_level"]): TaggedQuestionPart["difficulty"] {
  if (!marks) return "medium";
  if (marks <= 3) return "low";
  if (marks <= 6) return bloomLevel === "evaluate" || bloomLevel === "create" ? "high" : "medium";
  return "high";
}

function deriveQuestionType(marks: number | null, commandWord: string | null, promptText: string): TaggedQuestionPart["question_type"] {
  const lowerPrompt = promptText.toLowerCase();
  const hasOptions = /\b[A-D]\s/.test(promptText) && /shade one circle|tick\s*\(/i.test(promptText);
  if (hasOptions) return "multiple-choice";
  if (marks !== null && marks <= 2 && commandWord && ["name", "state", "give", "identify"].includes(commandWord.toLowerCase())) return "short-answer";
  if (marks !== null && marks >= 9) return "extended-writing";
  if (lowerPrompt.includes("figure") || lowerPrompt.includes("study ")) return "data-response";
  if (lowerPrompt.includes("case study")) return "case-study";
  return "structured";
}

function deriveSpecReferences(canonicalLeaf: string, paperCode: string, sectionCode: string | null, specCode: string): string[] {
  const refs: string[] = [];
  if (specCode) refs.push(`${specCode} ${canonicalLeaf}`);
  return refs;
}

const API_KEY = process.env.HACKCLUB_AI_API_KEY ?? process.env.OPENROUTER_API_KEY;
const SERVER_URL = process.env.HACKCLUB_AI_API_KEY ? "https://ai.hackclub.com/proxy/v1" : undefined;
const MODEL = process.env.OPENROUTER_MODEL ?? "google/gemini-3-flash-preview";
const IS_DEEPSEEK_MODEL = MODEL.toLowerCase().includes("deepseek");
const PAPER_CONCURRENCY = Number(process.env.PAPER_CONCURRENCY ?? "20");
const DEFAULT_INPUT_DIR = resolve(process.cwd(), "data/extracted");
const DEFAULT_CONFIG_DIR = resolve(process.cwd(), "config");
const CONVEX_URL = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
const WRITE_TO_CONVEX_BY_DEFAULT = (process.env.WRITE_TO_CONVEX ?? "1") !== "0";
const AI_RETRIES = Math.max(1, Number(process.env.AI_RETRIES ?? "4"));
const AI_RETRY_BASE_MS = Math.max(100, Number(process.env.AI_RETRY_BASE_MS ?? "1500"));
const AI_PER_MINUTE_LIMIT = Math.max(1, Number(process.env.AI_PER_MINUTE_LIMIT ?? "20"));
const AI_DAILY_CALL_LIMIT = Math.max(1, Number(process.env.AI_DAILY_CALL_LIMIT ?? "1000"));
const AI_BATCH_MAX_PAPERS = Math.max(1, Math.min(3, Number(process.env.AI_BATCH_MAX_PAPERS ?? "3")));
const AI_PAPER_CHUNK_SIZE = Math.max(1, Number(process.env.AI_PAPER_CHUNK_SIZE ?? "12"));
const RATE_STATE_PATH = resolve(process.cwd(), "data", ".tag-papers-rate-state.json");
const DEBUG_RESPONSE_DIR = resolve(process.cwd(), "data", "tagger-debug");
const PAPER_PRIORITY_ORDER = [
  "aqa-geography",
  "edexcel-mathematics",
  "aqa-english-literature",
  "aqa-english-language",
  "edexcel-combined-science",
  "edexcel-business",
] as const;

const client = new OpenRouter({
  apiKey: API_KEY ?? "",
  ...(SERVER_URL ? { serverURL: SERVER_URL } : {}),
});

type RateState = {
  date: string;
  callsUsed: number;
};

const rateLimiterState = {
  timestamps: [] as number[],
  queue: Promise.resolve(),
};

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadRateState(): RateState {
  if (!existsSync(RATE_STATE_PATH)) {
    return { date: getTodayKey(), callsUsed: 0 };
  }

  try {
    const parsed = JSON.parse(readFileSync(RATE_STATE_PATH, "utf8")) as Partial<RateState>;
    if (parsed.date === getTodayKey() && typeof parsed.callsUsed === "number") {
      return { date: parsed.date, callsUsed: parsed.callsUsed };
    }
  } catch {
  }

  return { date: getTodayKey(), callsUsed: 0 };
}

function saveRateState(rateState: RateState) {
  writeFileSync(RATE_STATE_PATH, JSON.stringify(rateState, null, 2));
}

let rateState = loadRateState();

function getCallsUsedToday() {
  const today = getTodayKey();
  if (rateState.date !== today) {
    rateState = { date: today, callsUsed: 0 };
    saveRateState(rateState);
  }
  return rateState.callsUsed;
}

function reserveDailyCall() {
  const callsUsed = getCallsUsedToday();
  if (callsUsed >= AI_DAILY_CALL_LIMIT) {
    throw new Error(`OpenRouter daily call limit reached (${AI_DAILY_CALL_LIMIT}/${AI_DAILY_CALL_LIMIT})`);
  }
  rateState = { date: getTodayKey(), callsUsed: callsUsed + 1 };
  saveRateState(rateState);
}

async function acquireRateLimitSlot() {
  const run = async () => {
    while (true) {
      const now = Date.now();
      rateLimiterState.timestamps = rateLimiterState.timestamps.filter((timestamp) => now - timestamp < 60_000);
      if (rateLimiterState.timestamps.length < AI_PER_MINUTE_LIMIT) {
        reserveDailyCall();
        rateLimiterState.timestamps.push(now);
        return;
      }

      const oldestTimestamp = rateLimiterState.timestamps[0];
      const waitMs = Math.max(50, 60_000 - (now - oldestTimestamp));
      await sleep(waitMs);
    }
  };

  const next = rateLimiterState.queue.then(run, run);
  rateLimiterState.queue = next.catch(() => undefined);
  await next;
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function isRetryableAiError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const maybeHttpError = error as Error & { statusCode?: number; body?: string };
  if ([429, 500, 502, 503, 504].includes(maybeHttpError.statusCode ?? 0)) return true;

  const message = String(maybeHttpError.message ?? "").toLowerCase();
  const body = String(maybeHttpError.body ?? "").toLowerCase();
  return message.includes("responsevalidationerror")
    || message.includes("operation was aborted")
    || message.includes("timeout")
    || message.includes("timed out")
    || body.includes("\"code\":504")
    || body.includes("operation was aborted");
}

async function sendChatRequestWithRetries(
  chatRequest: Parameters<typeof client.chat.send>[0]["chatRequest"],
  contextLabel: string,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= AI_RETRIES; attempt += 1) {
    try {
      await acquireRateLimitSlot();
      return await client.chat.send({ chatRequest });
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < AI_RETRIES && isRetryableAiError(error);
      if (!shouldRetry) break;
      const waitMs = AI_RETRY_BASE_MS * 2 ** (attempt - 1);
      console.warn(`    retry ${attempt}/${AI_RETRIES} for ${contextLabel} after ${waitMs}ms`);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

function getChatResponseContent(response: Awaited<ReturnType<typeof client.chat.send>>): string | null {
  const maybeCompletion = response as {
    choices?: Array<{
      message?: {
        content?: string | null;
      };
    }>;
  };

  return maybeCompletion.choices?.[0]?.message?.content ?? null;
}

function writeDebugResponse(kind: "paper" | "batch", label: string, content: string) {
  mkdirSync(DEBUG_RESPONSE_DIR, { recursive: true });
  const safeLabel = label.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 120);
  const outputPath = resolve(DEBUG_RESPONSE_DIR, `${kind}-${safeLabel}.txt`);
  writeFileSync(outputPath, content);
  return outputPath;
}

function getPaperPromptPayload(
  extracted: ExtractedPaper,
  taxonomy: Taxonomy,
  normalizedPaperCode: string,
  specCode: string,
) {
  return {
    source_file: extracted.source_file,
    paper: {
      board_code: extracted.board_code,
      subject_slug: extracted.subject_slug,
      paper_code: normalizedPaperCode,
      year: extracted.year,
      session: extracted.session,
      spec_code: specCode,
    },
    question_parts: extracted.question_parts.map((part) => ({
      question_id: part.question_id,
      question_number: part.question_number,
      question_part_number: part.question_part_number,
      section_code: part.section_code,
      marks: part.marks,
      command_word: part.command_word,
      is_choice_question: part.isChoiceQuestion,
      shared_choice_stem: part.sharedChoiceStem,
      context_text: part.context_text,
      prompt_text: part.prompt_text,
      allowed_topics: getAllowedTopics(taxonomy, normalizedPaperCode, part.section_code).map((topic) => ({
        id: topic.id,
        label: topic.label,
      })),
    })),
  };
}

function assertEnv(writeToConvex: boolean) {
  if (!API_KEY) throw new Error("Missing OPENROUTER_API_KEY");
  if (writeToConvex && !CONVEX_URL) {
    throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL while WRITE_TO_CONVEX is enabled");
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const paperJsonIndex = args.indexOf("--paper-json");
  const inputDirIndex = args.indexOf("--input-dir");
  const configDirIndex = args.indexOf("--config-dir");
  const skipConvex = args.includes("--skip-convex");
  const forceRetag = args.includes("--force") || args.includes("--retag");
  return {
    paperJson: paperJsonIndex >= 0 ? resolve(process.cwd(), args[paperJsonIndex + 1]) : null,
    inputDir: inputDirIndex >= 0 ? resolve(process.cwd(), args[inputDirIndex + 1]) : DEFAULT_INPUT_DIR,
    configDir: configDirIndex >= 0 ? resolve(process.cwd(), args[configDirIndex + 1]) : DEFAULT_CONFIG_DIR,
    writeToConvex: WRITE_TO_CONVEX_BY_DEFAULT && !skipConvex,
    forceRetag,
  };
}

function getTaggedOutputPath(paperJsonPath: string): string {
  return resolve(paperJsonPath.replace(/paper\.json$/, "tagged-paper.json"));
}

function loadTaxonomy(boardCode: string, subjectSlug: string, configDir: string): Taxonomy | null {
  const flatPath = resolve(configDir, `${boardCode}-${subjectSlug}`, "taxonomy.json");
  if (existsSync(flatPath)) {
    return JSON.parse(readFileSync(flatPath, "utf8")) as Taxonomy;
  }

  const nestedPath = resolve(configDir, boardCode, subjectSlug, "taxonomy.json");
  if (existsSync(nestedPath)) {
    return JSON.parse(readFileSync(nestedPath, "utf8")) as Taxonomy;
  }

  return null;
}

type ControlledVocabularies = {
  characters?: Record<string, string[]>;
  themes?: Record<string, string[]>;
  poems?: Record<string, string[]>;
  subskills?: Record<string, string[]>;
  errorTraps?: Record<string, string[]>;
  representations?: Record<string, string[]>;
  caseStudies?: Record<string, string[]>;
  processes?: Record<string, string[]>;
  resourceTracks?: Record<string, string[]>;
};

function loadControlledVocabularies(boardCode: string, subjectSlug: string, configDir: string): ControlledVocabularies {
  const vocabDir = resolve(configDir, `${boardCode}-${subjectSlug}`);
  const vocabs: ControlledVocabularies = {};

  const vocabFiles: Array<{ file: string; key: keyof ControlledVocabularies }> = [
    { file: "characters.json", key: "characters" },
    { file: "themes.json", key: "themes" },
    { file: "poems.json", key: "poems" },
    { file: "subskills.json", key: "subskills" },
    { file: "error-traps.json", key: "errorTraps" },
    { file: "representations.json", key: "representations" },
    { file: "case-studies.json", key: "caseStudies" },
    { file: "processes.json", key: "processes" },
    { file: "resource-tracks.json", key: "resourceTracks" },
  ];

  for (const { file, key } of vocabFiles) {
    const path = resolve(vocabDir, file);
    if (existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, "utf8"));
        const dataKey = Object.keys(data).find((k) => k !== "metadata");
        if (dataKey && data[dataKey]) {
          vocabs[key] = data[dataKey] as Record<string, string[]>;
        }
      } catch {
      }
    }
  }

  return vocabs;
}

function normalizeFacetValue(value: string) {
  return value.trim().toLowerCase();
}

function tokenizeFacetValue(value: string) {
  const stopwords = new Set([
    "a",
    "an",
    "and",
    "the",
    "of",
    "in",
    "on",
    "for",
    "to",
    "from",
    "at",
    "by",
    "with",
    "uk",
    "case",
    "study",
    "river",
    "coast",
    "storm",
    "typhoon",
    "hurricane",
    "cyclone",
    "global",
  ]);

  return normalizeFacetValue(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((token) => !stopwords.has(token) && !/^\d+$/.test(token));
}

function resolveFacetValue(value: string, allowedValues: string[]) {
  const normalized = normalizeFacetValue(value);
  const direct = allowedValues.find((allowed) => normalizeFacetValue(allowed) === normalized);
  if (direct) return normalizeFacetValue(direct);

  const directPhrase = allowedValues.find((allowed) => slugToPhrase(allowed) === normalized);
  if (directPhrase) return normalizeFacetValue(directPhrase);

  const inputTokens = tokenizeFacetValue(value);
  if (inputTokens.length === 0) return null;

  let bestMatch: { value: string; score: number } | null = null;
  let isTie = false;

  for (const allowed of allowedValues) {
    const allowedTokens = tokenizeFacetValue(allowed);
    if (allowedTokens.length === 0) continue;

    const overlap = inputTokens.filter((token) => allowedTokens.includes(token)).length;
    if (overlap === 0) continue;

    const score = overlap / inputTokens.length;
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { value: normalizeFacetValue(allowed), score };
      isTie = false;
      continue;
    }

    if (bestMatch && score === bestMatch.score && normalizeFacetValue(allowed) !== bestMatch.value) {
      isTie = true;
    }
  }

  if (!bestMatch || isTie || bestMatch.score < 0.6) return null;
  return bestMatch.value;
}

function dedupeFacetValues(values: string[]) {
  return Array.from(new Set(values.map(normalizeFacetValue).filter(Boolean)));
}

function coerceArrayField(values: unknown): string[] {
  if (Array.isArray(values)) {
    return values.filter((value): value is string => typeof value === "string");
  }
  if (typeof values === "string") {
    const normalized = values.trim();
    return normalized ? [normalized] : [];
  }
  return [];
}

function assertFacetArray(
  fieldName: string,
  values: unknown,
  allowedValues: string[],
  contextLabel: string,
) {
  const rawValues = coerceArrayField(values);
  if (allowedValues.length === 0) {
    return dedupeFacetValues(rawValues);
  }

  const resolvedValues: string[] = [];

  for (const value of rawValues) {
    const resolved = resolveFacetValue(value, allowedValues);
    if (resolved === null) {
      resolvedValues.push(normalizeFacetValue(value));
      continue;
    }
    resolvedValues.push(resolved);
  }

  return Array.from(new Set(resolvedValues));
}

function findVocabularyValues(vocabulary: Record<string, string[]> | undefined, key: string | null | undefined) {
  if (!vocabulary || !key) return null;
  const normalizedKey = normalizeFacetValue(key);
  for (const [candidateKey, values] of Object.entries(vocabulary)) {
    if (normalizeFacetValue(candidateKey) === normalizedKey) {
      return values.map(normalizeFacetValue);
    }
  }
  for (const [candidateKey, values] of Object.entries(vocabulary)) {
    const normalizedCandidate = normalizeFacetValue(candidateKey);
    if (normalizedKey.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedKey)) {
      return values.map(normalizeFacetValue);
    }
  }
  return null;
}

function normalizeOptionalFacet(value: string | null | undefined) {
  const normalized = value ? normalizeFacetValue(value) : null;
  return normalized && normalized.length > 0 ? normalized : null;
}

function assertOptionalFacet(
  fieldName: string,
  value: string | null,
  allowedValues: string[],
  contextLabel: string,
) {
  if (value === null) return null;
  if (allowedValues.length === 0) return normalizeFacetValue(value);
  const resolvedValue = resolveFacetValue(value, allowedValues);
  if (!resolvedValue) {
    return normalizeFacetValue(value);
  }
  return resolvedValue;
}

function getAllowedTopics(taxonomy: Taxonomy | null, paperCode: string, sectionCode: string | null): TaxonomyTopic[] {
  if (!taxonomy) return [];
  const leafTopics = taxonomy.topics.filter((t) => t.kind === "leaf");
  if (!paperCode && !sectionCode) return leafTopics;

  const allowed = new Set<string>();
  for (const topic of leafTopics) {
    const paperMatch = !topic.paperCodes || topic.paperCodes.includes(paperCode);
    const sectionMatch = !sectionCode || !topic.sectionCodes || topic.sectionCodes.includes(sectionCode);
    if (paperMatch && sectionMatch) allowed.add(topic.id);
  }
  const strictMatches = leafTopics.filter((t) => allowed.has(t.id));
  if (strictMatches.length > 0) return strictMatches;

  if (paperCode) {
    const paperOnlyMatches = leafTopics.filter((topic) => !topic.paperCodes || topic.paperCodes.includes(paperCode));
    if (paperOnlyMatches.length > 0) return paperOnlyMatches;
  }

  return leafTopics;
}

function buildTopicPoolForPaper(extracted: ExtractedPaper, taxonomy: Taxonomy | null, normalizedPaperCode: string) {
  if (!taxonomy) return [] as TaxonomyTopic[];
  const leafTopics = taxonomy.topics.filter((t) => t.kind === "leaf");
  const topicIds = new Set<string>();

  for (const part of extracted.question_parts) {
    const allowed = getAllowedTopics(taxonomy, normalizedPaperCode, part.section_code);
    for (const topic of allowed) topicIds.add(topic.id);
  }

  if (topicIds.size === 0) return leafTopics;
  return leafTopics.filter((topic) => topicIds.has(topic.id));
}

function buildPaperPrompts(
  extracted: ExtractedPaper,
  taxonomy: Taxonomy,
  normalizedPaperCode: string,
  specCode: string,
  controlledVocabs: ControlledVocabularies,
) {
  const vocabContext = buildVocabularyContext(controlledVocabs, extracted.subject_slug);
  const userPayload = getPaperPromptPayload(extracted, taxonomy, normalizedPaperCode, specCode);
  const outputSkeleton = "{\"question_parts\":[{\"question_id\":\"\",\"canonical_leaf\":\"\",\"knowledge_points\":[],\"skills_tested\":[],\"bloom_level\":\"\",\"difficulty\":\"\",\"question_type\":\"\",\"key_terms\":[],\"spec_references\":[],\"confidence\":0,\"evidence_snippet\":\"\",\"setText\":null,\"cluster\":null,\"namedPoem\":[],\"characters\":[],\"themes\":[],\"taskMode\":null,\"domain\":null,\"subtopic\":null,\"representation\":null,\"subskill\":[],\"errorTrap\":[],\"unit\":null,\"caseStudy\":[],\"resourceTrack\":null,\"process\":[]}]}";

  const systemPrompt = [
    "You are a JSON emitter.",
    "Return STRICT JSON only.",
    "No markdown. No code fences. No comments. No prose.",
    "Output exactly one object with exactly one key: question_parts.",
    "Keep input order.",
    "Output exactly one item per input question part.",
    "Copy question_id exactly.",
    "canonical_leaf must be one of that item's allowed_topics.id values.",
    "Use this exact key order for every item: question_id, canonical_leaf, knowledge_points, skills_tested, bloom_level, difficulty, question_type, key_terms, spec_references, confidence, evidence_snippet, setText, cluster, namedPoem, characters, themes, taskMode, domain, subtopic, representation, subskill, errorTrap, unit, caseStudy, resourceTrack, process.",
    "Include every key on every item.",
    "If a scalar facet is not applicable, use null.",
    "If a list facet is not applicable, use [].",
    "All string values must be single-line.",
    "Do not use double quotes inside string values.",
    "Do not use backslashes inside string values.",
    "evidence_snippet must be a short paraphrase, 4 to 12 words, plain text only.",
    "Prefer simple lowercase phrases in free-text arrays.",
    "No trailing commas.",
    "Use controlled vocabulary values exactly when provided.",
    vocabContext ? `Controlled vocabularies:\n${vocabContext}` : "",
    "Before sending, check that the JSON parses and starts with { and ends with }.",
  ].filter(Boolean).join(" ");

  return {
    systemPrompt,
    userPrompt: [
      "Return one JSON object only.",
      `Output skeleton: ${outputSkeleton}`,
      "Rules:",
      "- Same number of question_parts as input.",
      "- Same order as input.",
      "- Copy question_id exactly.",
      "- canonical_leaf must be chosen only from that item's allowed_topics ids.",
      "- Include every key for every item.",
      "- Use null for non-applicable scalar facets.",
      "- Use [] for non-applicable list facets.",
      "- confidence must be a number from 0 to 1.",
      "- bloom_level must be one of: remember, understand, apply, analyze, evaluate, create.",
      "- difficulty must be one of: low, medium, high.",
      "- question_type must be one of: multiple-choice, short-answer, structured, extended-writing, data-response, case-study.",
      "- evidence_snippet must be a short paraphrase only, no quotes, no backslashes, one line.",
      "- Use controlled vocabulary values exactly when provided.",
      "- Do not add extra keys.",
      "INPUT:",
      JSON.stringify(userPayload),
    ].join("\n"),
  };
}

function buildVocabularyContext(vocabs: ControlledVocabularies, subjectSlug: string): string | null {
  const parts: string[] = [];

  if (vocabs.characters) {
    for (const [text, chars] of Object.entries(vocabs.characters)) {
      parts.push(`Characters for ${text}: ${chars.join(", ")}`);
    }
  }

  if (vocabs.themes) {
    for (const [text, themes] of Object.entries(vocabs.themes)) {
      parts.push(`Themes for ${text}: ${themes.join(", ")}`);
    }
  }

  if (vocabs.poems) {
    for (const [cluster, poems] of Object.entries(vocabs.poems)) {
      parts.push(`Poems in ${cluster} cluster: ${poems.join(", ")}`);
    }
  }

  if (vocabs.subskills) {
    for (const [topic, skills] of Object.entries(vocabs.subskills)) {
      parts.push(`Subskills for ${topic}: ${skills.join(", ")}`);
    }
  }

  if (vocabs.errorTraps) {
    for (const [topic, traps] of Object.entries(vocabs.errorTraps)) {
      parts.push(`Error traps for ${topic}: ${traps.join(", ")}`);
    }
  }

  if (vocabs.representations) {
    for (const [group, values] of Object.entries(vocabs.representations)) {
      parts.push(`Representations for ${group}: ${values.join(", ")}`);
    }
  }

  if (vocabs.caseStudies) {
    for (const [unit, studies] of Object.entries(vocabs.caseStudies)) {
      parts.push(`Case studies for ${unit}: ${studies.join(", ")}`);
    }
  }

  if (vocabs.processes) {
    for (const [unit, procs] of Object.entries(vocabs.processes)) {
      parts.push(`Processes for ${unit}: ${procs.join(", ")}`);
    }
  }

  if (vocabs.resourceTracks) {
    for (const [group, tracks] of Object.entries(vocabs.resourceTracks)) {
      parts.push(`Resource tracks for ${group}: ${tracks.join(", ")}`);
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

function buildBatchPaperPrompts(
  papers: Array<{ extracted: ExtractedPaper; taxonomy: Taxonomy; normalizedPaperCode: string; controlledVocabs: ControlledVocabularies }>,
) {
  const vocabContext = papers.length > 0 ? buildVocabularyContext(papers[0].controlledVocabs, papers[0].extracted.subject_slug) : null;
  const userPayload = {
    papers: papers.map(({ extracted, taxonomy, normalizedPaperCode }) => {
      const currentSpecCode = taxonomy.metadata.specCode ?? "";
      return getPaperPromptPayload(extracted, taxonomy, normalizedPaperCode, currentSpecCode);
    }),
  };
  const outputSkeleton = "{\"papers\":[{\"source_file\":\"\",\"question_parts\":[{\"question_id\":\"\",\"canonical_leaf\":\"\",\"knowledge_points\":[],\"skills_tested\":[],\"bloom_level\":\"\",\"difficulty\":\"\",\"question_type\":\"\",\"key_terms\":[],\"spec_references\":[],\"confidence\":0,\"evidence_snippet\":\"\",\"setText\":null,\"cluster\":null,\"namedPoem\":[],\"characters\":[],\"themes\":[],\"taskMode\":null,\"domain\":null,\"subtopic\":null,\"representation\":null,\"subskill\":[],\"errorTrap\":[],\"unit\":null,\"caseStudy\":[],\"resourceTrack\":null,\"process\":[]}]}]}";

  const systemPrompt = [
    "You are a JSON emitter.",
    "Return STRICT JSON only.",
    "No markdown. No code fences. No comments. No prose.",
    "Output exactly one object with exactly one key: papers.",
    "Keep input paper order.",
    "Output exactly one item per input paper.",
    "Copy source_file exactly.",
    "For each paper, keep question_parts order and output exactly one item per input question part.",
    "Copy question_id exactly.",
    "canonical_leaf must be one of that item's allowed_topics.id values.",
    "Use this exact key order for each paper object: source_file, question_parts.",
    "Use this exact key order for every question_parts item: question_id, canonical_leaf, knowledge_points, skills_tested, bloom_level, difficulty, question_type, key_terms, spec_references, confidence, evidence_snippet, setText, cluster, namedPoem, characters, themes, taskMode, domain, subtopic, representation, subskill, errorTrap, unit, caseStudy, resourceTrack, process.",
    "Include every key on every question item.",
    "If a scalar facet is not applicable, use null.",
    "If a list facet is not applicable, use [].",
    "All string values must be single-line.",
    "Do not use double quotes inside string values.",
    "Do not use backslashes inside string values.",
    "evidence_snippet must be a short paraphrase, 4 to 12 words, plain text only.",
    "Prefer simple lowercase phrases in free-text arrays.",
    "No trailing commas.",
    "Use controlled vocabulary values exactly when provided.",
    vocabContext ? `Controlled vocabularies:\n${vocabContext}` : "",
    "Before sending, check that the JSON parses and starts with { and ends with }.",
  ].filter(Boolean).join(" ");

  return {
    systemPrompt,
    userPrompt: [
      "Return one JSON object only.",
      `Output skeleton: ${outputSkeleton}`,
      "Rules:",
      "- Same number of papers as input.",
      "- Same paper order as input.",
      "- Copy source_file exactly.",
      "- For each paper, same number of question_parts as input.",
      "- Same question order as input.",
      "- Copy question_id exactly.",
      "- canonical_leaf must be chosen only from that item's allowed_topics ids.",
      "- Include every key for every question item.",
      "- Use null for non-applicable scalar facets.",
      "- Use [] for non-applicable list facets.",
      "- confidence must be a number from 0 to 1.",
      "- evidence_snippet must be a short paraphrase only, no quotes, no backslashes, one line.",
      "- Use controlled vocabulary values exactly when provided.",
      "- Do not add extra keys.",
      "INPUT:",
      JSON.stringify(userPayload),
    ].join("\n"),
  };
}

function isValidBloomLevel(value: unknown): value is TaggedQuestionPart["bloom_level"] {
  return typeof value === "string" && ["remember", "understand", "apply", "analyze", "evaluate", "create"].includes(value);
}

function isValidDifficulty(value: unknown): value is TaggedQuestionPart["difficulty"] {
  return typeof value === "string" && ["low", "medium", "high"].includes(value);
}

function isValidQuestionType(value: unknown): value is TaggedQuestionPart["question_type"] {
  return typeof value === "string" && ["multiple-choice", "short-answer", "structured", "extended-writing", "data-response", "case-study"].includes(value);
}

function createPaperChunk(extracted: ExtractedPaper, questionParts: ExtractedQuestionPart[]): ExtractedPaper {
  return {
    ...extracted,
    question_parts: questionParts,
  };
}

function slugToPhrase(value: string) {
  return value.replaceAll("-", " ").toLowerCase();
}

function deriveVocabularyKeyFromText(keys: string[], text: string | null | undefined, canonicalLeaf: string) {
  const searchable = `${canonicalLeaf} ${text ?? ""}`.toLowerCase();
  for (const key of keys) {
    if (searchable.includes(key.toLowerCase()) || searchable.includes(slugToPhrase(key))) {
      return key;
    }
  }
  return null;
}

function deriveEnglishTaskMode(sourcePart: ExtractedQuestionPart) {
  const searchable = `${sourcePart.context_text ?? ""} ${sourcePart.prompt_text}`.toLowerCase();
  if (searchable.includes("compare") || searchable.includes("comparison")) return "comparison";
  if (searchable.includes("extract") || searchable.includes("use this extract")) return "extract";
  return "whole_text";
}

function deriveMathRepresentation(sourcePart: ExtractedQuestionPart, canonicalLeaf: string) {
  const searchable = `${canonicalLeaf} ${sourcePart.prompt_text}`.toLowerCase();
  if (searchable.includes("histogram")) return "histogram";
  if (searchable.includes("cumulative frequency") || searchable.includes("cf curve")) return "cumulative-frequency";
  if (searchable.includes("box plot") || searchable.includes("boxplot")) return "box-plot";
  if (searchable.includes("scatter graph") || searchable.includes("scatter diagram")) return "scatter-graph";
  return null;
}

function deriveMathSubtopic(canonicalLeaf: string, representation: string | null) {
  if (representation === "histogram") return "histograms";
  if (representation === "cumulative-frequency") return "cumulative-frequency";
  if (representation === "box-plot") return "box-plots";
  if (representation === "scatter-graph") return "scatter-graphs";
  const leaf = canonicalLeaf.split(".").at(-1) ?? canonicalLeaf;
  return normalizeFacetValue(leaf.replaceAll("_", "-"));
}

function deriveGeographyUnit(canonicalLeaf: string) {
  const segments = canonicalLeaf.split(".");
  const firstSegment = segments[0] ?? "";
  return normalizeOptionalFacet(firstSegment.replace(/^topic-\d+-/i, ""));
}

function deriveResourceTrack(sourcePart: ExtractedQuestionPart, canonicalLeaf: string) {
  const searchable = `${canonicalLeaf} ${sourcePart.prompt_text}`.toLowerCase();
  if (searchable.includes("energy")) return "energy";
  if (searchable.includes("water")) return "water";
  return null;
}

function remapAqaGeographySkillsLeaf(sourcePart: ExtractedQuestionPart, canonicalLeaf: string) {
  return canonicalLeaf;
}

function buildContextualFacetValues(
  sourcePart: ExtractedQuestionPart,
  result: TaggedPaperResponse["question_parts"][number],
  controlledVocabs: ControlledVocabularies,
) {
  const canonicalLeaf = result.canonical_leaf;
  const derivedSetText = normalizeOptionalFacet(result.setText)
    ?? deriveVocabularyKeyFromText(Object.keys(controlledVocabs.characters ?? {}), sourcePart.prompt_text, canonicalLeaf)
    ?? deriveVocabularyKeyFromText(Object.keys(controlledVocabs.themes ?? {}), sourcePart.prompt_text, canonicalLeaf);
  const derivedCluster = normalizeOptionalFacet(result.cluster)
    ?? deriveVocabularyKeyFromText(Object.keys(controlledVocabs.poems ?? {}), sourcePart.prompt_text, canonicalLeaf);
  const representation = normalizeOptionalFacet(result.representation) ?? deriveMathRepresentation(sourcePart, canonicalLeaf);
  const subtopic = normalizeOptionalFacet(result.subtopic) ?? deriveMathSubtopic(canonicalLeaf, representation);
  const derivedUnit = normalizeOptionalFacet(result.unit) ?? deriveGeographyUnit(canonicalLeaf);
  const derivedResourceTrack = normalizeOptionalFacet(result.resourceTrack) ?? deriveResourceTrack(sourcePart, canonicalLeaf);
  const taskMode = normalizeOptionalFacet(result.taskMode)
    ?? ((controlledVocabs.characters || controlledVocabs.poems || controlledVocabs.themes) ? deriveEnglishTaskMode(sourcePart) : null);

  const setText = controlledVocabs.characters || controlledVocabs.themes
    ? assertOptionalFacet(
      "setText",
      derivedSetText,
      Array.from(new Set([...Object.keys(controlledVocabs.characters ?? {}), ...Object.keys(controlledVocabs.themes ?? {})])),
      sourcePart.question_id,
    )
    : derivedSetText;
  const cluster = controlledVocabs.poems
    ? assertOptionalFacet("cluster", derivedCluster, Object.keys(controlledVocabs.poems), sourcePart.question_id)
    : derivedCluster;
  const unit = derivedUnit;
  const resourceTrack = controlledVocabs.resourceTracks
    ? assertOptionalFacet("resourceTrack", derivedResourceTrack, Object.values(controlledVocabs.resourceTracks).flat(), sourcePart.question_id)
    : derivedResourceTrack;

  const characters = assertFacetArray(
    "characters",
    result.characters,
    findVocabularyValues(controlledVocabs.characters, setText) ?? Object.values(controlledVocabs.characters ?? {}).flat().map(normalizeFacetValue),
    sourcePart.question_id,
  );
  const themes = assertFacetArray(
    "themes",
    result.themes,
    findVocabularyValues(controlledVocabs.themes, setText) ?? Object.values(controlledVocabs.themes ?? {}).flat().map(normalizeFacetValue),
    sourcePart.question_id,
  );
  const namedPoem = assertFacetArray(
    "namedPoem",
    result.namedPoem,
    findVocabularyValues(controlledVocabs.poems, cluster) ?? Object.values(controlledVocabs.poems ?? {}).flat().map(normalizeFacetValue),
    sourcePart.question_id,
  );
  const subskill = assertFacetArray(
    "subskill",
    result.subskill,
    findVocabularyValues(controlledVocabs.subskills, subtopic) ?? findVocabularyValues(controlledVocabs.subskills, representation) ?? Object.values(controlledVocabs.subskills ?? {}).flat().map(normalizeFacetValue),
    sourcePart.question_id,
  );
  const errorTrap = assertFacetArray(
    "errorTrap",
    result.errorTrap,
    findVocabularyValues(controlledVocabs.errorTraps, subtopic) ?? findVocabularyValues(controlledVocabs.errorTraps, representation) ?? Object.values(controlledVocabs.errorTraps ?? {}).flat().map(normalizeFacetValue),
    sourcePart.question_id,
  );
  const caseStudy = assertFacetArray(
    "caseStudy",
    result.caseStudy,
    findVocabularyValues(controlledVocabs.caseStudies, unit) ?? findVocabularyValues(controlledVocabs.caseStudies, resourceTrack) ?? Object.values(controlledVocabs.caseStudies ?? {}).flat().map(normalizeFacetValue),
    sourcePart.question_id,
  );
  const process = assertFacetArray(
    "process",
    result.process,
    findVocabularyValues(controlledVocabs.processes, unit) ?? findVocabularyValues(controlledVocabs.processes, resourceTrack) ?? Object.values(controlledVocabs.processes ?? {}).flat().map(normalizeFacetValue),
    sourcePart.question_id,
  );

  return {
    setText,
    cluster,
    representation,
    subtopic,
    unit,
    resourceTrack,
    taskMode,
    characters,
    themes,
    namedPoem,
    subskill,
    errorTrap,
    caseStudy,
    process,
  };
}

function mapTaggedPaperResult(
  extracted: ExtractedPaper,
  taxonomy: Taxonomy,
  normalizedPaperCode: string,
  parsed: TaggedPaperResponse,
  controlledVocabs: ControlledVocabularies,
): TaggedQuestionPart[] {
  const specCode = taxonomy.metadata.specCode ?? "";
  if (!parsed.question_parts || !Array.isArray(parsed.question_parts)) {
    throw new Error(`Invalid paper tagging response format for ${extracted.source_file}`);
  }

  const taggedById = new Map(parsed.question_parts.map((part) => [part.question_id, part]));

  const missing = extracted.question_parts.filter((part) => !taggedById.has(part.question_id));
  if (missing.length > 0) {
    throw new Error(`Paper response missing ${missing.length} question parts for ${extracted.source_file}`);
  }

  return extracted.question_parts.map((sourcePart) => {
    const result = taggedById.get(sourcePart.question_id)!;
    const canonicalLeaf = extracted.board_code === "aqa" && extracted.subject_slug === "geography"
      ? remapAqaGeographySkillsLeaf(sourcePart, result.canonical_leaf)
      : result.canonical_leaf;
    const allowedTopicIds = new Set(
      getAllowedTopics(taxonomy, normalizedPaperCode, sourcePart.section_code).map((topic) => topic.id),
    );
    if (!allowedTopicIds.has(canonicalLeaf)) {
      throw new Error(
        `Canonical leaf ${canonicalLeaf} is not allowed for ${sourcePart.question_id} (${normalizedPaperCode}/${sourcePart.section_code ?? "-"})`,
      );
    }

    const bloomLevel = isValidBloomLevel(result.bloom_level) ? result.bloom_level : deriveBloomLevel(sourcePart.command_word);
    const difficulty = isValidDifficulty(result.difficulty) ? result.difficulty : deriveDifficulty(sourcePart.marks, bloomLevel);
    const questionType = isValidQuestionType(result.question_type)
      ? result.question_type
      : deriveQuestionType(sourcePart.marks, sourcePart.command_word, sourcePart.prompt_text);
    const specReferences = result.spec_references.length > 0
      ? result.spec_references
      : deriveSpecReferences(canonicalLeaf, normalizedPaperCode, sourcePart.section_code, specCode);
    const contextualFacets = buildContextualFacetValues(sourcePart, { ...result, canonical_leaf: canonicalLeaf }, controlledVocabs);
    const canonicalSegments = canonicalLeaf.split(".");
    const domain = normalizeOptionalFacet(result.domain) ?? normalizeOptionalFacet(canonicalSegments[0] ?? null);

    return {
      question_id: sourcePart.question_id,
      canonical_leaf: canonicalLeaf,
      knowledge_points: result.knowledge_points,
      skills_tested: result.skills_tested,
      bloom_level: bloomLevel,
      difficulty,
      question_type: questionType,
      key_terms: result.key_terms,
      spec_references: specReferences,
      confidence: result.confidence,
      evidence_snippet: result.evidence_snippet,
      taxonomy_version: taxonomy.metadata.version ?? "unknown",
      setText: contextualFacets.setText,
      cluster: contextualFacets.cluster,
      namedPoem: contextualFacets.namedPoem,
      characters: contextualFacets.characters,
      themes: contextualFacets.themes,
      taskMode: contextualFacets.taskMode,
      domain,
      subtopic: contextualFacets.subtopic,
      representation: contextualFacets.representation,
      subskill: contextualFacets.subskill,
      errorTrap: contextualFacets.errorTrap,
      unit: contextualFacets.unit,
      caseStudy: contextualFacets.caseStudy,
      resourceTrack: contextualFacets.resourceTrack,
      process: contextualFacets.process,
    };
  });
}

async function tagWholePaper(
  extracted: ExtractedPaper,
  taxonomy: Taxonomy,
  normalizedPaperCode: string,
  controlledVocabs: ControlledVocabularies,
): Promise<TaggedQuestionPart[]> {
  const specCode = taxonomy.metadata.specCode ?? "";
  const { systemPrompt, userPrompt } = buildPaperPrompts(extracted, taxonomy, normalizedPaperCode, specCode, controlledVocabs);
  try {
    const response = await sendChatRequestWithRetries(
      {
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        responseFormat: { type: "json_object" },
      },
      `paper ${extracted.source_file}`,
    );

    const content = getChatResponseContent(response);
    if (!content) throw new Error(`No paper tagging response for ${extracted.source_file}`);

    let parsed: TaggedPaperResponse;
    try {
      parsed = JSON.parse(content) as TaggedPaperResponse;
    } catch (error) {
      const debugPath = writeDebugResponse("paper", basename(extracted.source_file), content);
      throw new Error(`Failed to parse model JSON for ${extracted.source_file}. Raw response saved to ${debugPath}. ${error instanceof Error ? error.message : String(error)}`);
    }
    return mapTaggedPaperResult(extracted, taxonomy, normalizedPaperCode, parsed, controlledVocabs);
  } catch (error) {
    if (extracted.question_parts.length <= AI_PAPER_CHUNK_SIZE) {
      throw error;
    }

    console.warn(`  chunk fallback for ${basename(extracted.source_file)} (${extracted.question_parts.length} parts)`);
    const taggedChunks: TaggedQuestionPart[] = [];
    for (let index = 0; index < extracted.question_parts.length; index += AI_PAPER_CHUNK_SIZE) {
      const chunkParts = extracted.question_parts.slice(index, index + AI_PAPER_CHUNK_SIZE);
      const chunkExtracted = createPaperChunk(extracted, chunkParts);
      const chunkTagged = await tagWholePaper(chunkExtracted, taxonomy, normalizedPaperCode, controlledVocabs);
      taggedChunks.push(...chunkTagged);
    }
    return taggedChunks;
  }
}

async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

async function tagPaperBatch(
  papers: Array<{ paperJsonPath: string; extracted: ExtractedPaper; taxonomy: Taxonomy; normalizedPaperCode: string; controlledVocabs: ControlledVocabularies }>,
) {
  if (IS_DEEPSEEK_MODEL && papers.length > 1) {
    const merged = new Map<string, TaggedQuestionPart[]>();
    for (const paper of papers) {
      merged.set(
        paper.paperJsonPath,
        await tagWholePaper(paper.extracted, paper.taxonomy, paper.normalizedPaperCode, paper.controlledVocabs),
      );
    }
    return merged;
  }

  const groups = new Map<string, typeof papers>();
  for (const paper of papers) {
    const groupKey = `${paper.extracted.board_code}::${paper.extracted.subject_slug}`;
    const existing = groups.get(groupKey) ?? [];
    existing.push(paper);
    groups.set(groupKey, existing);
  }

  if (groups.size > 1) {
    const merged = new Map<string, TaggedQuestionPart[]>();
    for (const groupPapers of groups.values()) {
      const groupResult = await tagPaperBatch(groupPapers);
      for (const [paperPath, tagged] of groupResult.entries()) {
        merged.set(paperPath, tagged);
      }
    }
    return merged;
  }

  if (papers.length === 1) {
    return new Map([[papers[0].paperJsonPath, await tagWholePaper(papers[0].extracted, papers[0].taxonomy, papers[0].normalizedPaperCode, papers[0].controlledVocabs)]]);
  }

  const { systemPrompt, userPrompt } = buildBatchPaperPrompts(
    papers.map((paper) => ({
      extracted: paper.extracted,
      taxonomy: paper.taxonomy,
      normalizedPaperCode: paper.normalizedPaperCode,
      controlledVocabs: paper.controlledVocabs,
    })),
  );

  const response = await sendChatRequestWithRetries(
    {
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      responseFormat: { type: "json_object" },
    },
    `batch ${papers.length} papers`,
  );

  const content = getChatResponseContent(response);
  if (!content) throw new Error(`No batch tagging response for ${papers.length} papers`);

  let parsed: TaggedBatchResponse;
  try {
    parsed = JSON.parse(content) as TaggedBatchResponse;
  } catch (error) {
    const debugPath = writeDebugResponse("batch", `batch-${papers.length}`, content);
    throw new Error(`Failed to parse batch model JSON. Raw response saved to ${debugPath}. ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed.papers) || parsed.papers.length !== papers.length) {
    throw new Error(`Invalid batch tagging response format for ${papers.length} papers`);
  }

  const bySourceFile = new Map(parsed.papers.map((paper) => [paper.source_file, paper]));
  const results = new Map<string, TaggedQuestionPart[]>();

  for (const paper of papers) {
    const taggedPaper = bySourceFile.get(paper.extracted.source_file);
    if (!taggedPaper) {
      throw new Error(`Batch response missing paper ${paper.extracted.source_file}`);
    }
    results.set(
      paper.paperJsonPath,
      mapTaggedPaperResult(paper.extracted, paper.taxonomy, paper.normalizedPaperCode, { question_parts: taggedPaper.question_parts }, paper.controlledVocabs),
    );
  }

  return results;
}

async function upsertTaggedPaperToConvex(
  client: ConvexHttpClient,
  extracted: ExtractedPaper,
  normalizedPaperCode: string,
  taggedParts: TaggedQuestionPart[],
) {
  const sourceRelativePath = deriveSourceRelativePath(extracted.source_file);
  const questionPartById = new Map(extracted.question_parts.map((part) => [part.question_id, part]));
  const payloadParts = taggedParts.map((taggedPart) => {
    const sourcePart = questionPartById.get(taggedPart.question_id);
    if (!sourcePart) {
      throw new Error(`Missing source question part for ${taggedPart.question_id}`);
    }

    return {
      questionId: sourcePart.question_id,
      questionNumber: sourcePart.question_number,
      questionPartNumber: sourcePart.question_part_number,
      sectionCode: sourcePart.section_code,
      sectionName: sourcePart.section_name,
      pageNumber: sourcePart.page_number,
      pageNumbers: sourcePart.page_numbers,
      marks: sourcePart.marks,
      commandWord: sourcePart.command_word,
      canonicalLeaf: taggedPart.canonical_leaf,
      knowledgePoints: taggedPart.knowledge_points,
      skillsTested: taggedPart.skills_tested,
      bloomLevel: taggedPart.bloom_level,
      difficulty: taggedPart.difficulty,
      questionType: taggedPart.question_type,
      keyTerms: taggedPart.key_terms,
      specReferences: taggedPart.spec_references,
      confidence: taggedPart.confidence,
      evidenceSnippet: taggedPart.evidence_snippet,
      taxonomyVersion: taggedPart.taxonomy_version,
      promptText: sourcePart.prompt_text,
      contextText: sourcePart.context_text,
      bbox: sourcePart.bbox,
      sourceMode: sourcePart.source_mode,
      assetIds: sourcePart.asset_ids,
      isChoiceQuestion: sourcePart.isChoiceQuestion || false,
      choiceGroupId: sourcePart.choiceGroupId,
      choiceGroupType: sourcePart.choiceGroupType,
      choiceOptionLabel: sourcePart.choiceOptionLabel,
      choiceOptionIndex: sourcePart.choiceOptionIndex,
      choiceSiblingQuestionIds: sourcePart.choiceSiblingQuestionIds,
      sharedChoiceStem: sourcePart.sharedChoiceStem,
      setText: taggedPart.setText,
      cluster: taggedPart.cluster,
      namedPoem: taggedPart.namedPoem,
      characters: taggedPart.characters,
      themes: taggedPart.themes,
      taskMode: taggedPart.taskMode,
      domain: taggedPart.domain,
      subtopic: taggedPart.subtopic,
      representation: taggedPart.representation,
      subskill: taggedPart.subskill,
      errorTrap: taggedPart.errorTrap,
      unit: taggedPart.unit,
      caseStudy: taggedPart.caseStudy,
      resourceTrack: taggedPart.resourceTrack,
      process: taggedPart.process,
    };
  });

  const untypedClient = client as unknown as {
    mutation: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  };

  await untypedClient.mutation("questionTags:upsertTaggedPaperWithQuestions", {
    sourceFile: extracted.source_file,
    sourceRelativePath,
    boardCode: extracted.board_code,
    subjectSlug: extracted.subject_slug,
    paperCode: normalizedPaperCode,
    year: extracted.year,
    session: extracted.session,
    parserVersion: extracted.parser_version,
    taggerProvider: "openrouter",
    taggerModel: MODEL,
    taxonomyVersion: taggedParts[0]?.taxonomy_version ?? "unknown",
    questionParts: payloadParts,
  });
}

function preparePaperForTagging(paperJsonPath: string, configDir: string) {
  const extracted = JSON.parse(readFileSync(paperJsonPath, "utf8")) as ExtractedPaper;
  const taxonomy = loadTaxonomy(extracted.board_code, extracted.subject_slug, configDir);
  const controlledVocabs = loadControlledVocabularies(extracted.board_code, extracted.subject_slug, configDir);
  const normalizedPaperCode = normalizePaperCode(extracted);

  if (!taxonomy) {
    return { paperJsonPath, status: "skipped" as const, extracted, taxonomy: null, normalizedPaperCode, controlledVocabs: {} as ControlledVocabularies };
  }

  const normalizedExtracted: ExtractedPaper = {
    ...extracted,
    paper_code: normalizedPaperCode,
    question_parts: extracted.question_parts.map((part) => ({
      ...part,
      paper_code: normalizedPaperCode,
      isChoiceQuestion: part.isChoiceQuestion ?? false,
      choiceGroupId: part.choiceGroupId ?? null,
      choiceGroupType: part.choiceGroupType ?? null,
      choiceOptionLabel: part.choiceOptionLabel ?? null,
      choiceOptionIndex: part.choiceOptionIndex ?? null,
      choiceSiblingQuestionIds: part.choiceSiblingQuestionIds ?? [],
      sharedChoiceStem: part.sharedChoiceStem ?? null,
    })),
  };

  return {
    paperJsonPath,
    status: "ready" as const,
    extracted: normalizedExtracted,
    taxonomy,
    normalizedPaperCode,
    originalPaperCode: extracted.paper_code,
    controlledVocabs,
  };
}

async function persistTaggedPaper(
  preparedPaper: ReturnType<typeof preparePaperForTagging> & { status: "ready" },
  taggedParts: TaggedQuestionPart[],
  convexClient: ConvexHttpClient | null,
) {
  const extracted = preparedPaper.extracted;
  const taggedByQuestionId: Record<string, TaggedQuestionPart> = {};
  for (const part of taggedParts) taggedByQuestionId[part.question_id] = part;

  const outputPath = getTaggedOutputPath(preparedPaper.paperJsonPath);
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        source_file: extracted.source_file,
        board_code: extracted.board_code,
        subject_slug: extracted.subject_slug,
        paper_code: preparedPaper.normalizedPaperCode,
        original_paper_code: preparedPaper.originalPaperCode,
        year: extracted.year,
        session: extracted.session,
        parser_version: extracted.parser_version,
        tagger: { provider: "openrouter", model: MODEL, taxonomy_version: preparedPaper.taxonomy.metadata.version ?? "unknown" },
        tagged_questions: taggedByQuestionId,
        question_parts: taggedParts,
      },
      null,
      2,
    ),
  );
  console.log(`  wrote ${outputPath}`);

  if (convexClient) {
    await upsertTaggedPaperToConvex(convexClient, extracted, preparedPaper.normalizedPaperCode, taggedParts);
    console.log("  upserted tags to Convex");
  }
}

function chunkPaperPathsForBudget(paperPaths: string[]) {
  const remainingCallBudget = Math.max(0, AI_DAILY_CALL_LIMIT - getCallsUsedToday());
  const batchSize = remainingCallBudget > 0 && paperPaths.length > remainingCallBudget
    ? Math.min(AI_BATCH_MAX_PAPERS, Math.ceil(paperPaths.length / remainingCallBudget))
    : 1;

  const batches: string[][] = [];
  for (let index = 0; index < paperPaths.length; index += batchSize) {
    batches.push(paperPaths.slice(index, index + batchSize));
  }

  return { batches, batchSize, remainingCallBudget };
}

function collectPaperJsonPaths(inputDir: string): string[] {
  const paths: string[] = [];
  function scan(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) scan(fullPath);
      else if (entry.isFile() && entry.name === "paper.json") paths.push(fullPath);
    }
  }
  scan(inputDir);
  const priorityMap = new Map<string, number>(PAPER_PRIORITY_ORDER.map((key, index) => [key, index]));

  const getPriorityIndex = (paperPath: string) => {
    const normalized = paperPath.replaceAll("\\", "/");
    const match = normalized.match(/\/data\/extracted\/([^/]+)\/([^/]+)\//);
    if (!match) return Number.MAX_SAFE_INTEGER;
    const key = `${match[1]}-${match[2]}`;
    return priorityMap.get(key) ?? Number.MAX_SAFE_INTEGER;
  };

  return paths.sort((a, b) => {
    const pa = getPriorityIndex(a);
    const pb = getPriorityIndex(b);
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: npm run papers:tag -- [--paper-json <path>] [--input-dir <path>] [--config-dir <path>]");
    console.log("Flags:");
    console.log("  --skip-convex (skip writing tags to Convex)");
    console.log("  --force / --retag (ignore existing tagged-paper.json and retag)");
    console.log("Environment:");
    console.log("  OPENROUTER_API_KEY");
    console.log("  OPENROUTER_MODEL (optional)");
    console.log("  CONVEX_URL or NEXT_PUBLIC_CONVEX_URL (required unless --skip-convex)");
    console.log("  PAPER_CONCURRENCY (optional, default 20)");
    console.log("  AI_RETRIES (optional, default 4)");
    console.log("  AI_RETRY_BASE_MS (optional, default 1500)");
    console.log("  AI_PER_MINUTE_LIMIT (optional, default 20)");
    console.log("  AI_DAILY_CALL_LIMIT (optional, default 1000)");
    console.log("  AI_BATCH_MAX_PAPERS (optional, default 3)");
    console.log("Notes:");
    console.log("  Uses direct OpenRouter calls and rate-limits them locally");
    return;
  }

  const { paperJson, inputDir, configDir, writeToConvex, forceRetag } = parseArgs();
  assertEnv(writeToConvex);
  const discoveredPaperPaths = paperJson ? [paperJson] : collectPaperJsonPaths(inputDir);
  if (discoveredPaperPaths.length === 0) throw new Error("No extracted paper.json files found");

  let alreadyTaggedSkipped = 0;
  const paperPaths = forceRetag
    ? discoveredPaperPaths
    : discoveredPaperPaths.filter((paperPath) => {
      const taggedPath = getTaggedOutputPath(paperPath);
      const shouldProcess = !existsSync(taggedPath);
      if (!shouldProcess) alreadyTaggedSkipped += 1;
      return shouldProcess;
    });

  if (paperPaths.length === 0) {
    console.log(`Nothing to do. All ${discoveredPaperPaths.length} papers already have tagged-paper.json (use --force to retag).`);
    return;
  }

  const convexClient = writeToConvex ? new ConvexHttpClient(CONVEX_URL as string) : null;
  const { batches, batchSize, remainingCallBudget } = chunkPaperPathsForBudget(paperPaths);

  console.log(
    `Tagging ${paperPaths.length} papers with concurrency ${PAPER_CONCURRENCY} (batchSize=${batchSize}, dailyCallsRemaining=${remainingCallBudget}, pre-skipped existing=${alreadyTaggedSkipped})`,
  );
  let taggedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  await runPool(batches, PAPER_CONCURRENCY, async (batchPaths, index) => {
    console.log(`[${index + 1}/${batches.length}] ${batchPaths.length === 1 ? batchPaths[0] : `${batchPaths.length} papers batched`}`);
    try {
      const prepared = batchPaths.map((paperJsonPath) => preparePaperForTagging(paperJsonPath, configDir));
      const skipped = prepared.filter((paper) => paper.status === "skipped");
      for (const paper of skipped) {
        console.warn(`  No taxonomy found for ${paper.extracted.board_code}/${paper.extracted.subject_slug}; skipping ${paper.paperJsonPath}`);
      }
      skippedCount += skipped.length;

      const readyPapers = prepared.filter((paper): paper is Extract<ReturnType<typeof preparePaperForTagging>, { status: "ready" }> => paper.status === "ready");
      for (const paper of readyPapers) {
        if (paper.normalizedPaperCode !== paper.originalPaperCode) {
          console.log(`  Normalized paper code ${paper.originalPaperCode} -> ${paper.normalizedPaperCode}`);
        }
      }

      if (readyPapers.length === 0) return;

      const taggedMap = await tagPaperBatch(readyPapers.map((paper) => ({
        paperJsonPath: paper.paperJsonPath,
        extracted: paper.extracted,
        taxonomy: paper.taxonomy,
        normalizedPaperCode: paper.normalizedPaperCode,
        controlledVocabs: paper.controlledVocabs,
      })));

      for (const paper of readyPapers) {
        const taggedParts = taggedMap.get(paper.paperJsonPath);
        if (!taggedParts) throw new Error(`Missing tagged result for ${paper.paperJsonPath}`);
        await persistTaggedPaper(paper, taggedParts, convexClient);
        taggedCount += 1;
      }
    } catch (error) {
      failedCount += batchPaths.length;
      console.error(`  failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  console.log(`Done. tagged=${taggedCount} skipped=${skippedCount} failed=${failedCount} already_tagged_skipped=${alreadyTaggedSkipped}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
