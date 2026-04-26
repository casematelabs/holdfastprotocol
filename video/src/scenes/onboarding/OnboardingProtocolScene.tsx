import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { THEME } from "../../theme";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "900"],
  subsets: ["latin"],
});

const PILLARS = [
  {
    number: "01",
    label: "Registration",
    description: "P-256 key tied to Solana identity via AgentWallet PDA",
    color: THEME.accent,
    details: ["One-time idempotent call", "On-chain identity from day one"],
  },
  {
    number: "02",
    label: "Escrow",
    description: "Binding funded agreements between AI agents",
    color: THEME.success,
    details: [
      "USDC or any SPL token in program-owned vault",
      "Dual-signature lock for mutual commitment",
    ],
  },
  {
    number: "03",
    label: "Reputation",
    description: "Verifiable on-chain trust records",
    color: THEME.gold,
    details: [
      "Scores decay toward neutral over time",
      "CPI-composable: gate your protocol on Holdfast",
    ],
  },
];

export const OnboardingProtocolScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerOpacity = interpolate(frame, [0, fps * 0.6], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const headerY = interpolate(frame, [0, fps * 0.6], [30, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subOpacity = interpolate(frame, [fps * 0.5, fps * 1.2], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: THEME.bg,
        fontFamily,
      }}
    >
      {/* Ambient glow */}
      <div
        style={{
          position: "absolute",
          top: "30%",
          left: "50%",
          width: 1000,
          height: 1000,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${THEME.accent}10 0%, transparent 55%)`,
          transform: "translate(-50%, -50%)",
        }}
      />

      {/* Header */}
      <div
        style={{
          position: "absolute",
          top: 70,
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
            marginBottom: 20,
          }}
        >
          Holdfast Protocol
        </div>
        <div
          style={{
            fontSize: 56,
            fontWeight: 900,
            color: THEME.textPrimary,
            lineHeight: 1.2,
          }}
        >
          Trust Infrastructure
        </div>
        <div
          style={{
            fontSize: 28,
            color: THEME.textSecondary,
            marginTop: 12,
            opacity: subOpacity,
          }}
        >
          for the Autonomous Economy
        </div>
      </div>

      {/* Three pillars */}
      <div
        style={{
          position: "absolute",
          top: 320,
          left: 100,
          right: 100,
          display: "flex",
          gap: 32,
          justifyContent: "center",
        }}
      >
        {PILLARS.map((pillar, index) => {
          const pillarStart = fps * (1.5 + index * 2.2);
          const pillarOpacity = interpolate(
            frame,
            [pillarStart, pillarStart + fps * 0.8],
            [0, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );

          const pillarY = interpolate(
            frame,
            [pillarStart, pillarStart + fps * 0.8],
            [40, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );

          const detailsOpacity = interpolate(
            frame,
            [pillarStart + fps * 1, pillarStart + fps * 1.5],
            [0, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );

          return (
            <div
              key={pillar.number}
              style={{
                flex: 1,
                opacity: pillarOpacity,
                transform: `translateY(${pillarY}px)`,
                borderRadius: 24,
                backgroundColor: THEME.bgCard,
                border: `1px solid ${THEME.border}`,
                padding: "40px 32px 32px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontSize: 48,
                  fontWeight: 900,
                  color: pillar.color,
                  marginBottom: 16,
                  opacity: 0.4,
                }}
              >
                {pillar.number}
              </div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: pillar.color,
                  marginBottom: 12,
                }}
              >
                {pillar.label}
              </div>
              <div
                style={{
                  fontSize: 17,
                  color: THEME.textSecondary,
                  textAlign: "center",
                  lineHeight: 1.5,
                  marginBottom: 24,
                }}
              >
                {pillar.description}
              </div>
              <div
                style={{
                  opacity: detailsOpacity,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  width: "100%",
                }}
              >
                {pillar.details.map((detail, di) => (
                  <div
                    key={di}
                    style={{
                      fontSize: 14,
                      color: THEME.textTertiary,
                      textAlign: "center",
                      padding: "8px 12px",
                      borderRadius: 8,
                      backgroundColor: `${pillar.color}08`,
                      border: `1px solid ${pillar.color}15`,
                    }}
                  >
                    {detail}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom narration hint */}
      <div
        style={{
          position: "absolute",
          bottom: 40,
          width: "100%",
          textAlign: "center",
          opacity: interpolate(frame, [fps * 8, fps * 9], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          fontSize: 18,
          color: THEME.textTertiary,
        }}
      >
        No oracle. No centralized registry. Just program-derived accounts on
        Solana.
      </div>
    </AbsoluteFill>
  );
};
