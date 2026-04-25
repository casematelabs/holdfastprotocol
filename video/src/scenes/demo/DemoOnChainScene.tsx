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

const txFields = [
  { label: "Signature", value: "3HgX7Yq...5XqZ", mono: true },
  { label: "Block", value: "298,412,067", mono: false },
  { label: "Timestamp", value: "Apr 26, 2026 14:32:18 UTC", mono: false },
  { label: "Status", value: "Success", mono: false, color: THEME.success },
  {
    label: "Program",
    value: "D6mUa4w...ATxg (Holdfast Protocol)",
    mono: true,
  },
  {
    label: "Instruction",
    value: "registerAgentWallet",
    mono: true,
    color: THEME.accent,
  },
  { label: "Fee", value: "0.000005 SOL", mono: false },
  { label: "Compute Units", value: "42,381 / 200,000", mono: false },
];

export const DemoOnChainScene: React.FC = () => {
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

  const explorerOpacity = interpolate(frame, [fps * 1.5, fps * 2.5], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const explorerScale = interpolate(
    frame,
    [fps * 1.5, fps * 2.5],
    [0.96, 1],
    {
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const successBadgeScale = interpolate(
    frame,
    [fps * 3, fps * 3.8],
    [0, 1],
    {
      easing: Easing.bezier(0.34, 1.56, 0.64, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const verifiedPulse = interpolate(
    frame,
    [fps * 4, fps * 7, fps * 10, fps * 14],
    [0.4, 0.8, 0.4, 0.7],
    { extrapolateRight: "clamp" },
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
            fontSize: 28,
            fontWeight: 700,
            color: THEME.success,
            letterSpacing: 6,
            textTransform: "uppercase",
            marginBottom: 16,
          }}
        >
          On-Chain Verification
        </div>
        <div
          style={{
            fontSize: 58,
            fontWeight: 900,
            color: THEME.textPrimary,
          }}
        >
          Solana Explorer
        </div>
      </div>

      {/* Explorer card */}
      <div
        style={{
          position: "absolute",
          top: 220,
          left: 200,
          right: 200,
          bottom: 80,
          borderRadius: 24,
          backgroundColor: THEME.bgCard,
          border: `1px solid ${THEME.border}`,
          opacity: explorerOpacity,
          transform: `scale(${explorerScale})`,
          overflow: "hidden",
        }}
      >
        {/* Explorer top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 28px",
            borderBottom: `1px solid ${THEME.border}`,
            backgroundColor: THEME.bgCardRaised,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                backgroundColor: THEME.danger,
                opacity: 0.7,
              }}
            />
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                backgroundColor: THEME.warning,
                opacity: 0.7,
              }}
            />
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                backgroundColor: THEME.success,
                opacity: 0.7,
              }}
            />
          </div>
          <div
            style={{
              flex: 1,
              marginLeft: 24,
              padding: "8px 20px",
              borderRadius: 8,
              backgroundColor: THEME.bg,
              border: `1px solid ${THEME.border}`,
              fontSize: 14,
              fontFamily: "monospace",
              color: THEME.textTertiary,
            }}
          >
            explorer.solana.com/tx/3HgX7YqZN2abPmKvRtLs...?cluster=devnet
          </div>
          <div
            style={{
              marginLeft: 16,
              padding: "6px 16px",
              borderRadius: 6,
              backgroundColor: `${THEME.success}15`,
              border: `1px solid ${THEME.success}30`,
              fontSize: 13,
              fontWeight: 700,
              color: THEME.success,
              letterSpacing: 1,
            }}
          >
            DEVNET
          </div>
        </div>

        {/* Transaction header */}
        <div
          style={{
            padding: "28px 36px 20px",
            display: "flex",
            alignItems: "center",
            gap: 20,
          }}
        >
          <div
            style={{
              fontSize: 24,
              fontWeight: 900,
              color: THEME.textPrimary,
            }}
          >
            Transaction Details
          </div>

          {/* Success badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 20px",
              borderRadius: 20,
              backgroundColor: `${THEME.success}15`,
              border: `1.5px solid ${THEME.success}40`,
              transform: `scale(${successBadgeScale})`,
              boxShadow: `0 0 20px ${THEME.success}${Math.round(verifiedPulse * 30)
                .toString(16)
                .padStart(2, "0")}`,
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                backgroundColor: THEME.success,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                color: "#fff",
                fontWeight: 900,
              }}
            >
              ✓
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: THEME.success,
              }}
            >
              Confirmed
            </div>
          </div>
        </div>

        {/* Transaction fields */}
        <div
          style={{
            padding: "0 36px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {txFields.map((field, i) => {
            const fieldDelay = fps * 4 + i * fps * 0.8;
            const fieldOpacity = interpolate(
              frame,
              [fieldDelay, fieldDelay + fps * 0.4],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            );

            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "16px 0",
                  borderBottom:
                    i < txFields.length - 1
                      ? `1px solid ${THEME.border}`
                      : "none",
                  opacity: fieldOpacity,
                }}
              >
                <div
                  style={{
                    width: 200,
                    fontSize: 16,
                    fontWeight: 700,
                    color: THEME.textTertiary,
                  }}
                >
                  {field.label}
                </div>
                <div
                  style={{
                    fontSize: 17,
                    fontWeight: field.color ? 700 : 400,
                    color: field.color || THEME.textPrimary,
                    fontFamily: field.mono ? "monospace" : fontFamily,
                    letterSpacing: field.mono ? 0.5 : 0,
                  }}
                >
                  {field.value}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom callout */}
      <div
        style={{
          position: "absolute",
          bottom: 30,
          width: "100%",
          textAlign: "center",
          opacity: interpolate(frame, [fps * 14, fps * 16], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          fontSize: 22,
          color: THEME.textSecondary,
          fontWeight: 700,
        }}
      >
        Every transaction is publicly verifiable on Solana — no trust required
      </div>
    </AbsoluteFill>
  );
};
