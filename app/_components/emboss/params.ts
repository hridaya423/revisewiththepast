export type EmbossParams = {
  depth: number;
  soften: number;
  highlight: number;
  shadow: number;
};

export const EMBOSS_PRESETS = {
  subject: {
    depth: 1.2,
    soften: 0.8,
    highlight: 0.92,
    shadow: 0.32,
  },
  process: {
    depth: 1.4,
    soften: 0.7,
    highlight: 0.96,
    shadow: 0.36,
  },
  control: {
    depth: 0.9,
    soften: 0,
    highlight: 0.96,
    shadow: 0.18,
  },
} satisfies Record<string, EmbossParams>;
