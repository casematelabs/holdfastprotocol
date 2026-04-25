import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
  Sequence,
} from "remotion";
import { THEME } from "../theme";
import { LogoMark } from "../components/LogoMark";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "900"],
  subsets: ["latin"],
});

const pillars = [
  {
    title: "Escrow",
    desc: "Lock funds on-chain until conditions are met",
    color: THEME.accent,
  },
  {
    title: "Reputation",
    desc: "Stake-weighted on-chain trust scores",
    color: THEME.success,
  },
  {
    title: "Attestation",
    desc: "Hardware-backed identity via Hardline",
    color: THEME.hardline,
  },
];

export const SolutionScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const glowProgress = interpolate(frame, [0, fps * 1.5], [0, 1], {
    easing: Easing.bezier(0.45, 0, 0.55, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const badgeScale = interpolate(frame, [fps * 0.3, fps * 1], [0, 1], {
    easing: Easing.bezier(0.34, 1.56, 0.64, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleOpacity = interpolate(frame, [fps * 0.8, fps * 1.5], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleY = interpolate(frame, [fps * 0.8, fps * 1.5], [30, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subtitleOpacity = interpolate(
    frame,
    [fps * 2, fps * 2.8],
    [0, 1],
    {
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: THEME.bg,
        fontFamily,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 120,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "35%",
          left: "50%",
          width: 800,
          height: 800,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${THEME.accent}18 0%, transparent 60%)`,
          transform: "translate(-50%, -50%)",
          opacity: glowProgress,
        }}
      />

      <div
        style={{
          marginBottom: 32,
          transform: `scale(${badgeScale})`,
          filter: `drop-shadow(0 0 40px ${THEME.accent}60)`,
        }}
      >
        <LogoMark size={80} />
      </div>

      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          textAlign: "center",
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
          The Solution
        </div>
        <div
          style={{
            fontSize: 80,
            fontWeight: 900,
            color: THEME.textPrimary,
            lineHeight: 1.1,
          }}
        >
          Holdfast Protocol
        </div>
        <Sequence from={Math.round(fps * 2)} layout="none">
          <div
            style={{
              fontSize: 30,
              color: THEME.textSecondary,
              marginTop: 20,
              opacity: subtitleOpacity,
            }}
          >
            Trust infrastructure for the autonomous economy — on Solana
          </div>
        </Sequence>
      </div>

      <div
        style={{
          display: "flex",
          gap: 48,
          marginTop: 80,
        }}
      >
        {pillars.map((pillar, i) => {
          const pillarDelay = fps * 4 + i * fps * 1.5;
          const pillarProgress = interpolate(
            frame,
            [pillarDelay, pillarDelay + fps * 0.8],
            [0, 1],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );
          const pillarY = interpolate(
            frame,
            [pillarDelay, pillarDelay + fps * 0.8],
            [40, 0],
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
                width: 340,
                padding: "40px 32px",
                borderRadius: 20,
                backgroundColor: THEME.bgCard,
                border: `1px solid ${pillar.color}30`,
                opacity: pillarProgress,
                transform: `translateY(${pillarY}px)`,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: pillar.color,
                  margin: "0 auto 20px",
                  boxShadow: `0 0 20px ${pillar.color}60`,
                }}
              />
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 900,
                  color: THEME.textPrimary,
                  marginBottom: 12,
                }}
              >
                {pillar.title}
              </div>
              <div
                style={{
                  fontSize: 18,
                  color: THEME.textSecondary,
                  lineHeight: 1.5,
                }}
              >
                {pillar.desc}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
