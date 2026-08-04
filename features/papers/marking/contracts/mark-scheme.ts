import { z } from "zod";

export const generateMarkSchemeRequestSchema = z.object({
  subjectKey: z.string().trim().min(1),
  subjectTier: z.enum(["foundation", "higher"]).optional(),
  selectedUnitKeys: z.array(z.string().trim().min(1)).min(1, "selectedUnitKeys is required."),
});

export type GenerateMarkSchemeRequest = z.infer<typeof generateMarkSchemeRequestSchema>;
