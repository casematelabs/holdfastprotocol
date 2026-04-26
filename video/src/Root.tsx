import { Composition } from "remotion";
import { HoldfastPitch } from "./HoldfastPitch";
import { HoldfastDemo } from "./HoldfastDemo";
import { HoldfastOnboarding, ONBOARDING_DURATION } from "./HoldfastOnboarding";
import { TemplatePreview, TEMPLATE_PREVIEW_DURATION } from "./TemplatePreview";
import {
  FPS,
  WIDTH,
  HEIGHT,
  SCENE_DURATIONS,
  DEMO_SCENE_DURATIONS,
  TRANSITION_DURATION,
} from "./theme";

const PITCH_DURATION =
  SCENE_DURATIONS.problem +
  SCENE_DURATIONS.solution +
  SCENE_DURATIONS.howItWorks +
  SCENE_DURATIONS.differentiators +
  SCENE_DURATIONS.cta -
  4 * TRANSITION_DURATION;

const DEMO_DURATION =
  DEMO_SCENE_DURATIONS.title +
  DEMO_SCENE_DURATIONS.valueProp +
  DEMO_SCENE_DURATIONS.escrowFlow +
  DEMO_SCENE_DURATIONS.reputationDash +
  DEMO_SCENE_DURATIONS.onChain +
  DEMO_SCENE_DURATIONS.sdk +
  DEMO_SCENE_DURATIONS.closing -
  6 * TRANSITION_DURATION;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HoldfastPitch"
        component={HoldfastPitch}
        durationInFrames={PITCH_DURATION}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="HoldfastDemo"
        component={HoldfastDemo}
        durationInFrames={DEMO_DURATION}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      {/* Developer onboarding video */}
      <Composition
        id="HoldfastOnboarding"
        component={HoldfastOnboarding}
        durationInFrames={ONBOARDING_DURATION}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      {/* Template preview — shows IntroScene, SectionDivider, and OutroScene in isolation */}
      <Composition
        id="TemplatePreview"
        component={TemplatePreview}
        durationInFrames={TEMPLATE_PREVIEW_DURATION}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    </>
  );
};
