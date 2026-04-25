import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { THEME } from "../../theme";
import { LogoMark } from "../../components/LogoMark";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "900"],
  subsets: ["latin"],
});

const capabilities = [
  {
    icon: "🔐",
    title: "Hardware-Attested Wallets",
    desc: "secp256r1 keypairs anchored on Solana — same primitive as hardware security keys and Secure Enclave",
    color: THEME.hardline,
  },
  {
    icon: "🤝",
    title: "On-Chain Escrow",
    desc: "Lock funds in trustless pacts with automated settlement, dispute resolution, and deadline enforcement",
    color: THEME.accent,
  },
  {
    icon: "⭐",
    title: "Reputation Scores",
    desc: "Stake-weighted trust that travels with agents across protocols — oracle-governed, fully auditable",
    color: THEME.gold,
  },
];

export const DemoValuePropScene: React.FC = () => {
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

  const problemOpacity = interpolate(frame, [fps * 1.5, fps * 2.5], [0, 1], {
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
        padding: "80px 120px",
      }}
    >
      {/* Header */}
      <div
        style={{
          opacity: headerOpacity,
          transform: `translateY(${headerY}px)`,
          textAlign: "center",
          marginBottom: 20,
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
          The Problem
        </div>
        <div
          style={{
            fontSize: 56,
            fontWeight: 900,
            color: THEME.textPrimary,
            lineHeight: 1.15,
          }}
        >
          AI Agents Transact Billions
        </div>
      </div>

      {/* Problem statement */}
      <div
        style={{
          opacity: problemOpacity,
          fontSize: 28,
          color: THEME.textSecondary,
          textAlign: "center",
          maxWidth: 900,
          lineHeight: 1.5,
          marginBottom: 60,
        }}
      >
        But there is no{" "}
        <span style={{ color: THEME.danger, fontWeight: 700 }}>
          accountability layer
        </span>{" "}
        — no escrow, no reputation, no hardware-backed identity
      </div>

      {/* Divider with logo */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          marginBottom: 50,
          opacity: interpolate(frame, [fps * 3, fps * 4], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div
          style={{
            width: 80,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${THEME.accent}60)`,
          }}
        />
        <LogoMark size={36} />
        <div
          style={{
            fontSize: 24,
            fontWeight: 900,
            color: THEME.textPrimary,
          }}
        >
          Holdfast Protocol
        </div>
        <div
          style={{
            width: 80,
            height: 2,
            background: `linear-gradient(90deg, ${THEME.accent}60, transparent)`,
          }}
        />
      </div>

      {/* Capability cards */}
      <div
        style={{
          display: "flex",
          gap: 36,
          width: "100%",
          maxWidth: 1500,
        }}
      >
        {capabilities.map((cap, i) => {
          const cardDelay = fps * 5 + i * fps * 2;
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
                flex: 1,
                padding: "40px 32px",
                borderRadius: 24,
                background: `linear-gradient(180deg, ${cap.color}10, ${THEME.bgCard})`,
                border: `1px solid ${cap.color}25`,
                opacity: cardProgress,
                transform: `translateY(${cardY}px)`,
              }}
            >
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 20,
                  backgroundColor: `${cap.color}15`,
                  border: `2px solid ${cap.color}30`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 36,
                  marginBottom: 24,
                }}
              >
                {cap.icon}
              </div>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 900,
                  color: THEME.textPrimary,
                  marginBottom: 14,
                }}
              >
                {cap.title}
              </div>
              <div
                style={{
                  fontSize: 18,
                  color: THEME.textSecondary,
                  lineHeight: 1.6,
                }}
              >
                {cap.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* Solana badge */}
      <div
        style={{
          marginTop: 48,
          opacity: interpolate(frame, [fps * 14, fps * 15], [0, 1], {
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
