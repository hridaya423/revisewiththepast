export function parseMarkInput(value: string, current: number, maximum: number) {
  if (value === "") return current;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(0, parsed)) : current;
}
