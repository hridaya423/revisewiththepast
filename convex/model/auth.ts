import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { authComponent } from "../auth";

export async function requireAuthenticatedUser(ctx: QueryCtx | MutationCtx) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Unauthorized");
  return user;
}

export async function requireOwnedSubmission(ctx: QueryCtx | MutationCtx, submissionId: Id<"markingSubmissions">) {
  const user = await requireAuthenticatedUser(ctx);
  const submission = await ctx.db.get("markingSubmissions", submissionId);
  if (!submission || !submission.ownerId || submission.ownerId !== String(user._id)) {
    throw new Error("Unauthorized");
  }
  return { user, submission };
}
