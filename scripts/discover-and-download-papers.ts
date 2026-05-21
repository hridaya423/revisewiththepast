import "dotenv/config";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import * as cheerio from "cheerio";
import { GCSE_SUBJECTS } from "@/convex/gcseCatalog";

type Tier = "none" | "foundation" | "higher";
type Session = "june" | "november" | "january";
type DownloadKind = "question_paper" | "mark_scheme" | "insert";

type SearchJob = {
  subjectSlug: string;
  subjectName: string;
  boardCode: string;
  boardName: string;
  tier: Tier;
  source: "pmt" | "revisionworld";
};

type SearchJobsFile = {
  generatedAt: string;
  totalJobs: number;
  jobs: SearchJob[];
};

type PaperPage = {
  url: string;
  slug: string;
  code: string;
  baseCode: string;
  optionCode?: string;
  name: string;
};

type ExtractedPdfLink = {
  url: string;
  anchorText: string;
};

type PdfRecord = {
  jobKey: string;
  boardCode: string;
  subjectSlug: string;
  tier: Tier;
  year: number;
  session: Session;
  paperCode: string;
  paperName: string;
  sourcePageUrl: string;
  pdfUrl: string;
  kind: DownloadKind;
  downloadedPath: string;
};

type DiscoveryState = {
  lastUpdatedAt: string;
  records: PdfRecord[];
};

type RevisionWorldRecord = {
  pdfUrl: string;
  year: number;
  session: Session;
  paperCode: string;
  paperName: string;
  kind: DownloadKind;
};

const INPUT_PATH = resolve(process.cwd(), "data/search-jobs.json");
const OUTPUT_DIR = resolve(process.cwd(), "data/downloads");
const OUTPUT_RECORDS_PATH = resolve(process.cwd(), "data/discovered-pdfs.json");
const PROGRESS_PATH = resolve(process.cwd(), "data/discovery-progress.json");
const MAX_JOBS = Number(process.env.MAX_JOBS ?? String(Number.MAX_SAFE_INTEGER));
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS ?? "400");
const START_YEAR = Number(process.env.START_YEAR ?? "2018");
const END_YEAR = Number(process.env.END_YEAR ?? "2024");
const TARGET_BOARD_CODE = process.env.TARGET_BOARD_CODE;
const TARGET_SUBJECT_SLUG = process.env.TARGET_SUBJECT_SLUG;
const TARGET_TIER = process.env.TARGET_TIER as Tier | undefined;
const TARGET_PAPER_CODE = process.env.TARGET_PAPER_CODE;
const TARGET_SOURCE = process.env.TARGET_SOURCE as "pmt" | "revisionworld" | undefined;
const RESET_MATCHING_STATE = process.env.RESET_MATCHING_STATE === "1";

const PMT_SUBJECT_PATHS: Partial<Record<string, string>> = {
  biology: "gcse-biology",
  chemistry: "gcse-chemistry",
  physics: "gcse-physics",
  mathematics: "gcse-maths",
  "english-language": "gcse-english-language",
  "english-literature": "gcse-english-literature",
  economics: "gcse-economics",
  geography: "gcse-geography",
  history: "gcse-history",
  "combined-science": "gcse-science",
  "computer-science": "gcse-computer-science",
  psychology: "gcse-psychology",
};

