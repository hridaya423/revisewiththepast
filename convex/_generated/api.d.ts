/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as catalogSeedPlan from "../catalogSeedPlan.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as insertPageAssets from "../insertPageAssets.js";
import type * as marking from "../marking.js";
import type * as markingImportAssets from "../markingImportAssets.js";
import type * as mcpArtifacts from "../mcpArtifacts.js";
import type * as mcpRateLimits from "../mcpRateLimits.js";
import type * as model_auth from "../model/auth.js";
import type * as model_markingSummary from "../model/markingSummary.js";
import type * as paperAssets from "../paperAssets.js";
import type * as paperRegions from "../paperRegions.js";
import type * as questionPageAssets from "../questionPageAssets.js";
import type * as questionTags from "../questionTags.js";
import type * as savedPapers from "../savedPapers.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  catalogSeedPlan: typeof catalogSeedPlan;
  crons: typeof crons;
  http: typeof http;
  insertPageAssets: typeof insertPageAssets;
  marking: typeof marking;
  markingImportAssets: typeof markingImportAssets;
  mcpArtifacts: typeof mcpArtifacts;
  mcpRateLimits: typeof mcpRateLimits;
  "model/auth": typeof model_auth;
  "model/markingSummary": typeof model_markingSummary;
  paperAssets: typeof paperAssets;
  paperRegions: typeof paperRegions;
  questionPageAssets: typeof questionPageAssets;
  questionTags: typeof questionTags;
  savedPapers: typeof savedPapers;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
