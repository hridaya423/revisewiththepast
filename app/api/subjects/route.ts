import { GCSE_BOARDS, GCSE_SUBJECTS } from "@/convex/gcseCatalog";

export async function GET() {
  return Response.json({
    boards: GCSE_BOARDS,
    subjects: GCSE_SUBJECTS,
    counts: {
      boards: GCSE_BOARDS.length,
      subjects: GCSE_SUBJECTS.length,
    },
  });
}
