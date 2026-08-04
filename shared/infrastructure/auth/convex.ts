import "server-only";

import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { getServerEnvironment } from "@/shared/infrastructure/env/server";

const environment = getServerEnvironment();
const convexUrl = environment.NEXT_PUBLIC_CONVEX_URL ?? environment.CONVEX_URL;
if (!convexUrl || !environment.NEXT_PUBLIC_CONVEX_SITE_URL) {
  throw new Error("Missing Convex authentication environment configuration.");
}

export const {
  handler,
  preloadAuthQuery,
  isAuthenticated,
  getToken,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = convexBetterAuthNextJs({
  convexUrl,
  convexSiteUrl: environment.NEXT_PUBLIC_CONVEX_SITE_URL,
  basePath: environment.BETTER_AUTH_BASE_PATH,
});
