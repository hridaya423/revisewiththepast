import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function getRequiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getOptionalEnvironment(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function getFirstEnvironment(...names: string[]) {
  for (const name of names) {
    const value = getOptionalEnvironment(name);
    if (value) return value;
  }
  return undefined;
}

export function getBooleanEnvironment(name: string, fallback: boolean) {
  const value = getOptionalEnvironment(name);
  if (value === undefined) return fallback;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  throw new Error(`${name} must be 1, 0, true, or false.`);
}

export function getNumberEnvironment(name: string, fallback: number, bounds?: { min?: number; max?: number }) {
  const raw = process.env[name];
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a finite number.`);
  const minimum = bounds?.min ?? Number.NEGATIVE_INFINITY;
  const maximum = bounds?.max ?? Number.POSITIVE_INFINITY;
  return Math.max(minimum, Math.min(maximum, parsed));
}

export async function retryWithBackoff<T>(operation: () => Promise<T>, options?: { retries?: number; baseDelayMs?: number }) {
  const retries = Math.max(1, options?.retries ?? 3);
  const baseDelayMs = Math.max(0, options?.baseDelayMs ?? 1000);
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === retries - 1) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

export function writeJsonFile<T>(filePath: string, value: T) {
  mkdirSync(dirname(resolve(filePath)), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function consume() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, () => consume()));
  return results;
}
