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

const REPO_STATS = [
  { label: "Score", value: "7,250", max: "10,000", suffix: "bp" },
  { label: "Tier", value: "Attested", max: "", suffix: "" },
  { label: "Pacts", value: "47", max: "", suffix: "completed" },
  { label: "Disputes", value: "1", max: "", suffix: "lifetime" },
];

const TIERS = [
  { label: "Unverified", tier: "0", description: "No attestation", color: THEME.textTertiary },
  { label: "Attested", tier: "1", description: "P-256 self-attestation", color: THEME.accent },
  { label: "Hardline", tier: "2", description: "TEE-attested via Hardline", color: THEME.hardline },
];

export const OnboardingReputationScene: React.FC = () => {
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

  const dashOpacity = interpolate(frame, [fps * 1, fps * 1.8], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const dashScale = interpolate(frame, [fps * 1, fps * 1.8], [0.96, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const codeOpacity = interpolate(frame, [fps * 10, fps * 11.5], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const scoreBarProgress = interpolate(
    frame,
    [fps * 3, fps * 5],
    [0, 7250 / 10000],
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
      }}
    >
      {/* Header */}
      <div
        style={{
          position: "absolute",
          top: 60,
          width: "100%",
          textAlign: "center",
          opacity: headerOpacity,
          transform: `translateY(${headerY}px)`,
        }}
      >
        <div
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: THEME.gold,
            letterSpacing: 6,
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          On-Chain Trust
        </div>
        <div
          style={{
            fontSize: 48,
            fontWeight: 900,
            color: THEME.textPrimary,
          }}
        >
          ReputationAccount
        </div>
      </div>

      {/* Dashboard panel - left side */}
      <div
        style={{
          position: "absolute",
          top: 260,
          left: 140,
          width: 500,
          opacity: dashOpacity,
          transform: `scale(${dashScale})`,
          borderRadius: 24,
          backgroundColor: THEME.bgCard,
          border: `1px solid ${THEME.border}`,
          padding: "36px 36px 32px",
        }}
      >
        {/* Agent header */}
        <div
          style={{
            fontSize: 15,
            color: THEME.textTertiary,
            textTransform: "uppercase",
            letterSpacing: 3,
            marginBottom: 8,
          }}
        >
          Agent
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: THEME.textPrimary,
            fontFamily: "monospace",
            marginBottom: 32,
          }}
        >
          7xKX...2U9p
        </div>

        {/* Stats grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
          }}
        >
          {REPO_STATS.map((stat, i) => {
            const statStart = fps * (2.5 + i * 0.8);
            const statOpacity = interpolate(
              frame,
              [statStart, statStart + fps * 0.6],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            );

            return (
              <div
                key={stat.label}
                style={{
                  opacity: statOpacity,
                  padding: "20px",
                  borderRadius: 16,
                  backgroundColor: THEME.bgCardRaised,
                  border: `1px solid ${THEME.border}`,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    color: THEME.textTertiary,
                    textTransform: "uppercase",
                    letterSpacing: 2,
                    marginBottom: 8,
                  }}
                >
                  {stat.label}
                </div>
                <div
                  style={{
                    fontSize: 32,
                    fontWeight: 900,
                    color:
                      stat.label === "Score"
                        ? THEME.gold
                        : stat.label === "Disputes" && stat.value !== "0"
                          ? THEME.danger
                          : THEME.textPrimary,
                  }}
                >
                  {stat.value}
                  {stat.suffix && (
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 400,
                        color: THEME.textTertiary,
                        marginLeft: 6,
                      }}
                    >
                      {stat.suffix}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Score bar */}
        <div
          style={{
            marginTop: 28,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 10,
              fontSize: 14,
              color: THEME.textTertiary,
            }}
          >
            <span>0</span>
            <span>Neutral (5,000)</span>
            <span>10,000</span>
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 4,
              backgroundColor: THEME.bgCardRaised,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${scoreBarProgress * 100}%`,
                height: "100%",
                borderRadius: 4,
                background: `linear-gradient(90deg, ${THEME.gold}, ${THEME.accent})`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Tier badges - right side */}
      <div
        style={{
          position: "absolute",
          top: 260,
          right: 140,
          width: 400,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <div
          style={{
            fontSize: 15,
            color: THEME.textTertiary,
            textTransform: "uppercase",
            letterSpacing: 3,
            marginBottom: 4,
          }}
        >
          Verification Tiers
        </div>
        {TIERS.map((tier, i) => {
          const tierStart = fps * (4.5 + i * 1.6);
          const tierOpacity = interpolate(
            frame,
            [tierStart, tierStart + fps * 0.8],
            [0, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );

          const tierX = interpolate(
            frame,
            [tierStart, tierStart + fps * 0.8],
            [40, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );

          return (
            <div
              key={tier.label}
              style={{
                opacity: tierOpacity,
                transform: `translateX(${tierX}px)`,
                display: "flex",
                alignItems: "center",
                gap: 18,
                padding: "20px 24px",
                borderRadius: 16,
                backgroundColor: `${tier.color}08`,
                border: `1px solid ${tier.color}25`,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: `${tier.color}15`,
                  border: `1.5px solid ${tier.color}35`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  fontWeight: 900,
                  color: tier.color,
                  flexShrink: 0,
                }}
              >
                {tier.tier}
              </div>
              <div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: tier.color,
                    marginBottom: 4,
                  }}
                >
                  {tier.label}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: THEME.textTertiary,
                  }}
                >
                  {tier.description}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Code snippet at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 36,
          left: 140,
          right: 140,
          opacity: codeOpacity,
          borderRadius: 14,
          backgroundColor: "#0A0D14",
          border: `1px solid ${THEME.border}`,
          padding: "18px 28px",
          fontFamily: "'Courier New', monospace",
          fontSize: 16,
          color: THEME.textPrimary,
        }}
      >
        <span style={{ color: THEME.textTertiary }}>
          // Reputation-gated pact creation
        </span>
        <br />
        <span style={{ color: "#FF7B72" }}>const</span> escrow ={" "}
        <span style={{ color: "#FF7B72" }}>await</span> client.escrow
        <span style={{ color: "#D2A8FF" }}>.createPact</span>({"{"}
        <br />
        {"  "}reputationThreshold: {"{"}
        <br />
        {"    "}minScore:{" "}
        <span style={{ color: "#79C0FF" }}>6000</span>,{" "}
        <span style={{ color: THEME.textTertiary }}>
          // above neutral
        </span>
        <br />
        {"    "}minTier: VerifTier
        <span style={{ color: "#D2A8FF" }}>.Attested</span>,
        <br />
        {"    "}minPacts: <span style={{ color: "#79C0FF" }}>5</span>,
        <br />
        {"  },"}
        <br />
        {"}"});
      </div>
    </AbsoluteFill>
  );
};
