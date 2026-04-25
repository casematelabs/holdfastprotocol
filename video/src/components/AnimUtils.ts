import { interpolate, Easing } from "remotion";
import { EASING } from "../brand";

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

export function fadeIn(
  frame: number,
  startFrame: number,
  durationFrames: number,
): number {
  return interpolate(frame, [startFrame, startFrame + durationFrames], [0, 1], {
    easing: Easing.bezier(...EASING.entrance),
    ...CLAMP,
  });
}

export function slideIn(
  frame: number,
  startFrame: number,
  durationFrames: number,
  distance = 40,
): number {
  return interpolate(
    frame,
    [startFrame, startFrame + durationFrames],
    [distance, 0],
    { easing: Easing.bezier(...EASING.entrance), ...CLAMP },
  );
}

export function springScale(
  frame: number,
  startFrame: number,
  durationFrames: number,
): number {
  return interpolate(frame, [startFrame, startFrame + durationFrames], [0, 1], {
    easing: Easing.bezier(...EASING.spring),
    ...CLAMP,
  });
}

export function pulse(
  frame: number,
  periodFrames: number,
  min = 0.3,
  max = 0.8,
): number {
  const t = (frame % periodFrames) / periodFrames;
  return min + (max - min) * (0.5 - 0.5 * Math.cos(2 * Math.PI * t));
}
