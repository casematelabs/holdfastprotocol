// Backward-compatible re-exports. New code should import from ./brand directly.
import { COLORS, VIDEO, TRANSITION_FRAMES } from "./brand";

export const THEME = COLORS;

export const FPS = VIDEO.fps;
export const WIDTH = VIDEO.width;
export const HEIGHT = VIDEO.height;

export const SCENE_DURATIONS = {
  problem: 14 * FPS,
  solution: 14 * FPS,
  howItWorks: 24 * FPS,
  differentiators: 16 * FPS,
  cta: 12 * FPS,
} as const;

export const DEMO_SCENE_DURATIONS = {
  title: 12 * FPS,
  valueProp: 22 * FPS,
  escrowFlow: 40 * FPS,
  reputationDash: 28 * FPS,
  onChain: 22 * FPS,
  sdk: 18 * FPS,
  closing: 14 * FPS,
} as const;

export const TRANSITION_DURATION = TRANSITION_FRAMES;
