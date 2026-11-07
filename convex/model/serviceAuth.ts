import { v } from "convex/values";

export function secretsMatch(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export function requireServiceSecret(serviceSecret: string) {
  const expected = process.env.MCP_SERVICE_SECRET;
  if (!expected || !secretsMatch(serviceSecret, expected)) throw new Error("Unauthorized");
}

export const serviceSecretArg = { serviceSecret: v.string() };
