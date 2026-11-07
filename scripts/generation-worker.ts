import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { processNextGenerationJob } = await import("../features/papers/builder/infrastructure/jobs/generation-jobs");
  if (process.argv.includes("--check")) {
    if (typeof processNextGenerationJob !== "function") throw new Error("The generation worker module could not be loaded.");
    console.log("Generation worker runtime is ready.");
    return;
  }
  const workerId = randomUUID();
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  console.log("Generation worker ready.");
  while (!stopping) {
    try {
      if (!await processNextGenerationJob(workerId)) await setTimeout(2000);
    } catch (error) {
      console.error("Generation worker could not reach its queue.", { errorType: error instanceof Error ? error.name : "Unknown" });
      await setTimeout(10_000);
    }
  }
}

void main().catch((error) => {
  console.error("Generation worker could not start.", { errorType: error instanceof Error ? error.name : "Unknown" });
  process.exitCode = 1;
});
