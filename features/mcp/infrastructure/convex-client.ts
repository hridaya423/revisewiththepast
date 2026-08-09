import "server-only";

import { ConvexHttpClient } from "convex/browser";

import { DependencyUnavailableError } from "@/shared/application/errors";
import { getConvexUrl } from "@/shared/infrastructure/env/server";
import { getServerEnvironment } from "@/shared/infrastructure/env/server";

let client: ConvexHttpClient | null = null;

export function getMcpConvexClient() {
  if (client) return client;
  client = new ConvexHttpClient(getConvexUrl());
  return client;
}

export function getMcpServiceSecret() {
  const secret = getServerEnvironment().MCP_SERVICE_SECRET;
  if (!secret) throw new DependencyUnavailableError("MCP service safeguards are not configured.");
  return secret;
}
