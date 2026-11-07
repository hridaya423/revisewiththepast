import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import { decideBlindReviewGate } from "./qa-blind-review";

const pairSchema = z.object({
  pairId: z.string(),
  artifact: z.enum(["question-paper", "mark-scheme"]),
  generatedPage: z.number().int().positive(),
  referencePage: z.number().int().positive(),
  reviewMode: z.enum(["blind", "visual"]),
  status: z.enum(["pending", "pass", "fail"]),
});

const manifestSchema = z.object({
  entries: z.array(z.object({ blindPairs: z.array(pairSchema) })),
});

const runIndex = process.argv.indexOf("--run");
const run = runIndex >= 0 ? process.argv[runIndex + 1] : undefined;
if (!run) throw new Error("Usage: npm run papers:qa-review -- --run <qa-run-dir>");

const manifestPath = resolve(process.cwd(), run, "bar-sheets/blind/manifest.json");
const manifest = manifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
const gate = decideBlindReviewGate(manifest.entries.flatMap((entry) => entry.blindPairs));
if (!gate.ok) {
  console.error(gate.failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Visual review passed: ${manifestPath}`);
}