const REVISIONWORLD_CATEGORY_PAGES: Partial<Record<string, string>> = {
  biology: "https://revisionworld.com/gcse-revision/biology-gcse-revision/biology-gcse-past-papers",
  business: "https://revisionworld.com/gcse-revision/business-studies/business-studies-gcse-past-papers",
  chemistry: "https://revisionworld.com/gcse-revision/chemistry-gcse-revision/chemistry-gcse-past-papers",
  "combined-science": "https://revisionworld.com/gcse-revision/science-gcse-revision/science-gcse-past-papers",
  "computer-science": "https://revisionworld.com/gcse-revision/computer-science-gcse-revision/computer-science-gcse-past-papers",
  economics: "https://revisionworld.com/gcse-revision/economics-gcse-revision/economics-gcse-past-papers",
  "english-language": "https://revisionworld.com/gcse-revision/english-language-gcse-level/english-language-gcse-past-papers",
  "english-literature": "https://revisionworld.com/gcse-revision/english-literature-gcse-level/english-literature-gcse-past-papers",
  french: "https://revisionworld.com/gcse-revision/french/french-gcse-past-papers",
  geography: "https://revisionworld.com/gcse-revision/geography-gcse-revision/geography-gcse-past-papers",
  german: "https://revisionworld.com/gcse-revision/german/german-gcse-past-papers",
  history: "https://revisionworld.com/gcse-revision/history-gcse-revision/history-gcse-past-papers",
  physics: "https://revisionworld.com/gcse-revision/physics-gcse-revision/physics-gcse-past-papers",
  psychology: "https://revisionworld.com/gcse-revision/psychology-gcse-revision/psychology-gcse-past-papers",
  sociology: "https://revisionworld.com/gcse-revision/sociology-gcse-revision/sociology-gcse-past-papers",
  spanish: "https://revisionworld.com/gcse-revision/spanish/spanish-gcse-past-papers",
};

const SUBJECT_START_YEAR_OVERRIDES: Partial<Record<string, number>> = {
  "computer-science": 2022,
};

const PMT_SKIPPED_JOB_KEYS = new Set(["ocr:none:combined-science", "ocr:foundation:combined-science", "ocr:higher:combined-science"]);

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/#.*$/, "");
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function buildJobKey(job: SearchJob): string {
  return `${job.boardCode}-${job.tier}-${job.subjectSlug}`;
}

function subjectNeedsInsert(subjectSlug: string): boolean {
  return subjectSlug === "english-language" || subjectSlug === "english-literature" || subjectSlug === "geography";
}

function unwrapEmbeddedPdfUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const embedded = parsed.searchParams.get("pdf");
    if (embedded && embedded.startsWith("http")) {
      return embedded;
    }
    return url;
  } catch {
    return url;
  }
}

function extractYearFromText(text: string): number | null {
  const fourDigitMatch = text.match(/\b(20\d{2})\b/);
  if (fourDigitMatch) {
    return Number(fourDigitMatch[1]);
  }

  const twoDigitMatch = text.match(/\b(?:jan|january|jun|june|nov|november)[-_ %]*(\d{2})\b/i);
  if (!twoDigitMatch) {
    return null;
  }

  return 2000 + Number(twoDigitMatch[1]);
}

function extractSessionFromText(text: string): Session | null {
  const normalized = normalizeText(text);
  if (normalized.includes("november") || normalized.includes(" nov ") || normalized.startsWith("nov ")) {
    return "november";
  }
  if (normalized.includes("june") || normalized.includes(" jun ") || normalized.startsWith("jun ")) {
    return "june";
  }
  if (normalized.includes("january") || normalized.includes(" jan ") || normalized.startsWith("jan ")) {
    return "january";
  }
  return null;
}

function detectKind(text: string, subjectSlug: string): DownloadKind | null {
  const lower = text.toLowerCase();
  const hasMs = lower.includes("/ms/") || lower.includes("-ms") || lower.includes(" ms") || lower.includes("mark scheme");
  const hasQp = lower.includes("/qp/") || lower.includes("-qp") || lower.includes(" qp") || lower.includes("question paper");
  const hasInsert =
    lower.includes("/in/") ||
    lower.includes(" insert") ||
    lower.includes("extract") ||
    lower.includes("source booklet") ||
    lower.includes("reading booklet") ||
    lower.includes("resource booklet");

  if (hasMs && !hasQp) {
    return "mark_scheme";
  }
  if (subjectNeedsInsert(subjectSlug) && hasInsert) {
    return "insert";
  }
  if (hasQp && !hasMs) {
    return "question_paper";
  }
  return null;
}

function matchesTier(raw: string, tier: Tier): boolean {
  if (tier === "none") {
    return true;
  }

  const lower = raw.toLowerCase();
  if (tier === "foundation") {
    return lower.includes("foundation") || /(?:paper|biology|chemistry|physics)[- ]?\d+f\b/i.test(raw) || lower.includes("(f)");
  }

  return lower.includes("higher") || /(?:paper|biology|chemistry|physics)[- ]?\d+h\b/i.test(raw) || lower.includes("(h)");
}

