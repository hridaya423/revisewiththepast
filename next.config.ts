import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    lockDistDir: false,
  },
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/paper-maker/generate": ["./data/extracted-lite/**/paper.json.gz"],
    "/api/paper-maker/subject-detail": ["./data/extracted-lite/**/paper.json.gz"],
  },
};

export default nextConfig;
