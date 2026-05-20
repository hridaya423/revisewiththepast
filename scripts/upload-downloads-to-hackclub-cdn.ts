import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";

type Tier = "none" | "foundation" | "higher";
type Session = "june" | "november" | "january" | "unknown";
type DownloadKind = "question_paper" | "mark_scheme" | "insert";
type Source = "pmt" | "revisionworld" | "manual";

type AssetUploadRecord = {
  boardCode: string;
  subjectSlug: string;
  tier: Tier;
  year: number;
  session: Session;
  paperCode: string;
  paperName: string;
  kind: DownloadKind;
  source: Source;
  relativePath: string;
  absolutePath: string;
  fileName: string;
};

type HackClubManifestRecord = AssetUploadRecord & {
  uploadId: string;
  url: string;
  size: number;
  contentType: string;
  uploadedAt: string;
};

type HackClubManifest = {
  generatedAt: string;
  records: HackClubManifestRecord[];
};

const DOWNLOADS_DIR = resolve(process.cwd(), "data/downloads");
const MANIFEST_PATH = resolve(process.cwd(), "data/hackclub-cdn-manifest.json");
const TARGET_BOARD_CODE = process.env.TARGET_BOARD_CODE;
const TARGET_SUBJECT_SLUG = process.env.TARGET_SUBJECT_SLUG;
const TARGET_TIER = process.env.TARGET_TIER as Tier | undefined;
const TARGET_SOURCE = process.env.TARGET_SOURCE as Source | undefined;
const MAX_FILES = Number(process.env.MAX_FILES ?? String(Number.MAX_SAFE_INTEGER));
const UPLOAD_CONCURRENCY = Number(process.env.UPLOAD_CONCURRENCY ?? "20");
const UPLOAD_RETRIES = Number(process.env.UPLOAD_RETRIES ?? "3");
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS ?? "1500");
const HACKCLUB_CDN_API_KEY = process.env.HACKCLUB_CDN_API_KEY;
const CONVEX_URL = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function normalizeRelativePath(pathValue: string): string {
  return pathValue.replaceAll("\\", "/");
}

function extractSessionFromText(text: string): Session {
  const lower = text.toLowerCase();
  if (lower.includes("november") || lower.includes(" nov ") || lower.startsWith("nov-")) {
    return "november";
  }
  if (lower.includes("june") || lower.includes(" jun ") || lower.startsWith("jun-")) {
    return "june";
  }
  if (lower.includes("january") || lower.includes(" jan ") || lower.startsWith("jan-")) {
    return "january";
  }
  return "unknown";
}

function inferSource(relativePath: string): Source {
  const lower = relativePath.toLowerCase();
  if (
    lower.includes("cdn.sanity.io") ||
    lower.includes("revisionworld") ||
    lower.includes("qualifications.pearson.com") ||
    lower.includes("aqa.org.uk") ||
    lower.includes("ocr.org.uk")
  ) {
    return "revisionworld";
  }
  return "pmt";
}

function derivePaperName(paperCode: string): string {
  return paperCode.replace(/-/g, " ");
}

function scanDownloadFiles(): AssetUploadRecord[] {
  const records: AssetUploadRecord[] = [];
  if (!existsSync(DOWNLOADS_DIR)) {
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

      const rel = relative(DOWNLOADS_DIR, fullPath);
      const parts = rel.split("/");
      if (parts.length < 4) {
        continue;
      }

      const [boardCode, subjectSlug, tier, fileName] = parts;
      const match = fileName.match(/^\d+-(\d{4})-([a-z0-9-]+)-(question_paper|mark_scheme|insert)-(.+)\.pdf$/i);
      if (!match) {
        continue;
      }

      records.push({
        boardCode,
        subjectSlug,
        tier: tier as Tier,
        year: Number(match[1]),
        paperCode: match[2],
        paperName: derivePaperName(match[2]),
        kind: match[3] as DownloadKind,
        session: extractSessionFromText(match[4]),
        source: inferSource(rel),
        relativePath: normalizeRelativePath(rel),
        absolutePath: fullPath,
        fileName: basename(fullPath),
      });
    }
  };

  walk(DOWNLOADS_DIR);
  return records;
}