function shouldSkipPdf(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes("specimen") ||
    lower.includes("mock") ||
    lower.includes("formula sheet") ||
    lower.includes("equation sheet") ||
    lower.includes("a-level") ||
    lower.includes("as-level")
  );
}

function getPmtLandingUrl(subjectSlug: string): string | null {
  const path = PMT_SUBJECT_PATHS[subjectSlug];
  if (!path) {
    return null;
  }

  return `https://www.physicsandmathstutor.com/past-papers/${path}/`;
}

function matchesBoardPage(slug: string, boardCode: string): boolean {
  if (slug.includes("igcse") || slug.includes("cie-") || slug.includes("caie-") || slug.includes("wjec") || slug.includes("eduqas")) {
    return false;
  }

  if (boardCode === "aqa") {
    return slug.startsWith("aqa-");
  }
  if (boardCode === "edexcel") {
    return slug.startsWith("edexcel-");
  }
  if (boardCode === "ocr") {
    return slug.startsWith("ocr-");
  }

  return false;
}

function derivePaperCode(boardCode: string, slug: string): string {
  const prefixes = [`${boardCode}-a-`, `${boardCode}-b-`, `${boardCode}-`];

  for (const prefix of prefixes) {
    if (slug.startsWith(prefix)) {
      return slug.slice(prefix.length);
    }
  }

  return slug;
}

function extractOptionCode(boardCode: string, slug: string): string | undefined {
  if (slug.startsWith(`${boardCode}-a-`)) {
    return "a";
  }
  if (slug.startsWith(`${boardCode}-b-`)) {
    return "b";
  }
  return undefined;
}

function buildUniquePaperCode(baseCode: string, optionCode?: string): string {
  return optionCode ? `${baseCode}-${optionCode}` : baseCode;
}

function getEffectiveStartYear(subjectSlug: string): number {
  return Math.max(START_YEAR, SUBJECT_START_YEAR_OVERRIDES[subjectSlug] ?? START_YEAR);
}

function getSubjectBoardConfig(job: SearchJob) {
  const subject = GCSE_SUBJECTS.find((item) => item.slug === job.subjectSlug);
  return subject?.boardConfigs.find((item) => item.boardCode === job.boardCode);
}

function isMatchingRevisionWorldBoardLink(job: SearchJob, resolvedUrl: string, text: string): boolean {
  const lowerUrl = resolvedUrl.toLowerCase();
  const lowerText = text.toLowerCase();

  if (job.boardCode === "aqa") {
    return lowerUrl.includes("/aqa-") || lowerText.startsWith("aqa ");
  }

  if (job.boardCode === "edexcel") {
    return lowerUrl.includes("/edexcel-") || lowerUrl.includes("/pearson-edexcel-") || lowerText.includes("edexcel");
  }

  if (job.boardCode === "ocr") {
    return lowerUrl.includes("/ocr-") || lowerText.startsWith("ocr ");
  }

  return false;
}

function normalizeRevisionWorldPdfUrl(url: string): string {
  const match = url.match(
    /^https:\/\/www\.aqa\.org\.uk\/files\/sample-papers-and-mark-schemes\.(20\d{2})\.(june|november)\.(AQA-[A-Z0-9-]+)_(PDF)$/i,
  );

  if (!match) {
    return url;
  }

  const [, year, session, fileName] = match;
  return `https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/${year}/${session.toLowerCase()}/${fileName}.PDF`;
}

function guessRevisionWorldBoardPage(job: SearchJob): string | null {
  const categoryUrl = REVISIONWORLD_CATEGORY_PAGES[job.subjectSlug];
  if (!categoryUrl) {
    return null;
  }

  const categoryPath = categoryUrl.replace(/\/+$/, "");
  const subjectToken = job.subjectSlug;

  if (job.boardCode === "aqa") {
    return `${categoryPath}/aqa-gcse-${subjectToken}-past-papers`;
  }

  if (job.boardCode === "edexcel") {
    return `${categoryPath}/edexcel-gcse-${subjectToken}-past-papers`;
  }

  if (job.boardCode === "ocr") {
    return `${categoryPath}/ocr-gcse-${subjectToken}-past-papers`;
  }

  return null;
}

