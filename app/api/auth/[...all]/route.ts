import { handler } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = handler;
