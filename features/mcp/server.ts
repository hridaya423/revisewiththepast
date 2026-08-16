import "server-only";

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

import { normalizeApplicationError, RateLimitError } from "@/shared/application/errors";

import {
  generatePaperBundleInputSchema,
  listSubjectsOutputSchema,
  paperBundleOutputSchema,
  subjectCatalogInputSchema,
  subjectCatalogOutputSchema,
} from "./contracts";
import {
  formatSubjectCatalogForTool,
  formatSubjectsForTool,
  generatePaperBundle,
  getGenerationSubjectCatalog,
  listGenerationSubjects,
  paperBundleContent,
} from "./paper-bundle";

function toolError(error: unknown, fallback: string) {
  const normalized = normalizeApplicationError(error, fallback);
  const retry = normalized instanceof RateLimitError
    ? ` Retry after ${new Date(normalized.retryAt).toISOString()}.`
    : "";
  return {
    content: [{ type: "text" as const, text: `${normalized.message}${retry}` }],
    isError: true as const,
  };
}

function traceTool<T>(toolName: string, run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  return run().then(
    (result) => {
      console.info("MCP tool call", {
        tool: toolName,
        durationMs: Date.now() - startedAt,
        isError: (result as { isError?: boolean } | null)?.isError === true,
      });
      return result;
    },
    (error) => {
      console.error("MCP tool call failed", {
        tool: toolName,
        durationMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    },
  );
}

export function createPaperMakerMcpServer() {
  const server = new McpServer({
    name: "gcse-paper-maker",
    version: "1.0.0",
  });

  server.registerTool(
    "list_subjects",
    {
      title: "List GCSE paper subjects",
      description: "List every GCSE subject currently enabled for generated paper PDFs, including valid tiers and paper codes. Call this before choosing a subject.",
      outputSchema: listSubjectsOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      return traceTool("list_subjects", async () => {
        try {
          const output = await listGenerationSubjects();
          return {
            content: [{ type: "text" as const, text: formatSubjectsForTool(output) }],
            structuredContent: output,
          };
        } catch (error) {
          return toolError(error, "Could not list paper subjects.");
        }
      });
    },
  );

  server.registerTool(
    "get_subject_catalog",
    {
      title: "Get subject topics",
      description: "Return the topic tree, topic IDs, question counts, paper codes, tiers, and timing benchmark for one enabled GCSE subject. Use the returned topic IDs when generating a focused paper.",
      inputSchema: subjectCatalogInputSchema,
      outputSchema: subjectCatalogOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ subjectKey, subjectTier }) => {
      return traceTool("get_subject_catalog", async () => {
        try {
          const output = await getGenerationSubjectCatalog(subjectKey, subjectTier);
          return {
            content: [{ type: "text" as const, text: formatSubjectCatalogForTool(output) }],
            structuredContent: output,
          };
        } catch (error) {
          return toolError(error, "Could not load the subject catalog.");
        }
      });
    },
  );

  server.registerTool(
    "generate_paper_bundle",
    {
      title: "Generate a GCSE paper bundle",
      description: "Generate a printable GCSE question paper and its mark scheme as temporary HTTPS PDF downloads. Use list_subjects and get_subject_catalog first. This is a compute-heavy action and may take up to several minutes.",
      inputSchema: generatePaperBundleInputSchema,
      outputSchema: paperBundleOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input, context) => {
      return traceTool("generate_paper_bundle", async () => {
        try {
          const output = await generatePaperBundle(input, context.http?.req);
          return {
            content: await paperBundleContent(output),
            structuredContent: output,
          };
        } catch (error) {
          return toolError(error, "Could not generate the requested paper bundle.");
        }
      });
    },
  );

  return server;
}

export const paperMakerMcpHandler = createMcpHandler(
  () => createPaperMakerMcpServer(),
  {
    responseMode: "sse",
    keepAliveMs: 10_000,
    onerror: (error) => {
      console.error("MCP protocol error", error);
    },
  },
);