function shouldSkipJob(job: SearchJob): boolean {
  return PMT_SKIPPED_JOB_KEYS.has(`${job.boardCode}:${job.tier}:${job.subjectSlug}`);
}

function getExpectedPaperCodes(job: SearchJob): Set<string> {
  const config = getSubjectBoardConfig(job);
  return new Set((config?.papers ?? []).map((paper) => paper.code));
}

function pageMatchesExpectedCodes(job: SearchJob, page: PaperPage): boolean {
  const expectedCodes = getExpectedPaperCodes(job);
  if (expectedCodes.size === 0) {
    return true;
  }

  if (expectedCodes.has(page.code) || expectedCodes.has(page.baseCode)) {
    return true;
  }

  return false;
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GCSEMetaBot/0.1)",
    },
  });

  const html = await response.text();
  if (!html) {
    throw new Error(`Empty response for ${url}`);
  }

  return html;
}

async function getRevisionWorldBoardPage(job: SearchJob): Promise<string | null> {
  const categoryUrl = REVISIONWORLD_CATEGORY_PAGES[job.subjectSlug];
  if (!categoryUrl) {
    return null;
  }

  const html = await fetchHtml(categoryUrl);
  const $ = cheerio.load(html);

  let boardPageUrl: string | null = null;

  $("a[href]").each((_, element) => {
    if (boardPageUrl) {
      return;
    }

    const href = $(element).attr("href");
    const text = $(element).text().trim().toLowerCase();
    if (!href) {
      return;
    }

    const resolved = normalizeUrl(new URL(href, categoryUrl).toString());
    if (isMatchingRevisionWorldBoardLink(job, resolved, text)) {
      boardPageUrl = resolved;
    }
  });

  return boardPageUrl ?? guessRevisionWorldBoardPage(job);
}

function derivePaperCodeFromText(text: string): string | null {
  const normalized = normalizeText(text);
  const scienceMatch = normalized.match(/\b(biology|chemistry|physics)\s*(\d+)\b/);
  if (scienceMatch) {
    return `${scienceMatch[1]}-${scienceMatch[2]}`;
  }

  const paperMatch = normalized.match(/\bpaper\s*(\d+)\b/);
  if (paperMatch) {
    return `paper-${paperMatch[1]}`;
  }

  const componentMatch = normalized.match(/\bcomponent\s*(\d+)\b/);
  if (componentMatch) {
    return `component-${componentMatch[1]}`;
  }

  return null;
}

function deriveRevisionWorldPaperInfo(
  job: SearchJob,
  paragraphText: string,
): { paperCode: string; paperName: string } | null {
  const config = getSubjectBoardConfig(job);
  const papers = config?.papers ?? [];
  const normalizedParagraph = normalizeText(paragraphText);

  const matchedByName = papers.find((paper) => {
    const normalizedName = normalizeText(paper.name);
    const keywords = normalizedName
      .split(" ")
      .filter((token) => token.length > 3)
      .filter((token) => !["paper", "component", "challenges"].includes(token));

    return keywords.length > 0 && keywords.some((token) => normalizedParagraph.includes(token));
  });

  if (matchedByName) {
    return {
      paperCode: matchedByName.code,
      paperName: matchedByName.name,
    };
  }

  const derivedCode = derivePaperCodeFromText(paragraphText);
  if (!derivedCode) {
    return null;
  }

  const directMatch = papers.find((paper) => paper.code === derivedCode);
  if (directMatch) {
    return {
      paperCode: directMatch.code,
      paperName: directMatch.name,
    };
  }

  const indexMatch = derivedCode.match(/(?:paper|component|unit)-(\d+)$/);
  if (indexMatch) {
    const paperIndex = Number(indexMatch[1]) - 1;
    const indexedPaper = papers[paperIndex];
    if (indexedPaper) {
      return {
        paperCode: indexedPaper.code,
        paperName: indexedPaper.name,
      };
    }
  }

  return {
    paperCode: derivedCode,
    paperName: derivedCode,
  };
}

