import { SUBJECT_SOURCE_REGISTRY } from "@/features/ingestion";

export async function GET() {
  const byBoard = SUBJECT_SOURCE_REGISTRY.reduce<Record<string, number>>((acc, row) => {
    acc[row.boardCode] = (acc[row.boardCode] ?? 0) + 1;
    return acc;
  }, {});

  return Response.json({
    totalPlans: SUBJECT_SOURCE_REGISTRY.length,
    byBoard,
    plans: SUBJECT_SOURCE_REGISTRY,
  });
}
