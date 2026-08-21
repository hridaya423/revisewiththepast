import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addPage: vi.fn(),
  getPage: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("../infrastructure/convex/commands", () => ({
  addMarkingResponsePageInConvex: mocks.addPage,
  getMarkingResponsePageByUploadKey: mocks.getPage,
}));
vi.mock("@/shared/infrastructure/cdn/hackclub", () => ({ uploadToHackClubCdn: mocks.upload }));

import { uploadResponsePage } from "./uploads";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("response page upload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reuses an existing content-addressed upload", async () => {
    mocks.getPage.mockResolvedValue({ _id: "page_1", sourceImageUrl: "https://cdn.example/page.png" });

    await expect(uploadResponsePage({
      submissionId: "submission_1",
      questionKey: "question_1",
      file: new File([PNG_BYTES], "page.png", { type: "image/png" }),
    })).resolves.toEqual({ pageId: "page_1", imageUrl: "https://cdn.example/page.png" });

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.addPage).not.toHaveBeenCalled();
  });

  it("rejects files that are not real images", async () => {
    await expect(uploadResponsePage({
      submissionId: "submission_1",
      questionKey: "question_1",
      file: new File(["not-an-image"], "page.png", { type: "image/png" }),
    })).rejects.toMatchObject({ status: 400 });

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.getPage).not.toHaveBeenCalled();
  });
});