function detectRevisionWorldKind(href: string, anchorText: string): DownloadKind | null {
  const lowerHref = href.toLowerCase();
  const lowerText = anchorText.toLowerCase();

  if (lowerText.includes("mark scheme") || lowerHref.includes("-ms-") || lowerHref.includes("-rms-") || lowerHref.includes("-msc_") || lowerHref.includes("-msc-") || lowerHref.includes("w-ms")) {
    return "mark_scheme";
  }

  if (lowerText.includes("download past paper") || lowerText.includes("download paper") || lowerHref.includes("-qp-") || lowerHref.includes("-que-") || lowerHref.includes("-sqp_") || lowerHref.includes("-sqp-")) {
    return "question_paper";
  }

  return null;
}

async function extractRevisionWorldRecords(
  job: SearchJob,
  boardPageUrl: string,
): Promise<RevisionWorldRecord[]> {
  const html = await fetchHtml(boardPageUrl);
  const $ = cheerio.load(html);
  const records: RevisionWorldRecord[] = [];

  let currentYear: number | null = null;
  let currentSession: Session | null = null;

  $("div.field--name-body p").each((_, paragraph) => {
    const paragraphText = $(paragraph).text().trim();
    if (!paragraphText) {
      return;
    }

    const parsedYear = extractYearFromText(paragraphText);
    const parsedSession = extractSessionFromText(paragraphText);
    if (parsedYear && parsedSession) {
      currentYear = parsedYear;
      currentSession = parsedSession;
    }

    const paperInfo = deriveRevisionWorldPaperInfo(job, paragraphText);
    if (!paperInfo || currentYear === null || currentSession === null) {
      return;
    }

    const year = currentYear;
    const session = currentSession;
    const paperCode = paperInfo.paperCode;
    const paperName = paragraphText.split("Download")[0]?.trim() || paperInfo.paperName;

    $(paragraph)
      .find("a[href]")
      .each((__, link) => {
        const href = $(link).attr("href");
        const anchorText = $(link).text().trim();
        if (!href) {
          return;
        }

        const resolved = normalizeUrl(
          normalizeRevisionWorldPdfUrl(unwrapEmbeddedPdfUrl(new URL(href, boardPageUrl).toString())),
        );
        const raw = `${resolved} ${anchorText} ${paragraphText}`;
        const kind = detectRevisionWorldKind(resolved, anchorText);
        if (!kind || shouldSkipPdf(raw)) {
          return;
        }

        records.push({
          pdfUrl: resolved,
          year,
          session,
          paperCode,
          paperName,
          kind,
        });
      });
  });

  return records;
}

async function getPaperPages(job: SearchJob): Promise<PaperPage[]> {
  const landingUrl = getPmtLandingUrl(job.subjectSlug);
  if (!landingUrl) {
    return [];
  }

  const html = await fetchHtml(landingUrl);
  const $ = cheerio.load(html);
  const pages = new Map<string, PaperPage>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    const text = $(element).text().trim();
    if (!href) {
      return;
    }

    let resolved: string;
    try {
      resolved = new URL(href, landingUrl).toString();
    } catch {
      return;
    }

    const normalizedUrl = normalizeUrl(resolved);
    if (!normalizedUrl.startsWith(landingUrl) || normalizedUrl === landingUrl) {
      return;
    }

    const slug = normalizedUrl.slice(landingUrl.length).replace(/^\/+|\/+$/g, "");
    if (!slug || !matchesBoardPage(slug, job.boardCode)) {
      return;
    }

    const baseCode = derivePaperCode(job.boardCode, slug);
    const optionCode = extractOptionCode(job.boardCode, slug);
    const code = buildUniquePaperCode(baseCode, optionCode);
    if (TARGET_PAPER_CODE && baseCode !== TARGET_PAPER_CODE && code !== TARGET_PAPER_CODE) {
      return;
    }

    if (!pages.has(normalizedUrl)) {
      pages.set(normalizedUrl, {
        url: normalizedUrl,
        slug,
        code,
        baseCode,
        optionCode,
        name: text || code,
      });
    }
  });

  return Array.from(pages.values());
}

