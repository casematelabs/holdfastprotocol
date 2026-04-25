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

const MOCK_SCORE = 612;
const MOCK_TIER = "Gold";
const TIER_COLOR = THEME.gold;
const MOCK_PACTS = 47;
const MOCK_DISPUTE_RATE = 4.3;

const sparkData = [
  540, 552, 563, 575, 582, 589, 595, 600, 603, 607, 609, 611, 612, 614, 612,
];

const historyEntries = [
  { pact: "a7f2e1", outcome: "Fulfilled", delta: "+12", time: "2m ago" },
  { pact: "c3d9b4", outcome: "Fulfilled", delta: "+11", time: "18m ago" },
  { pact: "e8a1f7", outcome: "Disputed", delta: "-8", time: "1h ago" },
  { pact: "b2c4d6", outcome: "Fulfilled", delta: "+14", time: "3h ago" },
];

function Sparkline({
  data,
  color,
  width,
  height,
  progress,
}: {
  data: number[];
  color: string;
  width: number;
  height: number;
  progress: number;
}) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 4;

  const visibleCount = Math.max(
    2,
    Math.floor(data.length * progress),
  );
  const visibleData = data.slice(0, visibleCount);

  const pts = visibleData.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return `${x},${y}`;
  });

  const areaPath = `M${pts[0]} L${pts.join(" L")} L${pad + ((visibleCount - 1) / (data.length - 1)) * (width - pad * 2)},${height} L${pad},${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", height }}
    >
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#spark-grad)" />
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {visibleCount === data.length && (
        <circle
          cx={pts[pts.length - 1].split(",")[0]}
          cy={pts[pts.length - 1].split(",")[1]}
          r="5"
          fill={color}
          stroke="#0D1117"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

export const DemoReputationDashScene: React.FC = () => {
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

  const dashOpacity = interpolate(frame, [fps * 1.5, fps * 2.5], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dashScale = interpolate(frame, [fps * 1.5, fps * 2.5], [0.95, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const scoreCountUp = Math.min(
    MOCK_SCORE,
    Math.round(
      interpolate(frame, [fps * 2, fps * 4], [0, MOCK_SCORE], {
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
    ),
  );

  const sparkProgress = interpolate(frame, [fps * 3, fps * 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const tierBadgeScale = interpolate(
    frame,
    [fps * 4, fps * 4.8],
    [0, 1],
    {
      easing: Easing.bezier(0.34, 1.56, 0.64, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const statsOpacity = interpolate(frame, [fps * 5, fps * 6], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const historyOpacity = interpolate(frame, [fps * 8, fps * 9], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const scoreBarWidth = interpolate(
    frame,
    [fps * 2.5, fps * 4],
    [0, (MOCK_SCORE / 1000) * 100],
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
            fontSize: 28,
            fontWeight: 700,
            color: THEME.gold,
            letterSpacing: 6,
            textTransform: "uppercase",
            marginBottom: 16,
          }}
        >
          Operator Dashboard
        </div>
        <div
          style={{
            fontSize: 58,
            fontWeight: 900,
            color: THEME.textPrimary,
          }}
        >
          On-Chain Reputation
        </div>
      </div>

      {/* Dashboard card */}
      <div
        style={{
          position: "absolute",
          top: 220,
          left: 120,
          right: 120,
          bottom: 60,
          borderRadius: 28,
          backgroundColor: THEME.bgCard,
          border: `1px solid ${THEME.border}`,
          opacity: dashOpacity,
          transform: `scale(${dashScale})`,
          display: "flex",
          overflow: "hidden",
        }}
      >
        {/* Left panel — Score */}
        <div
          style={{
            flex: 1,
            padding: "48px 48px",
            borderRight: `1px solid ${THEME.border}`,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Agent identity */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 32,
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                backgroundColor: `${THEME.accent}20`,
                border: `2px solid ${THEME.accent}40`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
              }}
            >
              🤖
            </div>
            <div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: THEME.textPrimary,
                }}
              >
                Agent 5xK7...G0rT
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: THEME.textTertiary,
                  fontFamily: "monospace",
                }}
              >
                5xK7vP2mHqRnL9sD3jW8bYtF4eXoZ1cN
              </div>
            </div>
          </div>

          {/* Score display */}
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: THEME.textTertiary,
                letterSpacing: 2,
                marginBottom: 8,
              }}
            >
              REPUTATION SCORE
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 12,
              }}
            >
              <div
                style={{
                  fontSize: 72,
                  fontWeight: 900,
                  color: THEME.textPrimary,
                  lineHeight: 1,
                }}
              >
                {scoreCountUp}
              </div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: THEME.textTertiary,
                }}
              >
                / 1000
              </div>
            </div>
          </div>

          {/* Score bar */}
          <div
            style={{
              width: "100%",
              height: 12,
              borderRadius: 6,
              backgroundColor: `${THEME.border}`,
              marginBottom: 20,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${scoreBarWidth}%`,
                height: "100%",
                borderRadius: 6,
                background: `linear-gradient(90deg, ${THEME.accent}, ${TIER_COLOR})`,
                boxShadow: `0 0 16px ${TIER_COLOR}40`,
              }}
            />
          </div>

          {/* Tier badge */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 24px",
              borderRadius: 40,
              backgroundColor: `${TIER_COLOR}15`,
              border: `1.5px solid ${TIER_COLOR}40`,
              transform: `scale(${tierBadgeScale})`,
              transformOrigin: "left center",
              marginBottom: 32,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                stroke={TIER_COLOR}
                strokeWidth="1.8"
                strokeLinejoin="round"
                fill={`${TIER_COLOR}30`}
              />
            </svg>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: TIER_COLOR,
              }}
            >
              {MOCK_TIER} Tier
            </div>
            <div
              style={{
                fontSize: 14,
                color: THEME.textTertiary,
              }}
            >
              500–749
            </div>
          </div>

          {/* Stats row */}
          <div
            style={{
              display: "flex",
              gap: 32,
              opacity: statsOpacity,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 900,
                  color: THEME.textPrimary,
                }}
              >
                {MOCK_PACTS}
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: THEME.textTertiary,
                  fontWeight: 700,
                }}
              >
                Pacts Completed
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 900,
                  color:
                    MOCK_DISPUTE_RATE > 10
                      ? THEME.danger
                      : THEME.success,
                }}
              >
                {MOCK_DISPUTE_RATE}%
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: THEME.textTertiary,
                  fontWeight: 700,
                }}
              >
                Dispute Rate
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 900,
                  color: THEME.textPrimary,
                }}
              >
                2m
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: THEME.textTertiary,
                  fontWeight: 700,
                }}
              >
                Last Update
              </div>
            </div>
          </div>
        </div>

        {/* Right panel — Chart + History */}
        <div
          style={{
            flex: 1,
            padding: "48px 48px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Sparkline */}
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: THEME.textTertiary,
                letterSpacing: 2,
                marginBottom: 16,
              }}
            >
              30-DAY SCORE TREND
            </div>
            <div
              style={{
                padding: "16px 0",
                borderRadius: 16,
                backgroundColor: THEME.bgCardRaised,
                border: `1px solid ${THEME.border}`,
                overflow: "hidden",
              }}
            >
              <Sparkline
                data={sparkData}
                color={TIER_COLOR}
                width={600}
                height={100}
                progress={sparkProgress}
              />
            </div>
          </div>

          {/* Recent history */}
          <div style={{ opacity: historyOpacity, flex: 1 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: THEME.textTertiary,
                letterSpacing: 2,
                marginBottom: 16,
              }}
            >
              RECENT PACT HISTORY
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {historyEntries.map((entry, i) => {
                const entryDelay = fps * 10 + i * fps * 1.5;
                const entryOpacity = interpolate(
                  frame,
                  [entryDelay, entryDelay + fps * 0.5],
                  [0, 1],
                  {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  },
                );

                const isFulfilled = entry.outcome === "Fulfilled";
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "14px 20px",
                      borderRadius: 12,
                      backgroundColor: THEME.bgCardRaised,
                      border: `1px solid ${THEME.border}`,
                      opacity: entryOpacity,
                      gap: 16,
                    }}
                  >
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        backgroundColor: isFulfilled
                          ? THEME.success
                          : THEME.danger,
                        boxShadow: `0 0 8px ${isFulfilled ? THEME.success : THEME.danger}40`,
                      }}
                    />
                    <div
                      style={{
                        fontSize: 14,
                        fontFamily: "monospace",
                        color: THEME.textTertiary,
                        width: 80,
                      }}
                    >
                      {entry.pact}
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: isFulfilled
                          ? THEME.success
                          : THEME.danger,
                        width: 90,
                      }}
                    >
                      {entry.outcome}
                    </div>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: entry.delta.startsWith("+")
                          ? THEME.success
                          : THEME.danger,
                        width: 60,
                      }}
                    >
                      {entry.delta}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: THEME.textTertiary,
                        marginLeft: "auto",
                      }}
                    >
                      {entry.time}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
