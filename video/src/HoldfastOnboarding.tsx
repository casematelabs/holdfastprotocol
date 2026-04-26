import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { IntroScene } from "./components/IntroScene";
import { OutroScene } from "./components/OutroScene";
import { SectionDivider } from "./components/SectionDivider";
import { OnboardingProtocolScene } from "./scenes/onboarding/OnboardingProtocolScene";
import { OnboardingInstallScene } from "./scenes/onboarding/OnboardingInstallScene";
import { OnboardingRegisterScene } from "./scenes/onboarding/OnboardingRegisterScene";
import { OnboardingPactScene } from "./scenes/onboarding/OnboardingPactScene";
import { OnboardingLifecycleScene } from "./scenes/onboarding/OnboardingLifecycleScene";
import { OnboardingReputationScene } from "./scenes/onboarding/OnboardingReputationScene";
import { OnboardingCTAScene } from "./scenes/onboarding/OnboardingCTAScene";
import { COLORS, TRANSITION_FRAMES } from "./brand";

const T = TRANSITION_FRAMES;

const INTRO_DURATION = 210;    // 7s (uses IntroScene)
const PROTOCOL_DURATION = 420; // 14s
const SECTION_INSTALL_DURATION = 90; // 3s (SectionDivider)
const INSTALL_DURATION = 420;  // 14s
const SECTION_REGISTER_DURATION = 90; // 3s
const REGISTER_DURATION = 480; // 16s
const SECTION_PACT_DURATION = 90; // 3s
const PACT_DURATION = 840;     // 28s
const LIFECYCLE_DURATION = 480; // 16s
const SECTION_REPUTATION_DURATION = 90; // 3s
const REPUTATION_DURATION = 540; // 18s
const SECTION_BUILD_DURATION = 90; // 3s
const CTA_DURATION = 360;      // 12s
const OUTRO_DURATION = 240;    // 8s (uses OutroScene)

export const ONBOARDING_DURATION =
  INTRO_DURATION +
  PROTOCOL_DURATION +
  SECTION_INSTALL_DURATION +
  INSTALL_DURATION +
  SECTION_REGISTER_DURATION +
  REGISTER_DURATION +
  SECTION_PACT_DURATION +
  PACT_DURATION +
  LIFECYCLE_DURATION +
  SECTION_REPUTATION_DURATION +
  REPUTATION_DURATION +
  SECTION_BUILD_DURATION +
  CTA_DURATION +
  OUTRO_DURATION +
  13 * T; // 13 transitions add 195f (~6.5s)

export const HoldfastOnboarding: React.FC = () => {
  return (
    <TransitionSeries>
      {/* Intro */}
      <TransitionSeries.Sequence durationInFrames={INTRO_DURATION}>
        <IntroScene
          eyebrow="Holdfast Protocol"
          title="Developer Onboarding"
          subtitle="Trust infrastructure for autonomous AI agents on Solana"
          accentColor={COLORS.accent}
        />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />

      {/* Scene: What is Holdfast */}
      <TransitionSeries.Sequence durationInFrames={PROTOCOL_DURATION}>
        <OnboardingProtocolScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />

      {/* Section Divider: Install */}
      <TransitionSeries.Sequence durationInFrames={SECTION_INSTALL_DURATION}>
        <SectionDivider
          sectionNumber={1}
          label="Install"
          description="Zero to devnet in under 15 minutes"
        />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: T })}
      />

      {/* Scene: Install & Prerequisites */}
      <TransitionSeries.Sequence durationInFrames={INSTALL_DURATION}>
        <OnboardingInstallScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />

      {/* Section Divider: Register */}
      <TransitionSeries.Sequence durationInFrames={SECTION_REGISTER_DURATION}>
        <SectionDivider
          sectionNumber={2}
          label="Register"
          description="One-time agent identity"
        />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: T })}
      />

      {/* Scene: Agent Wallet Registration */}
      <TransitionSeries.Sequence durationInFrames={REGISTER_DURATION}>
        <OnboardingRegisterScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />

      {/* Section Divider: First Pact */}
      <TransitionSeries.Sequence durationInFrames={SECTION_PACT_DURATION}>
        <SectionDivider
          sectionNumber={3}
          label="First Pact"
          description="Create, deposit, lock, release"
        />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: T })}
      />

      {/* Scene: Create Your First Pact */}
      <TransitionSeries.Sequence durationInFrames={PACT_DURATION}>
        <OnboardingPactScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />

      {/* Scene: Escrow Lifecycle Diagram */}
      <TransitionSeries.Sequence durationInFrames={LIFECYCLE_DURATION}>
        <OnboardingLifecycleScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />

      {/* Section Divider: Reputation */}
      <TransitionSeries.Sequence durationInFrames={SECTION_REPUTATION_DURATION}>
        <SectionDivider
          sectionNumber={4}
          label="Reputation"
          description="Verifiable on-chain trust"
          accentColor={COLORS.gold}
        />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: T })}
      />

      {/* Scene: Reputation System */}
      <TransitionSeries.Sequence durationInFrames={REPUTATION_DURATION}>
        <OnboardingReputationScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />

      {/* Section Divider: Build */}
      <TransitionSeries.Sequence durationInFrames={SECTION_BUILD_DURATION}>
        <SectionDivider
          sectionNumber={5}
          label="Start Building"
          description="Devnet is live. Mainnet after audit."
          accentColor={COLORS.success}
        />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />

      {/* Scene: Call to Action */}
      <TransitionSeries.Sequence durationInFrames={CTA_DURATION}>
        <OnboardingCTAScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: T })}
      />

      {/* Outro */}
      <TransitionSeries.Sequence durationInFrames={OUTRO_DURATION}>
        <OutroScene
          tagline="Trust infrastructure for the autonomous economy"
          primaryCta="Read the docs"
          secondaryCta="Join devnet"
        />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
