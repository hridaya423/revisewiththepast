import { GCSE_BOARDS, GCSE_SUBJECTS } from "@/shared/domain/exam-catalog";

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