async function extractPdfLinks(pageUrl: string): Promise<ExtractedPdfLink[]> {
  const html = await fetchHtml(pageUrl);
  const $ = cheerio.load(html);
  const links = new Map<string, string>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }

    const anchorText = $(element).text().trim();
    try {
      const resolved = new URL(href, pageUrl).toString();
      if (resolved.toLowerCase().includes(".pdf")) {
        const normalized = normalizeUrl(unwrapEmbeddedPdfUrl(resolved));
        if (!links.has(normalized)) {
          links.set(normalized, anchorText);
        }
      }
    } catch {
      return;
    }
  });

  return Array.from(links.entries()).map(([url, anchorText]) => ({ url, anchorText }));
}

async function downloadPdf(url: string, outPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GCSEMetaBot/0.1)",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("pdf") && !url.toLowerCase().includes(".pdf")) {
    throw new Error(`Not a PDF response: ${contentType}`);
  }

  await pipeline(response.body as unknown as NodeJS.ReadableStream, createWriteStream(outPath));
}

function scanExistingRecords(): PdfRecord[] {
  const records: PdfRecord[] = [];
  if (!existsSync(OUTPUT_DIR)) {
    return records;
  }

  const walk = (directoryPath: string) => {
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      const fullPath = resolve(directoryPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pdf")) {
        continue;
      }

      const parts = relative(OUTPUT_DIR, fullPath).split("/");
      if (parts.length < 4) {
        continue;
      }

      const [boardCode, subjectSlug, tier, fileName] = parts;
      const match = fileName.match(/^\d+-(\d{4})-([a-z0-9-]+)-(question_paper|mark_scheme|insert)-(.+)\.pdf$/i);
      if (!match) {
        continue;
      }

      const year = Number(match[1]);
      const paperCode = match[2];
      const kind = match[3] as DownloadKind;
      const session = extractSessionFromText(match[4]);
      if (!session) {
        continue;
      }

      records.push({
        jobKey: `${boardCode}-${tier}-${subjectSlug}`,
        boardCode,
        subjectSlug,
        tier: tier as Tier,
        year,
        session,
        paperCode,
        paperName: paperCode,
        sourcePageUrl: "",
        pdfUrl: "",
        kind,
        downloadedPath: fullPath,
      });
    }
  };

  walk(OUTPUT_DIR);
  return records;
}

function loadDiscoveryState(): DiscoveryState {
  const diskRecords = scanExistingRecords();
  if (!existsSync(PROGRESS_PATH)) {
    return {
      lastUpdatedAt: new Date().toISOString(),
      records: diskRecords,
    };
  }

  const parsed = JSON.parse(readFileSync(PROGRESS_PATH, "utf8")) as Partial<DiscoveryState>;
  const combined = [...(Array.isArray(parsed.records) ? parsed.records : []), ...diskRecords];
  const deduped = new Map<string, PdfRecord>();
  for (const record of combined) {
    const key = `${record.downloadedPath}|${record.pdfUrl}|${record.boardCode}|${record.subjectSlug}|${record.paperCode}|${record.kind}|${record.year}|${record.session}`;
    if (!deduped.has(key)) {
      deduped.set(key, record);
    }
  }

  return {
    lastUpdatedAt: typeof parsed.lastUpdatedAt === "string" ? parsed.lastUpdatedAt : new Date().toISOString(),
    records: Array.from(deduped.values()),
  };
}

function persistDiscoveryState(state: DiscoveryState) {
  state.lastUpdatedAt = new Date().toISOString();
  mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
  writeFileSync(PROGRESS_PATH, JSON.stringify(state, null, 2));
  writeFileSync(
    OUTPUT_RECORDS_PATH,
    JSON.stringify(
      {
        generatedAt: state.lastUpdatedAt,
        totalRecords: state.records.length,
        records: state.records,
      },
      null,
      2,
    ),
  );
}

