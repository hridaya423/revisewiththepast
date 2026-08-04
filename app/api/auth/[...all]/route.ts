import { handler } from "@/shared/infrastructure/auth/convex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = handler;
