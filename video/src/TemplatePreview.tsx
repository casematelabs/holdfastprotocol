// Preview composition that showcases all reusable scene components.
// Use "remotion studio" and select TemplatePreview to inspect each component.

import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { IntroScene } from "./components/IntroScene";
import { OutroScene } from "./components/OutroScene";
import { SectionDivider } from "./components/SectionDivider";
import { VIDEO, TRANSITION_FRAMES } from "./brand";

const FPS = VIDEO.fps;
const INTRO_FRAMES = FPS * 6;
const DIVIDER_FRAMES = FPS * 4;
const OUTRO_FRAMES = FPS * 8;
const T = TRANSITION_FRAMES;

export const TEMPLATE_PREVIEW_DURATION =
  INTRO_FRAMES + DIVIDER_FRAMES + OUTRO_FRAMES - 2 * T;

export const TemplatePreview: React.FC = () => {
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={INTRO_FRAMES}>
        <IntroScene
          eyebrow="Holdfast Protocol"
          title="What is Holdfast Protocol?"
          subtitle="Trust infrastructure for autonomous AI agents on Solana"
        />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />

      <TransitionSeries.Sequence durationInFrames={DIVIDER_FRAMES}>
        <SectionDivider
          sectionNumber={1}
          label="The Problem"
          description="AI agents transact millions in value — but who holds them accountable?"
          accentColor="#EF4444"
        />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />

      <TransitionSeries.Sequence durationInFrames={OUTRO_FRAMES}>
        <OutroScene
          tagline="Trust infrastructure for the autonomous economy"
          primaryCta="Explore the SDK"
          secondaryCta="Join Devnet"
        />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
