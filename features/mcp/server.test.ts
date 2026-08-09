import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/papers/server", () => ({
  generateMarkScheme: vi.fn(),
  generatePaper: vi.fn(),
  getSubjectDetail: vi.fn(),
  parseGeneratePaperRequest: vi.fn(),
}));

import { createPaperMakerMcpServer } from "./server";

describe("paper-maker MCP protocol", () => {
  it("advertises the stable read and generation tools over MCP", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createPaperMakerMcpServer();
    const client = new Client({ name: "gcsemeta-test-client", version: "1.0.0" });

    const serverConnection = server.connect(serverTransport);
    await client.connect(clientTransport);
    await serverConnection;

    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name).sort();

    expect(names).toEqual(["generate_paper_bundle", "get_subject_catalog", "list_subjects"]);
    expect(result.tools.find((tool) => tool.name === "generate_paper_bundle")?.outputSchema).toBeDefined();
    expect(result.tools.find((tool) => tool.name === "get_subject_catalog")?.inputSchema).toBeDefined();

    await client.close();
    await server.close();
  });
});
