import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("Clean expired MCP artifacts", { minutes: 15 }, internal.mcpArtifacts.cleanupExpired);
crons.interval("Clean old MCP rate windows", { hours: 1 }, internal.mcpRateLimits.cleanupOldWindows);

export default crons;
