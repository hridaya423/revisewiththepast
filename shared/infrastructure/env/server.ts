import "server-only";

import { z } from "zod";

const serverEnvironmentSchema = z.object({
  CONVEX_URL: z.string().url().optional(),
  NEXT_PUBLIC_CONVEX_URL: z.string().url().optional(),
  NEXT_PUBLIC_CONVEX_SITE_URL: z.string().url().optional(),
  SITE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  VERCEL_URL: z.string().trim().min(1).optional(),
  BETTER_AUTH_BASE_PATH: z.string().default("/api/auth"),
  HACKCLUB_CDN_API_KEY: z.string().optional(),
  HACKCLUB_AI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("google/gemini-3.1-flash-lite"),
  HANDWRITTEN_OCR_VERSION: z.string().optional(),
  PAPER_MAKER_REGION_MODE: z.enum(["auto", "legacy"]).default("auto"),
  PAPER_MAKER_LOCAL_GEOMETRY: z.string().optional(),
  LOCAL_GEOMETRY_DEBUG: z.string().optional(),
  MCP_SERVICE_SECRET: z.string().min(32).optional(),
  MCP_ALLOWED_HOSTS: z.string().optional(),
  MCP_ARTIFACT_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
});

let cachedEnvironment: z.infer<typeof serverEnvironmentSchema> | null = null;

export function getServerEnvironment() {
  if (cachedEnvironment) return cachedEnvironment;
  const parsed = serverEnvironmentSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid server environment: ${parsed.error.message}`);
  }
  cachedEnvironment = parsed.data;
  return cachedEnvironment;
}

export function getConvexUrl() {
  const environment = getServerEnvironment();
  const url = environment.CONVEX_URL ?? environment.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL");
  return url;
}
