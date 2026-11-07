export function parseMarkInput(value: string, current: number, maximum: number) {
  if (value === "") return current;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(0, parsed)) : current;
}

/** Validates a typed mark without clamping, so the student sees why a value was refused. */
export function validateMarkInput(value: string, maximum: number): { ok: true; value: number } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, message: "Enter a mark." };
  if (!/^\d+$/.test(trimmed)) return { ok: false, message: "Use a whole number of marks." };
  const parsed = Number(trimmed);
  if (parsed > maximum) return { ok: false, message: `This question is out of ${maximum}.` };
  return { ok: true, value: parsed };
}
