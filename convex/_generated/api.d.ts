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
import type * as generationJobs from "../generationJobs.js";
import type * as generationReceipts from "../generationReceipts.js";
import type * as http from "../http.js";
import type * as insertPageAssets from "../insertPageAssets.js";
import type * as marking from "../marking.js";
import type * as markingFiles from "../markingFiles.js";
import type * as markingImportAssets from "../markingImportAssets.js";
import type * as mcpArtifacts from "../mcpArtifacts.js";
import type * as mcpRateLimits from "../mcpRateLimits.js";
import type * as model_auth from "../model/auth.js";
import type * as model_markingSummary from "../model/markingSummary.js";
import type * as model_serviceAuth from "../model/serviceAuth.js";
import type * as model_shadowJobs from "../model/shadowJobs.js";
import type * as model_shadowSave from "../model/shadowSave.js";
import type * as model_shadowSource from "../model/shadowSource.js";
import type * as paperAssets from "../paperAssets.js";
import type * as paperRegions from "../paperRegions.js";
import type * as questionIdentityAnchor from "../questionIdentityAnchor.js";
import type * as questionPageAssets from "../questionPageAssets.js";
import type * as questionTags from "../questionTags.js";
import type * as savedPapers from "../savedPapers.js";
import type * as shadowPaperScheduler from "../shadowPaperScheduler.js";
import type * as shadowPapers from "../shadowPapers.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  catalogSeedPlan: typeof catalogSeedPlan;
  crons: typeof crons;
  generationJobs: typeof generationJobs;
  generationReceipts: typeof generationReceipts;
  http: typeof http;
  insertPageAssets: typeof insertPageAssets;
  marking: typeof marking;
  markingFiles: typeof markingFiles;
  markingImportAssets: typeof markingImportAssets;
  mcpArtifacts: typeof mcpArtifacts;
  mcpRateLimits: typeof mcpRateLimits;
  "model/auth": typeof model_auth;
  "model/markingSummary": typeof model_markingSummary;
  "model/serviceAuth": typeof model_serviceAuth;
  "model/shadowJobs": typeof model_shadowJobs;
  "model/shadowSave": typeof model_shadowSave;
  "model/shadowSource": typeof model_shadowSource;
  paperAssets: typeof paperAssets;
  paperRegions: typeof paperRegions;
  questionIdentityAnchor: typeof questionIdentityAnchor;
  questionPageAssets: typeof questionPageAssets;
  questionTags: typeof questionTags;
  savedPapers: typeof savedPapers;
  shadowPaperScheduler: typeof shadowPaperScheduler;
  shadowPapers: typeof shadowPapers;
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
