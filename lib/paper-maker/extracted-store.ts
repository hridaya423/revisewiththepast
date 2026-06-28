import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

function deriveExtractedPath(sourceRelativePath: string, root: string, fileName: string) {
  const normalizedPath = sourceRelativePath.replaceAll("\\", "/");
  const segments = normalizedPath.split("/").filter(Boolean);
  const boardCode = segments[0] ?? "";
  const subjectSlug = segments[1] ?? "";
  const extraDirs = segments.slice(2, -1).filter((segment) => segment !== "none");
  const paperDirName = (segments.at(-1) ?? normalizedPath).replace(/\.pdf$/i, "");
  return resolve(process.cwd(), root, boardCode, subjectSlug, ...extraDirs, paperDirName, fileName);
}

export function readExtractedPaperJson<T = unknown>(sourceRelativePath: string): T | null {
  const litePath = deriveExtractedPath(sourceRelativePath, "data/extracted-lite", "paper.json.gz");
  if (existsSync(litePath)) {
    try {
      return JSON.parse(gunzipSync(readFileSync(litePath)).toString("utf8")) as T;
    } catch {
      return null;
    }
  }

  const fullPath = deriveExtractedPath(sourceRelativePath, "data/extracted", "paper.json");
  if (existsSync(fullPath)) {
    try {
      return JSON.parse(readFileSync(fullPath, "utf8")) as T;
    } catch {
      return null;
    }
  }

  return null;
}
