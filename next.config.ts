import type { NextConfig } from "next";

const paperMakerRoutes = [
  "/api/paper-maker/**",
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
    "/api/paper-maker/**": ["./data/extracted-lite/**/paper.json.gz"],
    "/mcp": ["./data/extracted-lite/**/paper.json.gz"],
  },
};

export default nextConfig;
