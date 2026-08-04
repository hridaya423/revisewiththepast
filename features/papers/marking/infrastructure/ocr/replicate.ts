import "server-only";

import { getServerEnvironment } from "@/shared/infrastructure/env/server";

const HACKCLUB_REPLICATE_BASE_URL = "https://ai.hackclub.com/proxy/v1/replicate";
const DEEPSEEK_OCR_VERSION = "lucataco/deepseek-ocr:cb3b474fbfc56b1664c8c7841550bccecbe7b74c30e45ce938ffca1180b4dff5";
const HANDWRITTEN_OCR_VERSION = getServerEnvironment().HANDWRITTEN_OCR_VERSION ?? "";
const OCR_POLL_INTERVAL_MS = 1200;
const OCR_TIMEOUT_MS = 120_000;
const FETCH_RETRY_ATTEMPTS = 3;

export type OcrRunResult = {
  text: string;
  output: unknown;
  predictionId: string | null;
};

type ReplicatePrediction = {
  id?: string;
  status?: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: string;
  urls?: {
    get?: string;
  };
};

function getAuthHeaders() {
  const apiKey = getServerEnvironment().HACKCLUB_AI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing HACKCLUB_AI_API_KEY");
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, attempts = FETCH_RETRY_ATTEMPTS): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(600 * (attempt + 1));
    }
  }
  throw lastError;
}

function extractTextFromOutput(output: unknown): string {
  if (typeof output === "string") return output.trim();
  if (Array.isArray(output)) {
    return output
      .map((item) => extractTextFromOutput(item))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (output && typeof output === "object") {
    const candidates = ["text", "output_text", "markdown", "content", "result"].map((key) => Reflect.get(output, key));
    for (const candidate of candidates) {
      const parsed = extractTextFromOutput(candidate);
      if (parsed) return parsed;
    }
    return JSON.stringify(output);
  }
  return "";
}

async function createPrediction(imageUrl: string, modelVersion: string): Promise<ReplicatePrediction> {
  const headers = getAuthHeaders();
  const [ownerModel, version] = modelVersion.split(":");

  const modelEndpoint = `${HACKCLUB_REPLICATE_BASE_URL}/v1/models/${ownerModel}/versions/${version}/predictions`;
  const payload = {
    input: {
      image: imageUrl,
    },
  };

  const response = await fetch(modelEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (response.ok) {
    return (await response.json()) as ReplicatePrediction;
  }

  const fallbackEndpoint = `${HACKCLUB_REPLICATE_BASE_URL}/v1/predictions`;
  const fallbackResponse = await fetch(fallbackEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      version,
      input: payload.input,
    }),
  });

  if (!fallbackResponse.ok) {
    throw new Error(`Replicate OCR create failed: ${fallbackResponse.status} ${await fallbackResponse.text()}`);
  }

  return (await fallbackResponse.json()) as ReplicatePrediction;
}

async function getPrediction(url: string): Promise<ReplicatePrediction> {
  const response = await fetch(url, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Replicate OCR status failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as ReplicatePrediction;
}

async function runReplicateOcr(imageUrl: string, modelVersion: string): Promise<OcrRunResult> {
  if (!/^https?:\/\//i.test(imageUrl)) {
    throw new Error("OCR imageUrl must be an absolute http(s) URL");
  }

  const startedAt = Date.now();
  let prediction = await withRetry(() => createPrediction(imageUrl, modelVersion));

  while (prediction.status === "starting" || prediction.status === "processing") {
    if (Date.now() - startedAt > OCR_TIMEOUT_MS) {
      throw new Error("Replicate OCR timed out");
    }

    const pollUrl = prediction.urls?.get;
    if (!pollUrl) {
      throw new Error("Replicate OCR missing poll URL");
    }

    await sleep(OCR_POLL_INTERVAL_MS);
    prediction = await withRetry(() => getPrediction(pollUrl));
  }

  if (prediction.status === "failed" || prediction.status === "canceled") {
    throw new Error(`Replicate OCR failed: ${prediction.error ?? prediction.status}`);
  }

  return {
    text: extractTextFromOutput(prediction.output),
    output: prediction.output ?? null,
    predictionId: prediction.id ?? null,
  };
}

export async function runDeepseekOcrOnImage(imageUrl: string): Promise<OcrRunResult> {
  return runReplicateOcr(imageUrl, DEEPSEEK_OCR_VERSION);
}

export function isHandwrittenOcrConfigured() {
  return HANDWRITTEN_OCR_VERSION.trim().length > 0;
}

export async function runHandwrittenOcrOnImage(imageUrl: string): Promise<OcrRunResult> {
  if (!isHandwrittenOcrConfigured()) {
    console.warn("Handwritten OCR fallback requested but HANDWRITTEN_OCR_VERSION is not set.");
    return { text: "", output: null, predictionId: null };
  }
  return runReplicateOcr(imageUrl, HANDWRITTEN_OCR_VERSION);
}

export const OCR_PROVIDER = "replicate";
export const OCR_MODEL = DEEPSEEK_OCR_VERSION;
export const HANDWRITTEN_OCR_PROVIDER = "replicate-handwritten";
export const HANDWRITTEN_OCR_MODEL = HANDWRITTEN_OCR_VERSION;
