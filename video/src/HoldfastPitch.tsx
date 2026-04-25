import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { ProblemScene } from "./scenes/ProblemScene";
import { SolutionScene } from "./scenes/SolutionScene";
import { HowItWorksScene } from "./scenes/HowItWorksScene";
import { DifferentiatorsScene } from "./scenes/DifferentiatorsScene";
import { CTAScene } from "./scenes/CTAScene";
import { SCENE_DURATIONS, TRANSITION_DURATION } from "./theme";

export const HoldfastPitch: React.FC = () => {
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence
        durationInFrames={SCENE_DURATIONS.problem}
      >
        <ProblemScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      <TransitionSeries.Sequence
        durationInFrames={SCENE_DURATIONS.solution}
      >
        <SolutionScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      <TransitionSeries.Sequence
        durationInFrames={SCENE_DURATIONS.howItWorks}
      >
        <HowItWorksScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      <TransitionSeries.Sequence
        durationInFrames={SCENE_DURATIONS.differentiators}
      >
        <DifferentiatorsScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.cta}>
        <CTAScene />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
