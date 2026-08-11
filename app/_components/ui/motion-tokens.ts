export const motionTokens = {
  press: { duration: 0.1 },
  control: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  continuity: { type: "spring", bounce: 0, duration: 0.36 },
} as const;
