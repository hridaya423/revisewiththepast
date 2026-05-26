import "server-only";

const HACKCLUB_REPLICATE_BASE_URL = "https://ai.hackclub.com/proxy/v1/replicate";
const DEEPSEEK_OCR_VERSION = "lucataco/deepseek-ocr:cb3b474fbfc56b1664c8c7841550bccecbe7b74c30e45ce938ffca1180b4dff5";
const OCR_POLL_INTERVAL_MS = 1200;
const OCR_TIMEOUT_MS = 120_000;

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
  const apiKey = process.env.HACKCLUB_AI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing HACKCLUB_AI_API_KEY");
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
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
    const record = output as Record<string, unknown>;
    const candidates = [record.text, record.output_text, record.markdown, record.content, record.result];
    for (const candidate of candidates) {
      const parsed = extractTextFromOutput(candidate);
      if (parsed) return parsed;
    }
    return JSON.stringify(output);
  }
  return "";
}

async function createPrediction(imageUrl: string): Promise<ReplicatePrediction> {
  const headers = getAuthHeaders();
  const [ownerModel, version] = DEEPSEEK_OCR_VERSION.split(":");

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

export async function runDeepseekOcrOnImage(imageUrl: string): Promise<OcrRunResult> {
  if (!/^https?:\/\//i.test(imageUrl)) {
    throw new Error("OCR imageUrl must be an absolute http(s) URL");
  }

  const startedAt = Date.now();
  let prediction = await createPrediction(imageUrl);

  while (prediction.status === "starting" || prediction.status === "processing") {
    if (Date.now() - startedAt > OCR_TIMEOUT_MS) {
      throw new Error("Replicate OCR timed out");
    }

    const pollUrl = prediction.urls?.get;
    if (!pollUrl) {
      throw new Error("Replicate OCR missing poll URL");
    }

    await new Promise((resolve) => setTimeout(resolve, OCR_POLL_INTERVAL_MS));
    prediction = await getPrediction(pollUrl);
  }

  if (prediction.status === "failed" || prediction.status === "canceled") {
    throw new Error(`Replicate OCR failed: ${prediction.error ?? prediction.status}`);
  }

  const text = extractTextFromOutput(prediction.output);
  if (!text) {
    throw new Error("Replicate OCR returned empty text");
  }

  return {
    text,
    output: prediction.output ?? null,
    predictionId: prediction.id ?? null,
  };
}

export const OCR_PROVIDER = "replicate";
export const OCR_MODEL = DEEPSEEK_OCR_VERSION;
