import {
  hostHeaderValidationResponse,
  originValidationResponse,
} from "@modelcontextprotocol/server";

import { paperMakerMcpHandler } from "@/features/mcp/server";
import { getServerEnvironment } from "@/shared/infrastructure/env/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function hostnameFrom(value: string) {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return value.trim().split("/")[0]?.split(":")[0] ?? "";
  }
}

function allowedHostnames() {
  const environment = getServerEnvironment();
  const configured = environment.MCP_ALLOWED_HOSTS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const localHosts = process.env.NODE_ENV === "production" ? [] : ["localhost", "127.0.0.1"];
  return Array.from(new Set([
    ...localHosts,
    ...configured.map(hostnameFrom),
    ...[
      environment.SITE_URL,
      environment.NEXT_PUBLIC_SITE_URL,
      environment.NEXT_PUBLIC_APP_URL,
      environment.VERCEL_URL,
    ].filter((value): value is string => Boolean(value)).map(hostnameFrom),
  ].filter(Boolean)));
}

function withCors(response: Response, request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Expose-Headers", "Last-Event-Id");
  const vary = headers.get("Vary");
  headers.set("Vary", vary ? `${vary}, Origin` : "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handle(request: Request) {
  const hosts = allowedHostnames();
  const rejectedHost = hostHeaderValidationResponse(request, hosts);
  if (rejectedHost) return rejectedHost;
  const rejectedOrigin = originValidationResponse(request, hosts);
  if (rejectedOrigin) return rejectedOrigin;
  if (request.method === "OPTIONS") {
    return withCors(new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Accept, Content-Type, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-Id",
        "Access-Control-Max-Age": "600",
      },
    }), request);
  }
  return withCors(await paperMakerMcpHandler.fetch(request), request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = handle;
