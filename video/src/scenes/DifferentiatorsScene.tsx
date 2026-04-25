import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { THEME } from "../theme";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "900"],
  subsets: ["latin"],
});

const differentiators = [
  {
    icon: "⭐",
    title: "On-Chain Reputation",
    desc: "Stake-weighted trust scores that travel with agents across protocols. No walled gardens.",
    color: THEME.gold,
    gradient: `linear-gradient(135deg, ${THEME.gold}15, ${THEME.gold}05)`,
  },
  {
    icon: "🔒",
    title: "Hardware Attestation",
    desc: "Hardline Protocol verifies agent identity at the hardware level. No spoofing.",
    color: THEME.hardline,
    gradient: `linear-gradient(135deg, ${THEME.hardline}15, ${THEME.hardline}05)`,
  },
  {
    icon: "💎",
    title: "Protocol Fees on Usage",
    desc: "Revenue from every escrow transaction. Sustainable economics for builders and stakers.",
    color: THEME.accent,
    gradient: `linear-gradient(135deg, ${THEME.accent}15, ${THEME.accent}05)`,
  },
];

export const DifferentiatorsScene: React.FC = () => {
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

  return (
    <AbsoluteFill
      style={{
        backgroundColor: THEME.bg,
        fontFamily,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 120px",
      }}
    >
      <div
        style={{
          opacity: headerOpacity,
          transform: `translateY(${headerY}px)`,
          textAlign: "center",
          marginBottom: 60,
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
          Why Holdfast
        </div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 900,
            color: THEME.textPrimary,
          }}
        >
          Key Differentiators
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 40,
          width: "100%",
          maxWidth: 1500,
        }}
      >
        {differentiators.map((item, i) => {
          const cardDelay = fps * 2 + i * fps * 2;
          const cardProgress = interpolate(
            frame,
            [cardDelay, cardDelay + fps * 0.8],
            [0, 1],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );
          const cardY = interpolate(
            frame,
            [cardDelay, cardDelay + fps * 0.8],
            [50, 0],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );

          const iconScale = interpolate(
            frame,
            [cardDelay + fps * 0.3, cardDelay + fps * 0.8],
            [0, 1],
            {
              easing: Easing.bezier(0.34, 1.56, 0.64, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );

          return (
            <div
              key={i}
              style={{
                flex: 1,
                padding: "48px 36px",
                borderRadius: 24,
                background: item.gradient,
                border: `1px solid ${item.color}30`,
                opacity: cardProgress,
                transform: `translateY(${cardY}px)`,
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 20,
                  backgroundColor: `${item.color}18`,
                  border: `2px solid ${item.color}35`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 40,
                  marginBottom: 28,
                  transform: `scale(${iconScale})`,
                }}
              >
                {item.icon}
              </div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 900,
                  color: THEME.textPrimary,
                  marginBottom: 16,
                }}
              >
                {item.title}
              </div>
              <div
                style={{
                  fontSize: 20,
                  color: THEME.textSecondary,
                  lineHeight: 1.6,
                }}
              >
                {item.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* Solana badge */}
      <div
        style={{
          marginTop: 50,
          opacity: interpolate(frame, [fps * 10, fps * 11], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 28px",
          borderRadius: 40,
          backgroundColor: THEME.bgCard,
          border: `1px solid ${THEME.border}`,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${THEME.accent}, ${THEME.hardline})`,
          }}
        />
        <div
          style={{
            fontSize: 18,
            color: THEME.textSecondary,
            fontWeight: 700,
          }}
        >
          Built on Solana — 400ms finality, &lt;$0.01 per escrow
        </div>
      </div>
    </AbsoluteFill>
  );
};
