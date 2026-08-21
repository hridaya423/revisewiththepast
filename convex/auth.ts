import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";

import authConfig from "./auth.config";
import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";

const siteUrl = process.env.SITE_URL
  ?? process.env.NEXT_PUBLIC_SITE_URL
  ?? process.env.BETTER_AUTH_URL
  ?? "http://localhost:3000";

function getTrustedOrigins() {
  const origins = new Set<string>([
    siteUrl,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);

  const envOrigins = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.SITE_URL,
    process.env.BETTER_AUTH_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ].filter((value): value is string => Boolean(value));

  for (const origin of envOrigins) {
    origins.add(origin);
  }

  return Array.from(origins);
}

function requireAuthSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be set to at least 32 characters.");
  }
  return secret;
}

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    secret: requireAuthSecret(),
    baseURL: siteUrl,
    trustedOrigins: () => getTrustedOrigins(),
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [convex({ authConfig })],
  });
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await authComponent.getAuthUser(ctx);
  },
});
