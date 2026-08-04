import { createHash } from "node:crypto";

import { addMarkingResponsePageInConvex, getMarkingResponsePageByUploadKey } from "../infrastructure/convex/commands";
import { uploadToHackClubCdn } from "@/shared/infrastructure/cdn/hackclub";

export async function uploadResponsePage(input: {
  submissionId: string;
  questionKey: string;
  questionNumber?: string;
  questionPartNumber?: string;
  pageLabel?: string;
  file: File;
}) {
  const uploadKey = createHash("sha256")
    .update(new Uint8Array(await input.file.arrayBuffer()))
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
