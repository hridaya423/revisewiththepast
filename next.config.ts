import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/paper-maker/generate": ["./data/extracted/**/paper.json"],
    "/api/paper-maker/subject-detail": ["./data/extracted/**/paper.json"],
  },
};

export default nextConfig;
