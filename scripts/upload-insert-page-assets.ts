import "dotenv/config";

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

type ManifestRecord = {
  sourceRelativePath: string;
  pageNumber: number;
  relativePath?: string;
  fileName: string;
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

const TARGET_BOARD_CODE = process.env.TARGET_BOARD_CODE;
const TARGET_SUBJECT_SLUG = process.env.TARGET_SUBJECT_SLUG;
const HACKCLUB_CDN_API_KEY = process.env.HACKCLUB_CDN_API_KEY;
const CONVEX_URL = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
const MANIFEST_PATH = resolve(process.cwd(), "data/insert-page-cdn-manifest.json");
const TEMP_DIR = "/var/folders/w9/p_fpb3_x05n45_bt9_3wp5hw0000gn/T/opencode/insert-page-split";

function deriveSourceRelativePath(filePath: string) {
  const normalized = filePath.replaceAll("\\", "/");
  const marker = "/data/downloads/";
  const index = normalized.indexOf(marker);
  return index >= 0 ? normalized.slice(index + marker.length) : basename(normalized);
}

function loadManifest(): Manifest {
  if (!existsSync(MANIFEST_PATH)) {
    return { generatedAt: new Date().toISOString(), records: [] };
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

function persistManifest(manifest: Manifest) {
  manifest.generatedAt = new Date().toISOString();
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

async function uploadPage(filePath: string, fileName: string) {
  if (!HACKCLUB_CDN_API_KEY) throw new Error("Missing HACKCLUB_CDN_API_KEY");
  const formData = new FormData();
  const buffer = readFileSync(filePath);
  const blob = new Blob([buffer], { type: "application/pdf" });
  formData.append("file", blob, fileName);

  const response = await fetch("https://cdn.hackclub.com/api/v4/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${HACKCLUB_CDN_API_KEY}` },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Hack Club CDN upload failed (${response.status}): ${await response.text()}`);
  }

  return await response.json() as {
    id: string;
    size: number;
    content_type: string;
    url: string;
    created_at: string;
  };
}

function getPdfPageCount(filePath: string) {
  const output = execFileSync("/bin/sh", ["-lc", `qpdf --show-npages \"${filePath}\" 2>/dev/null || true`], { encoding: "utf8" }).trim();
  const pageCount = Number(output);
  if (!Number.isFinite(pageCount) || pageCount <= 0) {
    throw new Error(`Unable to determine page count for ${filePath}`);
  }
  return pageCount;
}

function splitPdfPage(inputPath: string, pageNumber: number, outputPath: string) {
  execFileSync("/bin/sh", ["-lc", `qpdf --empty --pages \"${inputPath}\" ${pageNumber} -- \"${outputPath}\" 2>/dev/null || true`]);
  if (!existsSync(outputPath)) {
    throw new Error(`Failed to split page ${pageNumber} from ${inputPath}`);
  }
}

function buildInsertPageRelativePath(sourceRelativePath: string, pageNumber: number) {
  return `data/insert-page-assets/${sourceRelativePath.replaceAll("/", "__")}-page-${String(pageNumber).padStart(3, "0")}.pdf`;
}

async function main() {
  if (!TARGET_BOARD_CODE || !TARGET_SUBJECT_SLUG) {
    throw new Error("Set TARGET_BOARD_CODE and TARGET_SUBJECT_SLUG");
  }
  if (!CONVEX_URL) {
    throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL");
  }

  const convexClient = new ConvexHttpClient(CONVEX_URL);
  const downloadsDir = resolve(process.cwd(), "data/downloads", TARGET_BOARD_CODE, TARGET_SUBJECT_SLUG, "none");
  const fileNames = readdirSync(downloadsDir)
    .filter((fileName) => fileName.toLowerCase().endsWith(".pdf"))
    .filter((fileName) => fileName.toLowerCase().includes("insert"))
    .sort((a, b) => a.localeCompare(b));

  const manifest = loadManifest();
  const existingByKey = new Map(manifest.records.map((record) => [`${record.sourceRelativePath}::${record.pageNumber}`, record]));
  mkdirSync(TEMP_DIR, { recursive: true });

  for (const fileName of fileNames) {
    const absolutePath = resolve(downloadsDir, fileName);
    const sourceRelativePath = deriveSourceRelativePath(absolutePath);
    const pageCount = getPdfPageCount(absolutePath);
    console.log(`${fileName}: ${pageCount} pages`);

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const existing = existingByKey.get(`${sourceRelativePath}::${pageNumber}`);
      if (existing) {
        const relativePath = existing.relativePath ?? buildInsertPageRelativePath(existing.sourceRelativePath, existing.pageNumber);
        await convexClient.mutation(api.insertPageAssets.upsertInsertPageAsset, {
          sourceRelativePath: existing.sourceRelativePath,
          pageNumber: existing.pageNumber,
          relativePath,
          fileName: existing.fileName,
          cdnUploadId: existing.uploadId,
          cdnUrl: existing.url,
          fileSize: existing.size,
          contentType: existing.contentType,
          uploadedAt: Date.parse(existing.uploadedAt) || Date.now(),
        });
        console.log(`  [${pageNumber}/${pageCount}] skipped`);
        continue;
      }

      const splitPath = resolve(TEMP_DIR, `${Buffer.from(sourceRelativePath).toString("base64url")}-page-${String(pageNumber).padStart(3, "0")}.pdf`);
      execFileSync("/bin/sh", ["-lc", `rm -f \"${splitPath}\"`]);
      splitPdfPage(absolutePath, pageNumber, splitPath);

      const upload = await uploadPage(splitPath, `page-${String(pageNumber).padStart(3, "0")}.pdf`);
      const relativePath = buildInsertPageRelativePath(sourceRelativePath, pageNumber);
      const record: ManifestRecord = {
        sourceRelativePath,
        pageNumber,
        relativePath,
        fileName: basename(splitPath),
        uploadId: upload.id,
        url: upload.url,
        size: upload.size,
        contentType: upload.content_type,
        uploadedAt: upload.created_at,
      };
      manifest.records.push(record);
      existingByKey.set(`${sourceRelativePath}::${pageNumber}`, record);
      await convexClient.mutation(api.insertPageAssets.upsertInsertPageAsset, {
        sourceRelativePath,
        pageNumber,
        relativePath,
        fileName: record.fileName,
        cdnUploadId: upload.id,
        cdnUrl: upload.url,
        fileSize: upload.size,
        contentType: upload.content_type,
        uploadedAt: Date.parse(upload.created_at) || Date.now(),
      });
      persistManifest(manifest);
      console.log(`  [${pageNumber}/${pageCount}] uploaded ${upload.url}`);
    }
  }

  persistManifest(manifest);
  console.log(`Done. Wrote ${manifest.records.length} records to ${MANIFEST_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
