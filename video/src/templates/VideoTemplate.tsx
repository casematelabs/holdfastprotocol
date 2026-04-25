// Base composition template for Holdfast videos.
// Wraps an IntroScene + body scenes + OutroScene with smooth transitions.
// Copy this file and swap in your scenes to create a new video.

import React from "react";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { VIDEO, TRANSITION_FRAMES } from "../brand";
import { IntroScene, IntroSceneProps } from "../components/IntroScene";
import { OutroScene, OutroSceneProps } from "../components/OutroScene";

// Duration of intro and outro in frames
const INTRO_FRAMES = VIDEO.fps * 5;   // 5 s
const OUTRO_FRAMES = VIDEO.fps * 8;   // 8 s

export type VideoTemplateProps = {
  intro: IntroSceneProps;
  outro?: OutroSceneProps;
  // Body scenes: array of {scene, durationInFrames}
  scenes: Array<{
    component: React.FC;
    durationInFrames: number;
  }>;
};

export const VideoTemplate: React.FC<VideoTemplateProps> = ({
  intro,
  outro = {},
  scenes,
}) => {
  return (
    <TransitionSeries>
      {/* Intro */}
      <TransitionSeries.Sequence durationInFrames={INTRO_FRAMES}>
        <IntroScene {...intro} />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />

      {/* Body scenes with fade transitions between them */}
      {scenes.map((s, i) => (
        <React.Fragment key={i}>
          <TransitionSeries.Sequence durationInFrames={s.durationInFrames}>
            <s.component />
          </TransitionSeries.Sequence>
          {i < scenes.length - 1 && (
            <TransitionSeries.Transition
              presentation={fade()}
              timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
            />
          )}
        </React.Fragment>
      ))}

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />

      {/* Outro */}
      <TransitionSeries.Sequence durationInFrames={OUTRO_FRAMES}>
        <OutroScene {...outro} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};

// Utility: calculate total duration for a VideoTemplate composition
export function calcTemplateDuration(
  sceneDurations: number[],
  transitionCount?: number,
): number {
  const bodyDuration = sceneDurations.reduce((a, b) => a + b, 0);
  const transitions = (transitionCount ?? sceneDurations.length + 1) * TRANSITION_FRAMES;
  return INTRO_FRAMES + bodyDuration + OUTRO_FRAMES - transitions;
}
