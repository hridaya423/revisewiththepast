import { createHash } from "node:crypto";

import { addMarkingResponsePageInConvex, getMarkingResponsePageByUploadKey } from "../infrastructure/convex/commands";
import { uploadToHackClubCdn } from "@/shared/infrastructure/cdn/hackclub";
import { ValidationError } from "@/shared/application/errors";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function assertRecognizedImage(bytes: Uint8Array) {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  const heic = new TextDecoder().decode(bytes.slice(4, 12)).startsWith("ftyp");
  const gif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
  if (!(jpeg || png || webp || gif || heic)) {
    throw new ValidationError("Uploaded file does not look like a supported image.");
  }
}

export async function uploadResponsePage(input: {
  submissionId: string;
  questionKey: string;
  questionNumber?: string;
  questionPartNumber?: string;
  pageLabel?: string;
  file: File;
}) {
  if (input.file.size === 0) throw new ValidationError("Uploaded file is empty.");
  if (input.file.size > MAX_UPLOAD_BYTES) throw new ValidationError("Image uploads are limited to 10 MB.");
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  assertRecognizedImage(bytes);

  const uploadKey = createHash("sha256")
    .update(bytes)
    .update(`\0${input.submissionId}\0${input.questionKey}\0${input.pageLabel ?? ""}`)
    .digest("hex");
  const existing = await getMarkingResponsePageByUploadKey(input.submissionId, uploadKey);
  if (existing) return { pageId: existing._id, imageUrl: existing.sourceImageUrl };

  const upload = await uploadToHackClubCdn(input.file);
  const pageId = await addMarkingResponsePageInConvex({
    submissionId: input.submissionId,
    uploadKey,
    questionKey: input.questionKey,
    questionNumber: input.questionNumber,
    questionPartNumber: input.questionPartNumber,
    pageLabel: input.pageLabel,
    fileName: input.file.name,
    contentType: upload.contentType,
    fileSize: upload.size,
    cdnUploadId: upload.id,
    sourceImageUrl: upload.url,
    uploadedAt: upload.createdAt,
  });
  return { pageId, imageUrl: upload.url };
}
