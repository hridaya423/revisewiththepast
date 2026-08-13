import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Trace = { files?: unknown };
type AppPaths = Record<string, string>;
type PrerenderManifest = { routes?: Record<string, unknown> };

const functionLimit = 12;
const appPaths = JSON.parse(readFileSync(resolve(process.cwd(), ".next/server/app-paths-manifest.json"), "utf8")) as AppPaths;
const prerendered = JSON.parse(readFileSync(resolve(process.cwd(), ".next/prerender-manifest.json"), "utf8")) as PrerenderManifest;
const prerenderedRoutes = new Set(Object.keys(prerendered.routes ?? {}));
const dynamicRoutes = Object.keys(appPaths)
  .map((route) => route.replace(/\/(?:page|route)$/, "") || "/")
  .filter((route) => !prerenderedRoutes.has(route));

if (dynamicRoutes.length > functionLimit) {
  throw new Error(`Build emits ${dynamicRoutes.length} dynamic entries, exceeding Vercel Hobby's ${functionLimit}-function limit:\n${dynamicRoutes.join("\n")}`);
}

console.log(`${dynamicRoutes.length}/${functionLimit} Vercel Hobby function budget used`);

const tracePaths = [
  ".next/server/app/mcp/route.js.nft.json",
  ".next/server/app/api/paper-maker/[[...path]]/route.js.nft.json",
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
