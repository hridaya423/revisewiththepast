import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ConvexHttpClient } from "convex/browser";
import { config as loadEnv } from "dotenv";

import { api } from "../convex/_generated/api";
import { PAPER_MAKER_SUBJECTS } from "../shared/domain/subject-catalog";
import { getFirstEnvironment, getNumberEnvironment, getOptionalEnvironment } from "./runtime";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: false, quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env"), override: false, quiet: true });

const CONVEX_URL = getFirstEnvironment("CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL");
const RUNS = Math.max(1, getNumberEnvironment("BENCH_RUNS", 5));
const SUBJECT_FILTER = getOptionalEnvironment("BENCH_SUBJECTS")?.split(",").map((key) => key.trim()).filter(Boolean);

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function timed<T>(fn: () => Promise<T>) {
  const startedAt = performance.now();
  const result = await fn();
  return { durationMs: performance.now() - startedAt, result };
}

async function main() {
  if (!CONVEX_URL) throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL.");
  const serviceSecret = process.env.MCP_SERVICE_SECRET ?? "";
  if (!serviceSecret) throw new Error("Missing MCP_SERVICE_SECRET.");

  const client = new ConvexHttpClient(CONVEX_URL);

  const subjects = PAPER_MAKER_SUBJECTS.filter((subject) => subject.generationEnabled)
    .map((subject) => ({ key: subject.key, boardCode: subject.boardCode, subjectSlug: subject.subjectSlug }))
    .filter((subject) => !SUBJECT_FILTER || SUBJECT_FILTER.includes(subject.key));

  const report: Record<string, unknown> = {
    runs: RUNS,
    measuredAt: new Date().toISOString(),
    subjects: {} as Record<string, unknown>,
  };
  const subjectReports = report.subjects as Record<string, unknown>;

  for (const subject of subjects) {
    const args = { serviceSecret, boardCode: subject.boardCode, subjectSlug: subject.subjectSlug };

    // Warm up so the first read isn't measured cold.
    await client.query(api.questionTags.getQuestionBankSnapshot, args);

    const snapshotDurations: number[] = [];
    const buildDurations: number[] = [];
    let snapshotPartCount = 0;
    let buildPartCount = 0;
    let snapshotPayloadBytes = 0;
    let buildPayloadBytes = 0;

    for (let run = 0; run < RUNS; run += 1) {
      const snapshot = await timed(() => client.query(api.questionTags.getQuestionBankSnapshot, args));
      snapshotDurations.push(snapshot.durationMs);
      if (snapshot.result) {
        snapshotPartCount = snapshot.result.questionPartCount;
        snapshotPayloadBytes = JSON.stringify(snapshot.result.questionParts).length;
      }

      const built = await timed(() => client.query(api.questionTags.getPaperMakerQuestionBank, args));
      buildDurations.push(built.durationMs);
      buildPartCount = built.result.questionPartCount;
      buildPayloadBytes = JSON.stringify(built.result.questionParts).length;
    }

    const sortedSnapshot = [...snapshotDurations].sort((a, b) => a - b);
    const sortedBuild = [...buildDurations].sort((a, b) => a - b);
    const snapshotP50 = percentile(sortedSnapshot, 50);
    const buildP50 = percentile(sortedBuild, 50);

    subjectReports[subject.key] = {
      questionPartCount: buildPartCount,
      snapshotMatchesBuildPartCount: snapshotPartCount === buildPartCount,
      fullBuild: { durationMs: { p50: buildP50, p95: percentile(sortedBuild, 95) }, payloadBytes: buildPayloadBytes },
      snapshotRead: { durationMs: { p50: snapshotP50, p95: percentile(sortedSnapshot, 95) }, payloadBytes: snapshotPayloadBytes },
      p50ImprovementPct: buildP50 && snapshotP50 ? Math.round((1 - snapshotP50 / buildP50) * 1000) / 10 : null,
    };

    console.log(`  ${subject.key}: build p50=${buildP50?.toFixed(0)}ms vs snapshot p50=${snapshotP50?.toFixed(0)}ms (${buildPayloadBytes} bytes)`);
  }

  const outDir = resolve(process.cwd(), "plans/baseline");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "question-bank.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
