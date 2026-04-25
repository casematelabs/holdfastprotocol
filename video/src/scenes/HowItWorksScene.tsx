import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { THEME } from "../theme";
import { LogoMark } from "../components/LogoMark";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "900"],
  subsets: ["latin"],
});

const steps = [
  {
    num: "1",
    title: "Agent A creates escrow",
    desc: "Locks SOL + stakes reputation",
    color: THEME.accent,
  },
  {
    num: "2",
    title: "Agent B fulfills the task",
    desc: "Delivers work, stakes own reputation",
    color: THEME.success,
  },
  {
    num: "3",
    title: "Escrow releases",
    desc: "Funds transfer, reputation updates",
    color: THEME.gold,
  },
  {
    num: "4",
    title: "Or: dispute resolution",
    desc: "On-chain arbitration with deadline",
    color: THEME.hardline,
  },
];

export const HowItWorksScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerOpacity = interpolate(frame, [0, fps * 0.8], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const headerY = interpolate(frame, [0, fps * 0.8], [30, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const agentAX = 340;
  const agentBX = 1580;
  const escrowCenterX = 960;
  const diagramY = 520;

  const agentAOpacity = interpolate(frame, [fps * 1, fps * 1.8], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const agentBOpacity = interpolate(frame, [fps * 1.5, fps * 2.3], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const escrowOpacity = interpolate(frame, [fps * 2, fps * 2.8], [0, 1], {
    easing: Easing.bezier(0.34, 1.56, 0.64, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const arrowLeftProgress = interpolate(
    frame,
    [fps * 3, fps * 4],
    [0, 1],
    {
      easing: Easing.bezier(0.45, 0, 0.55, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const arrowRightProgress = interpolate(
    frame,
    [fps * 5, fps * 6],
    [0, 1],
    {
      easing: Easing.bezier(0.45, 0, 0.55, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const flowParticleLeft =
    frame >= fps * 3.5 && frame <= fps * 8
      ? interpolate(
          frame % Math.round(fps * 1.5),
          [0, fps * 1.5],
          [agentAX + 80, escrowCenterX - 70],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          },
        )
      : -100;

  const flowParticleRight =
    frame >= fps * 5.5 && frame <= fps * 10
      ? interpolate(
          frame % Math.round(fps * 1.5),
          [0, fps * 1.5],
          [escrowCenterX + 70, agentBX - 80],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          },
        )
      : -100;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: THEME.bg,
        fontFamily,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 80,
          width: "100%",
          textAlign: "center",
          opacity: headerOpacity,
          transform: `translateY(${headerY}px)`,
        }}
      >
        <div
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: THEME.accent,
            letterSpacing: 6,
            textTransform: "uppercase",
            marginBottom: 16,
          }}
        >
          How It Works
        </div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 900,
            color: THEME.textPrimary,
          }}
        >
          Agent-to-Agent Escrow
        </div>
      </div>

      {/* Agent A */}
      <div
        style={{
          position: "absolute",
          left: agentAX - 80,
          top: diagramY - 80,
          width: 160,
          height: 160,
          borderRadius: "50%",
          backgroundColor: THEME.bgCardRaised,
          border: `3px solid ${THEME.accent}60`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: agentAOpacity,
          boxShadow: `0 0 40px ${THEME.accent}20`,
        }}
      >
        <div style={{ fontSize: 48 }}>🤖</div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: THEME.accent,
            marginTop: 4,
          }}
        >
          Agent A
        </div>
      </div>

      {/* Agent B */}
      <div
        style={{
          position: "absolute",
          left: agentBX - 80,
          top: diagramY - 80,
          width: 160,
          height: 160,
          borderRadius: "50%",
          backgroundColor: THEME.bgCardRaised,
          border: `3px solid ${THEME.success}60`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: agentBOpacity,
          boxShadow: `0 0 40px ${THEME.success}20`,
        }}
      >
        <div style={{ fontSize: 48 }}>🤖</div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: THEME.success,
            marginTop: 4,
          }}
        >
          Agent B
        </div>
      </div>

      {/* Escrow vault */}
      <div
        style={{
          position: "absolute",
          left: escrowCenterX - 80,
          top: diagramY - 90,
          width: 160,
          height: 180,
          borderRadius: 24,
          background: `linear-gradient(180deg, ${THEME.bgCardRaised}, ${THEME.bgCard})`,
          border: `2px solid ${THEME.gold}50`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: escrowOpacity,
          transform: `scale(${escrowOpacity})`,
          boxShadow: `0 0 60px ${THEME.gold}15`,
        }}
      >
        <LogoMark size={50} color={THEME.gold} />
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: THEME.gold,
            marginTop: 8,
            letterSpacing: 2,
          }}
        >
          ESCROW
        </div>
      </div>

      {/* Arrow left (A -> Escrow) */}
      <svg
        style={{
          position: "absolute",
          left: agentAX + 80,
          top: diagramY - 2,
          width: escrowCenterX - agentAX - 160,
          height: 4,
        }}
      >
        <rect
          x={0}
          y={0}
          width={`${arrowLeftProgress * 100}%`}
          height={4}
          rx={2}
          fill={THEME.accent}
          opacity={0.7}
        />
      </svg>

      {/* Arrow right (Escrow -> B) */}
      <svg
        style={{
          position: "absolute",
          left: escrowCenterX + 80,
          top: diagramY - 2,
          width: agentBX - escrowCenterX - 160,
          height: 4,
        }}
      >
        <rect
          x={0}
          y={0}
          width={`${arrowRightProgress * 100}%`}
          height={4}
          rx={2}
          fill={THEME.success}
          opacity={0.7}
        />
      </svg>

      {/* Flow particles */}
      {flowParticleLeft > 0 && (
        <div
          style={{
            position: "absolute",
            left: flowParticleLeft - 6,
            top: diagramY - 6,
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: THEME.accent,
            boxShadow: `0 0 16px ${THEME.accent}`,
          }}
        />
      )}
      {flowParticleRight > 0 && (
        <div
          style={{
            position: "absolute",
            left: flowParticleRight - 6,
            top: diagramY - 6,
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: THEME.success,
            boxShadow: `0 0 16px ${THEME.success}`,
          }}
        />
      )}

      {/* Steps at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 80,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 32,
          padding: "0 100px",
        }}
      >
        {steps.map((step, i) => {
          const stepDelay = fps * 8 + i * fps * 2;
          const stepOpacity = interpolate(
            frame,
            [stepDelay, stepDelay + fps * 0.6],
            [0, 1],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );
          const stepY = interpolate(
            frame,
            [stepDelay, stepDelay + fps * 0.6],
            [20, 0],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );

          return (
            <div
              key={i}
              style={{
                flex: 1,
                padding: "24px 20px",
                borderRadius: 16,
                backgroundColor: THEME.bgCard,
                border: `1px solid ${step.color}25`,
                opacity: stepOpacity,
                transform: `translateY(${stepY}px)`,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  backgroundColor: `${step.color}20`,
                  color: step.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  fontWeight: 900,
                  marginBottom: 12,
                }}
              >
                {step.num}
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: THEME.textPrimary,
                  marginBottom: 6,
                }}
              >
                {step.title}
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: THEME.textSecondary,
                  lineHeight: 1.4,
                }}
              >
                {step.desc}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