function matchesActiveFilters(record: PdfRecord) {
  if (TARGET_SOURCE && record.jobKey.split("-").at(-1) !== TARGET_SOURCE) return false;
  if (TARGET_BOARD_CODE && record.boardCode !== TARGET_BOARD_CODE) return false;
  if (TARGET_SUBJECT_SLUG && record.subjectSlug !== TARGET_SUBJECT_SLUG) return false;
  if (TARGET_TIER && record.tier !== TARGET_TIER) return false;
  if (TARGET_PAPER_CODE && record.paperCode !== TARGET_PAPER_CODE) return false;
  return true;
}

async function run() {
  const input: SearchJobsFile = JSON.parse(readFileSync(INPUT_PATH, "utf8"));
  const state = loadDiscoveryState();
  if (RESET_MATCHING_STATE) {
    state.records = state.records.filter((record) => !matchesActiveFilters(record));
    persistDiscoveryState(state);
  }
  const selectedJobs = input.jobs
    .filter((job) => (TARGET_SOURCE ? job.source === TARGET_SOURCE : true))
    .filter((job) => (TARGET_BOARD_CODE ? job.boardCode === TARGET_BOARD_CODE : true))
    .filter((job) => (TARGET_SUBJECT_SLUG ? job.subjectSlug === TARGET_SUBJECT_SLUG : true))
    .filter((job) => (TARGET_TIER ? job.tier === TARGET_TIER : true))
    .slice(0, MAX_JOBS);

  const seenPdfUrls = new Set(state.records.map((record) => record.pdfUrl).filter(Boolean));

  for (const [jobIndex, job] of selectedJobs.entries()) {
    console.log(`\n[${jobIndex + 1}/${selectedJobs.length}] ${job.boardName} ${job.subjectName} (${job.tier})`);

    if (job.source === "revisionworld") {
      const jobDir = resolve(OUTPUT_DIR, job.boardCode, job.subjectSlug, job.tier);
      mkdirSync(jobDir, { recursive: true });
      const effectiveStartYear = getEffectiveStartYear(job.subjectSlug);

      let boardPageUrl: string | null = null;
      try {
        boardPageUrl = await getRevisionWorldBoardPage(job);
      } catch (error) {
        console.error(`  Failed to load Revision World category page: ${String(error)}`);
        continue;
      }

      if (!boardPageUrl) {
        console.log("  Skipped: Revision World does not expose a matching board page for this subject");
        continue;
      }

      console.log(`  Revision World board page: ${boardPageUrl}`);

      let records: RevisionWorldRecord[] = [];

      try {
        records = await extractRevisionWorldRecords(job, boardPageUrl);
      } catch (error) {
        console.error(`  Failed to parse Revision World board page: ${String(error)}`);
        continue;
      }

      console.log(`  Revision World raw records: ${records.length}`);
      const matched = records
        .filter((record) => record.year >= effectiveStartYear && record.year <= END_YEAR)
        .filter((record) => matchesTier(`${record.paperName} ${record.pdfUrl}`, job.tier))
        .filter((record) => (TARGET_PAPER_CODE ? record.paperCode === TARGET_PAPER_CODE : true));

      console.log(`  Revision World matches: ${matched.length} PDFs`);

      for (const [pdfIndex, record] of matched.entries()) {
        const canonicalPdfUrl = normalizeUrl(record.pdfUrl);
        if (seenPdfUrls.has(canonicalPdfUrl)) {
          continue;
        }
        seenPdfUrls.add(canonicalPdfUrl);

        const fileName = `${String(state.records.length + 1).padStart(6, "0")}-${record.year}-${record.paperCode}-${record.kind}-${slugify(
          canonicalPdfUrl.split("/").pop() || `paper-${pdfIndex + 1}`,
        )}.pdf`;
        const outPath = resolve(jobDir, fileName);

        await sleep(REQUEST_DELAY_MS);
        try {
          await downloadPdf(canonicalPdfUrl, outPath);
          state.records.push({
            jobKey: buildJobKey(job),
            boardCode: job.boardCode,
            subjectSlug: job.subjectSlug,
            tier: job.tier,
            year: record.year,
            session: record.session,
            paperCode: record.paperCode,
            paperName: record.paperName,
            sourcePageUrl: boardPageUrl,
            pdfUrl: canonicalPdfUrl,
            kind: record.kind,
            downloadedPath: outPath,
          });
          persistDiscoveryState(state);
          console.log(`    downloaded (${record.year} ${record.paperCode} ${record.kind} ${record.session}): ${canonicalPdfUrl}`);
        } catch (error) {
          console.error(`    download failed: ${canonicalPdfUrl} (${String(error)})`);
        }
      }

      continue;
    }

    if (shouldSkipJob(job)) {
      console.log("  Skipped: PMT coverage for this board/subject combo is intentionally disabled");
      continue;
    }

    const jobDir = resolve(OUTPUT_DIR, job.boardCode, job.subjectSlug, job.tier);
    mkdirSync(jobDir, { recursive: true });
    const effectiveStartYear = getEffectiveStartYear(job.subjectSlug);

    let paperPages: PaperPage[] = [];
    try {
      paperPages = await getPaperPages(job);
    } catch (error) {
      console.error(`  Failed to load PMT landing page: ${String(error)}`);
      continue;
    }

    if (paperPages.length === 0) {
      console.log("  Skipped: PMT does not expose matching paper pages for this subject/board");
      continue;
    }

    paperPages = paperPages.filter((page) => pageMatchesExpectedCodes(job, page));

    if (paperPages.length === 0) {
      console.log("  Skipped: PMT only exposes legacy or unsupported page variants for this subject/board");
      continue;
    }

    console.log(`  Found ${paperPages.length} PMT paper pages`);

    for (const page of paperPages) {
      await sleep(REQUEST_DELAY_MS);
      let pdfLinks: ExtractedPdfLink[] = [];
      try {
        pdfLinks = await extractPdfLinks(page.url);
      } catch (error) {
        console.error(`  Failed to read ${page.url}: ${String(error)}`);
        continue;
      }

      const matched = pdfLinks
        .map((pdf) => {
          const raw = `${pdf.url} ${pdf.anchorText}`;
          const year = extractYearFromText(raw);
          const session = extractSessionFromText(raw);
          const kind = detectKind(raw, job.subjectSlug);

          return { pdf, raw, year, session, kind };
        })
        .filter((item) => item.year !== null && item.year >= effectiveStartYear && item.year <= END_YEAR)
        .filter((item) => item.session !== null)
        .filter((item) => item.kind !== null)
        .filter((item) => matchesTier(item.raw, job.tier))
        .filter((item) => !shouldSkipPdf(item.raw));

      console.log(`  ${page.code}: ${matched.length} matching PDFs`);

      for (const [pdfIndex, item] of matched.entries()) {
        const canonicalPdfUrl = normalizeUrl(unwrapEmbeddedPdfUrl(item.pdf.url));
        if (seenPdfUrls.has(canonicalPdfUrl)) {
          continue;
        }
        seenPdfUrls.add(canonicalPdfUrl);

        const fileName = `${String(state.records.length + 1).padStart(6, "0")}-${item.year}-${page.code}-${item.kind}-${slugify(
          canonicalPdfUrl.split("/").pop() || `paper-${pdfIndex + 1}`,
        )}.pdf`;
        const outPath = resolve(jobDir, fileName);

        await sleep(REQUEST_DELAY_MS);
        try {
          await downloadPdf(canonicalPdfUrl, outPath);
          state.records.push({
            jobKey: buildJobKey(job),
            boardCode: job.boardCode,
            subjectSlug: job.subjectSlug,
            tier: job.tier,
            year: item.year as number,
            session: item.session as Session,
            paperCode: page.code,
            paperName: page.name,
            sourcePageUrl: page.url,
            pdfUrl: canonicalPdfUrl,
            kind: item.kind as DownloadKind,
            downloadedPath: outPath,
          });
          persistDiscoveryState(state);
          console.log(`    downloaded (${item.year} ${page.code} ${item.kind} ${item.session}): ${canonicalPdfUrl}`);
        } catch (error) {
          console.error(`    download failed: ${canonicalPdfUrl} (${String(error)})`);
        }
      }
    }
  }

  persistDiscoveryState(state);
  console.log(`\nDone. Saved ${state.records.length} PDF records to ${OUTPUT_RECORDS_PATH}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
