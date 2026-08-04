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

describe("response page upload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reuses an existing content-addressed upload", async () => {
    mocks.getPage.mockResolvedValue({ _id: "page_1", sourceImageUrl: "https://cdn.example/page.png" });

    await expect(uploadResponsePage({
      submissionId: "submission_1",
      questionKey: "question_1",
      file: new File(["image"], "page.png", { type: "image/png" }),
    })).resolves.toEqual({ pageId: "page_1", imageUrl: "https://cdn.example/page.png" });

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.addPage).not.toHaveBeenCalled();
  });
});
