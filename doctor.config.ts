const doctorConfig = {
  ignore: {
    overrides: [
      {
        files: ["app/_components/landing-motion.tsx"],
        rules: ["react-doctor/effect-needs-cleanup"],
      },
      {
        files: ["app/marking/start/[savedPaperId]/page.tsx"],
        rules: ["react-doctor/nextjs-no-client-side-redirect"],
      },
      {
        files: [
          "app/_components/marking-submission-workspace.tsx",
          "convex/mcpArtifacts.ts",
          "convex/mcpRateLimits.ts",
          "convex/paperRegions.ts",
          "convex/questionPageAssets.ts",
          "convex/questionTags.ts",
          "convex/savedPapers.ts",
          "features/papers/builder/infrastructure/pdf/pdf.ts",
          "features/papers/builder/infrastructure/qa/validate.ts",
          "features/papers/builder/presentation/download-mark-schemes.ts",
          "features/papers/infrastructure/pdfjs-server.ts",
          "features/papers/marking/application/ocr.ts",
          "features/papers/marking/application/scoring.ts",
          "features/papers/marking/infrastructure/import/answer-ocr.ts",
          "features/papers/marking/infrastructure/import/import-pipeline.ts",
          "features/papers/marking/infrastructure/mark-scheme/mark-scheme.ts",
        ],
        rules: ["react-doctor/async-await-in-loop"],
      },
    ],
  },
};

export default doctorConfig;
