import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { DemoTitleScene } from "./scenes/demo/DemoTitleScene";
import { DemoValuePropScene } from "./scenes/demo/DemoValuePropScene";
import { DemoEscrowFlowScene } from "./scenes/demo/DemoEscrowFlowScene";
import { DemoReputationDashScene } from "./scenes/demo/DemoReputationDashScene";
import { DemoOnChainScene } from "./scenes/demo/DemoOnChainScene";
import { DemoSDKScene } from "./scenes/demo/DemoSDKScene";
import { DemoClosingScene } from "./scenes/demo/DemoClosingScene";
import { DEMO_SCENE_DURATIONS, TRANSITION_DURATION } from "./theme";

export const HoldfastDemo: React.FC = () => {
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence
        durationInFrames={DEMO_SCENE_DURATIONS.title}
      >
        <DemoTitleScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      <TransitionSeries.Sequence
        durationInFrames={DEMO_SCENE_DURATIONS.valueProp}
      >
        <DemoValuePropScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      <TransitionSeries.Sequence
        durationInFrames={DEMO_SCENE_DURATIONS.escrowFlow}
      >
        <DemoEscrowFlowScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      <TransitionSeries.Sequence
        durationInFrames={DEMO_SCENE_DURATIONS.reputationDash}
      >
        <DemoReputationDashScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      <TransitionSeries.Sequence
        durationInFrames={DEMO_SCENE_DURATIONS.onChain}
      >
        <DemoOnChainScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      <TransitionSeries.Sequence
        durationInFrames={DEMO_SCENE_DURATIONS.sdk}
      >
        <DemoSDKScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      <TransitionSeries.Sequence
        durationInFrames={DEMO_SCENE_DURATIONS.closing}
      >
        <DemoClosingScene />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
