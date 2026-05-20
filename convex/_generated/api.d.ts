/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as catalogSeedPlan from "../catalogSeedPlan.js";
import type * as gcseCatalog from "../gcseCatalog.js";
import type * as paperAssets from "../paperAssets.js";
import type * as questionPageAssets from "../questionPageAssets.js";
import type * as questionTags from "../questionTags.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  catalogSeedPlan: typeof catalogSeedPlan;
  gcseCatalog: typeof gcseCatalog;
  paperAssets: typeof paperAssets;
  questionPageAssets: typeof questionPageAssets;
  questionTags: typeof questionTags;
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

export declare const components: {};
