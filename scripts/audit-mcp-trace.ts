import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Trace = { files?: unknown };

const tracePaths = [
  ".next/server/app/mcp/route.js.nft.json",
  ".next/server/app/api/paper-maker/generate/route.js.nft.json",
  ".next/server/app/api/paper-maker/subject-detail/route.js.nft.json",
];

const forbiddenPatterns = [
  /(^|\/)\.env(?:$|[./])/,
  /(^|\/)\.git(?:\/|$)/,
  /(^|\/)\.claude(?:\/|$)/,
  /(^|\/)data\/(?:downloads|extracted|extracted__hidden|tagger-debug)(?:\/|$)/,
  /(^|\/)qa-reports(?:\/|$)/,
  /(^|\/)qa-[^/]+(?:\/|$)/,
  /(^|\/)scripts\/qa-[^/]+(?:\/|$)/,
];

for (const relativePath of tracePaths) {
  const tracePath = resolve(process.cwd(), relativePath);
  if (!existsSync(tracePath)) throw new Error(`Missing output trace: ${relativePath}`);

  const trace = JSON.parse(readFileSync(tracePath, "utf8")) as Trace;
  const files = Array.isArray(trace.files) ? trace.files.filter((file): file is string => typeof file === "string") : [];
  const forbidden = files.filter((file) => forbiddenPatterns.some((pattern) => pattern.test(file.replaceAll("\\", "/"))));
  if (forbidden.length > 0) {
    throw new Error(`${relativePath} contains forbidden traced files:\n${forbidden.slice(0, 20).join("\n")}`);
  }

  if (!files.some((file) => /(^|\/)data\/extracted-lite\/.*paper\.json\.gz$/.test(file.replaceAll("\\", "/")))) {
    throw new Error(`${relativePath} does not include the extracted-lite paper data required at runtime.`);
  }

  console.log(`${relativePath}: ${files.length} files, no sensitive or excluded paths`);
}
