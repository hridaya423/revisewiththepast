import { importFinishedPaper as importFinishedPaperInfrastructure } from "../infrastructure/import/import-pipeline";

export async function importFinishedPaper(input: {
  file: File;
  studentLabel?: string;
  existingSubmissionId?: string;
  skipAutoScore: boolean;
}) {
  return importFinishedPaperInfrastructure(input);
}
