export const INTRO_TIMELINE = {
  background: 0,
  nodes: 140,
  edges: 500,
  formation: 1600,
  complete: 2100,
} as const;
export type IntroStage = keyof typeof INTRO_TIMELINE;
