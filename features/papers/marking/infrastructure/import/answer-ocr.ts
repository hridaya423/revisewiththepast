import { extractAnswerRegionText } from "../../domain/answer-extraction";
import { isHandwrittenOcrConfigured, runHandwrittenOcrOnImage } from "../ocr/replicate";

export type PageImage = { url: string; uploadId: string; size: number; fileName: string };

async function buildHandwrittenOcrText(
  pageNumbers: number[],
  pageImageByNumber: Map<number, PageImage>,
  cache: Map<number, string>,
): Promise<string> {
  if (!isHandwrittenOcrConfigured()) return "";
  const blocks: string[] = [];
  for (const pageNumber of pageNumbers) {
    if (!cache.has(pageNumber)) {
      const image = pageImageByNumber.get(pageNumber);
      let text = "";
      if (image) {
        try {
          const handwritten = await runHandwrittenOcrOnImage(image.url);
          text = handwritten.text.trim();
        } catch (error) {
          console.warn(`Handwritten OCR failed for page ${pageNumber}:`, error);
        }
      }
      cache.set(pageNumber, text);
    }
    const cached = cache.get(pageNumber) ?? "";
    if (cached) blocks.push(`Page ${pageNumber}\n${cached}`.trim());
  }
  return blocks.join("\n\n").trim();
}

export async function resolveAnswerOcr(params: {
  merged: { text: string; pages: number[] };
  promptText: string;
  contextText: string | null;
  pageImageByNumber: Map<number, PageImage>;
  handwrittenOcrByNumber: Map<number, string>;
}): Promise<{ ocrText: string; usedHandwritten: boolean; handwrittenText: string; answerExtraction: unknown }> {
  const { merged, promptText, contextText, pageImageByNumber, handwrittenOcrByNumber } = params;
  const extracted = extractAnswerRegionText({ fullOcrText: merged.text, promptText, contextText });

  if (extracted.answerText) {
    return { ocrText: extracted.answerText, usedHandwritten: false, handwrittenText: "", answerExtraction: extracted.rawJson };
  }

  const handwrittenText = await buildHandwrittenOcrText(merged.pages, pageImageByNumber, handwrittenOcrByNumber);
  if (!handwrittenText) {
    return { ocrText: merged.text, usedHandwritten: false, handwrittenText: "", answerExtraction: extracted.rawJson };
  }

  const combined = `${merged.text}\n\n${handwrittenText}`.trim();
  const reExtracted = extractAnswerRegionText({ fullOcrText: combined, promptText, contextText });
  return {
    ocrText: reExtracted.answerText || handwrittenText,
    usedHandwritten: true,
    handwrittenText,
    answerExtraction: reExtracted.rawJson,
  };
}