function loadManifest(): HackClubManifest {
  if (!existsSync(MANIFEST_PATH)) {
    return {
      generatedAt: new Date().toISOString(),
      records: [],
    };
  }

  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as HackClubManifest;
}

function persistManifest(manifest: HackClubManifest) {
  manifest.generatedAt = new Date().toISOString();
  mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

async function uploadFile(record: AssetUploadRecord): Promise<HackClubManifestRecord> {
  if (!HACKCLUB_CDN_API_KEY) {
    throw new Error("Missing HACKCLUB_CDN_API_KEY in environment");
  }

  const fileBuffer = readFileSync(record.absolutePath);
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: "application/pdf" });
  formData.append("file", blob, record.fileName);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= UPLOAD_RETRIES; attempt += 1) {
    try {
      const response = await fetch("https://cdn.hackclub.com/api/v4/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HACKCLUB_CDN_API_KEY}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Hack Club CDN upload failed (${response.status}): ${errorText}`);
      }

      const payload = (await response.json()) as {
        id: string;
        size: number;
        content_type: string;
        url: string;
        created_at: string;
      };

      return {
        ...record,
        uploadId: payload.id,
        url: payload.url,
        size: payload.size,
        contentType: payload.content_type,
        uploadedAt: payload.created_at,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < UPLOAD_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError ?? new Error("Hack Club CDN upload failed for unknown reason");
}

async function upsertConvexMetadata(client: ConvexHttpClient, record: HackClubManifestRecord) {
  const untypedClient = client as unknown as {
    mutation: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  };

  await untypedClient.mutation("paperAssets:upsertPaperAsset", {
    boardCode: record.boardCode,
    subjectSlug: record.subjectSlug,
    tier: record.tier,
    year: record.year,
    session: record.session,
    paperCode: record.paperCode,
    paperName: record.paperName,
    kind: record.kind,
    source: record.source,
    relativePath: record.relativePath,
    fileName: record.fileName,
    cdnUploadId: record.uploadId,
    cdnUrl: record.url,
    fileSize: record.size,
    contentType: record.contentType,
    uploadedAt: Date.parse(record.uploadedAt) || Date.now(),
  });
}

async function main() {
  if (!CONVEX_URL) {
    throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL in environment");
  }

  const manifest = loadManifest();
  const uploadedByRelativePath = new Map(
    manifest.records.map((record) => [normalizeRelativePath(record.relativePath), record]),
  );
  const convexClient = new ConvexHttpClient(CONVEX_URL);

  let records = scanDownloadFiles();
  records = records
    .filter((record) => (TARGET_BOARD_CODE ? record.boardCode === TARGET_BOARD_CODE : true))
    .filter((record) => (TARGET_SUBJECT_SLUG ? record.subjectSlug === TARGET_SUBJECT_SLUG : true))
    .filter((record) => (TARGET_TIER ? record.tier === TARGET_TIER : true))
    .filter((record) => (TARGET_SOURCE ? record.source === TARGET_SOURCE : true))
    .slice(0, MAX_FILES);

  console.log(`Uploading ${records.length} files to Hack Club CDN`);

  let nextIndex = 0;
  let uploadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= records.length) {
        return;
      }

      const record = records[currentIndex];
      const existing = uploadedByRelativePath.get(record.relativePath);
      console.log(`[${currentIndex + 1}/${records.length}] ${record.relativePath}`);

      if (existing) {
        await upsertConvexMetadata(convexClient, existing);
        skippedCount += 1;
        console.log("  skipped");
        continue;
      }

      try {
        const uploaded = await uploadFile(record);
        manifest.records.push(uploaded);
        uploadedByRelativePath.set(record.relativePath, uploaded);
        await upsertConvexMetadata(convexClient, uploaded);
        persistManifest(manifest);
        uploadedCount += 1;
        console.log(`  uploaded: ${uploaded.url}`);
      } catch (error) {
        failedCount += 1;
        console.error(`  failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(UPLOAD_CONCURRENCY, records.length || 1)) }, () => worker()),
  );

  persistManifest(manifest);
  console.log(
    `Upload complete. Uploaded ${uploadedCount}, skipped ${skippedCount}, failed ${failedCount}. Manifest written to ${MANIFEST_PATH}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
