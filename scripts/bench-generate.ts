import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { PAPER_MAKER_SUBJECTS } from "../shared/domain/subject-catalog";

const BASE_URL = (process.env.BENCH_URL ?? "http://localhost:3000").replace(/\/$/, "");
const RUNS_PER_SUBJECT = Math.max(1, Number(process.env.BENCH_RUNS ?? 10));
const SUBJECT_FILTER = process.env.BENCH_SUBJECTS?.split(",").map((key) => key.trim()).filter(Boolean);

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function timeGeneration(subjectKey: string, subjectTier?: string) {
  const startedAt = performance.now();
  const response = await fetch(`${BASE_URL}/api/paper-maker/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subjectKey, selectAllTopics: true, ...(subjectTier ? { subjectTier } : {}) }),
  });
  const bytes = (await response.arrayBuffer()).byteLength;
  const durationMs = performance.now() - startedAt;
  return { ok: response.ok, status: response.status, durationMs, bytes };
}

async function main() {
  const subjects = PAPER_MAKER_SUBJECTS.filter((subject) => subject.generationEnabled)
    .map((subject) => ({ key: subject.key, subjectTier: subject.tiers[0]?.key }))
    .filter((subject) => !SUBJECT_FILTER || SUBJECT_FILTER.includes(subject.key));

  console.log(`Benchmarking ${subjects.length} subject(s) x ${RUNS_PER_SUBJECT} run(s) against ${BASE_URL}`);

  const report: Record<string, unknown> = {
    baseUrl: BASE_URL,
    runsPerSubject: RUNS_PER_SUBJECT,
    measuredAt: new Date().toISOString(),
    subjects: {} as Record<string, unknown>,
  };
  const subjectReports = report.subjects as Record<string, unknown>;

  for (const { key: subjectKey, subjectTier } of subjects) {
    const durations: number[] = [];
    const sizes: number[] = [];
    const failures: Array<{ status: number }> = [];

    for (let run = 0; run < RUNS_PER_SUBJECT; run += 1) {
      try {
        const result = await timeGeneration(subjectKey, subjectTier);
        if (result.ok) {
          durations.push(result.durationMs);
          sizes.push(result.bytes);
        } else {
          failures.push({ status: result.status });
        }
      } catch (error) {
        failures.push({ status: -1 });
        console.error(`  ${subjectKey} run ${run + 1}: request failed — ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const sortedDurations = [...durations].sort((a, b) => a - b);
    const sortedSizes = [...sizes].sort((a, b) => a - b);
    subjectReports[subjectKey] = {
      runs: durations.length,
      failures: failures.length,
      failureStatuses: failures,
      durationMs: {
        p50: percentile(sortedDurations, 50),
        p95: percentile(sortedDurations, 95),
        min: sortedDurations[0] ?? null,
        max: sortedDurations[sortedDurations.length - 1] ?? null,
      },
      pdfBytes: {
        p50: percentile(sortedSizes, 50),
        min: sortedSizes[0] ?? null,
        max: sortedSizes[sortedSizes.length - 1] ?? null,
      },
    };

    const duration = subjectReports[subjectKey] as { durationMs: { p50: number | null; p95: number | null } };
    console.log(`  ${subjectKey}: ${durations.length}/${RUNS_PER_SUBJECT} ok, p50=${duration.durationMs.p50?.toFixed(0) ?? "-"}ms p95=${duration.durationMs.p95?.toFixed(0) ?? "-"}ms${failures.length ? ` (${failures.length} failures)` : ""}`);
  }

  const outDir = resolve(process.cwd(), "plans/baseline");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, process.env.BENCH_OUT ?? "generate.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
