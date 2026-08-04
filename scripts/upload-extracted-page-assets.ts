import "dotenv/config";

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { getFirstEnvironment, getNumberEnvironment, getOptionalEnvironment, readJsonFile, retryWithBackoff, writeJsonFile } from "./runtime";

type ExtractedAsset = {
  asset_id: string;
  kind: "page_pdf";
  page_number: number;
  bbox: null;
  file_path: string;
  description: string;
};

type ExtractedPaper = {
  source_file: string;
  board_code: string;
  subject_slug: string;
  assets: ExtractedAsset[];
};

type PageAssetRecord = {
  sourceRelativePath: string;
  assetId: string;
  pageNumber: number;
  relativePath: string;
  absolutePath: string;
  fileName: string;
};

type ManifestRecord = PageAssetRecord & {
  uploadId: string;
  url: string;
  size: number;
  contentType: string;
  uploadedAt: string;
};

type Manifest = {
  generatedAt: string;
  records: ManifestRecord[];
};

const EXTRACTED_DIR = resolve(process.cwd(), "data/extracted");
const MANIFEST_PATH = resolve(process.cwd(), "data/question-page-cdn-manifest.json");
const TARGET_BOARD_CODE = getOptionalEnvironment("TARGET_BOARD_CODE");
const TARGET_SUBJECT_SLUG = getOptionalEnvironment("TARGET_SUBJECT_SLUG");
const MAX_FILES = getNumberEnvironment("MAX_FILES", Number.MAX_SAFE_INTEGER, { min: 1 });
const UPLOAD_CONCURRENCY = getNumberEnvironment("UPLOAD_CONCURRENCY", 20, { min: 1 });
const UPLOAD_RETRIES = getNumberEnvironment("UPLOAD_RETRIES", 3, { min: 1 });
const RETRY_DELAY_MS = getNumberEnvironment("RETRY_DELAY_MS", 1500, { min: 0 });
const HACKCLUB_CDN_API_KEY = getOptionalEnvironment("HACKCLUB_CDN_API_KEY");
const CONVEX_URL = getFirstEnvironment("CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL");

function deriveSourceRelativePath(sourceFile: string) {
  const normalized = sourceFile.replaceAll("\\", "/");
  const marker = "/data/downloads/";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + marker.length);
  }
  return basename(normalized);
}

function collectPaperJsonPaths(dir: string, output: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) collectPaperJsonPaths(fullPath, output);
    else if (entry.isFile() && entry.name === "paper.json") output.push(fullPath);
  }
}

function scanExtractedPageAssets() {
  const paperJsonPaths: string[] = [];
  collectPaperJsonPaths(EXTRACTED_DIR, paperJsonPaths);

  const records: PageAssetRecord[] = [];
  for (const paperJsonPath of paperJsonPaths) {
    const paper = JSON.parse(readFileSync(paperJsonPath, "utf8")) as ExtractedPaper;
    if (TARGET_BOARD_CODE && paper.board_code !== TARGET_BOARD_CODE) continue;
    if (TARGET_SUBJECT_SLUG && paper.subject_slug !== TARGET_SUBJECT_SLUG) continue;

    const sourceRelativePath = deriveSourceRelativePath(paper.source_file);
    for (const asset of paper.assets) {
      const normalizedAssetPath = asset.file_path.replaceAll("\\", "/");
      if (!normalizedAssetPath.includes("/data/extracted/")) continue;
      if (!existsSync(asset.file_path)) continue;

      records.push({
        sourceRelativePath,
        assetId: asset.asset_id,
        pageNumber: asset.page_number,
        relativePath: relative(process.cwd(), asset.file_path).replaceAll("\\", "/"),
        absolutePath: asset.file_path,
        fileName: basename(asset.file_path),
      });
    }
  }

  return records.slice(0, MAX_FILES);
}

function loadManifest(): Manifest {
  return readJsonFile<Manifest>(MANIFEST_PATH, { generatedAt: new Date().toISOString(), records: [] });
}

function persistManifest(manifest: Manifest) {
  manifest.generatedAt = new Date().toISOString();
  writeJsonFile(MANIFEST_PATH, manifest);
}

async function uploadFile(record: PageAssetRecord): Promise<ManifestRecord> {
  if (!HACKCLUB_CDN_API_KEY) throw new Error("Missing HACKCLUB_CDN_API_KEY");

  const fileBuffer = readFileSync(record.absolutePath);
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: "application/pdf" });
  formData.append("file", blob, record.fileName);

  return retryWithBackoff(async () => {
      const response = await fetch("https://cdn.hackclub.com/api/v4/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${HACKCLUB_CDN_API_KEY}` },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Hack Club CDN upload failed (${response.status}): ${await response.text()}`);
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
    }, { retries: UPLOAD_RETRIES, baseDelayMs: RETRY_DELAY_MS });
}

async function upsertConvexMetadata(client: ConvexHttpClient, record: ManifestRecord) {
  await client.mutation(api.questionPageAssets.upsertQuestionPageAsset, {
    sourceRelativePath: record.sourceRelativePath,
    assetId: record.assetId,
    pageNumber: record.pageNumber,
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
  if (!CONVEX_URL) throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL");

  const manifest = loadManifest();
  const uploadedByRelativePath = new Map(manifest.records.map((record) => [record.relativePath, record]));
  const convexClient = new ConvexHttpClient(CONVEX_URL);
  const records = scanExtractedPageAssets();

  console.log(`Uploading ${records.length} extracted page assets to Hack Club CDN`);

  let nextIndex = 0;
  let uploadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= records.length) return;

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

  await Promise.all(Array.from({ length: Math.max(1, Math.min(UPLOAD_CONCURRENCY, records.length || 1)) }, () => worker()));
  persistManifest(manifest);
  console.log(`Upload complete. Uploaded ${uploadedCount}, skipped ${skippedCount}, failed ${failedCount}. Manifest written to ${MANIFEST_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
