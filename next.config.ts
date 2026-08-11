import type { NextConfig } from "next";

const paperMakerRoutes = [
  "/api/paper-maker/generate",
  "/api/paper-maker/subject-detail",
  "/mcp",
];

const serverTraceExcludes = [
  "./.git/**/*",
  "./.claude/**/*",
  "./.env*",
  "./data/downloads/**/*",
  "./data/extracted/**/*",
  "./data/extracted__hidden/**/*",
  "./data/tagger-debug/**/*",
  "./qa-reports/**/*",
  "./qa-*/**/*",
  "./scripts/qa-*",
];

const nextConfig: NextConfig = {
  experimental: {
    lockDistDir: false,
    viewTransition: true,
  },
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  outputFileTracingExcludes: Object.fromEntries(
    paperMakerRoutes.map((route) => [route, serverTraceExcludes]),
  ),
  outputFileTracingIncludes: {
    "/api/paper-maker/generate": ["./data/extracted-lite/**/paper.json.gz"],
    "/api/paper-maker/subject-detail": ["./data/extracted-lite/**/paper.json.gz"],
    "/mcp": ["./data/extracted-lite/**/paper.json.gz"],
  },
};

export default nextConfig;
