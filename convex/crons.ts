import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("Clean expired MCP artifacts", { minutes: 15 }, internal.mcpArtifacts.cleanupExpired);
crons.interval("Clean old MCP rate windows", { hours: 1 }, internal.mcpRateLimits.cleanupOldWindows);
crons.interval("Clean expired generation jobs", { hours: 1 }, internal.generationJobs.cleanup);
crons.interval("Recover stale shadow-paper jobs", { minutes: 5 }, internal.shadowPapers.recoverStaleJobs);
crons.interval("Clean expired shadow-paper variants", { hours: 1 }, internal.shadowPapers.cleanupExpiredVariants);

export default crons;
