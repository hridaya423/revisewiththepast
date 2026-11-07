import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

const BASE_URL = (process.env.BENCH_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ROUTES = (process.env.AXE_ROUTES ?? "/,/paper-maker,/marking").split(",").map((route) => route.trim());
const AXE_PATH = resolve(process.cwd(), "node_modules/axe-core/axe.min.js");
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];

async function main() {
  const browser = await chromium.launch({ channel: "chrome" });
  const report: Record<string, unknown> = {
    baseUrl: BASE_URL,
    measuredAt: new Date().toISOString(),
    routes: {} as Record<string, unknown>,
  };
  const routes = report.routes as Record<string, unknown>;

  for (const route of ROUTES) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      const errors: string[] = [];
      try {
        await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle", timeout: 60_000 });
        await page.addScriptTag({ path: AXE_PATH });
        const results = await page.evaluate(async () => {
          type AxeViolation = { id: string; impact: string | null; description: string; nodes: Array<{ target: string[] }> };
          const axe = (window as unknown as { axe: { run: (opts: unknown) => Promise<{ violations: AxeViolation[] }> } }).axe;
          return await axe.run({ resultTypes: ["violations"] });
        });
        const key = `${route}@${viewport.name}`;
        routes[key] = {
          status: "ok",
          violationCount: results.violations.length,
          violations: results.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            description: violation.description,
            nodeCount: violation.nodes.length,
            targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
          })),
        };
        console.log(`  ${key}: ${results.violations.length} violation(s)`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        routes[`${route}@${viewport.name}`] = { status: "error", errors };
        console.log(`  ${route}@${viewport.name}: error — ${errors[errors.length - 1]}`);
      }
      await context.close();
    }
  }

  await browser.close();
  const outDir = resolve(process.cwd(), "plans/baseline");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "axe.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
