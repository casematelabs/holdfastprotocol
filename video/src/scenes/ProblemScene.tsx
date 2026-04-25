import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
  Sequence,
} from "remotion";
import { THEME } from "../theme";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "900"],
  subsets: ["latin"],
});

export const ProblemScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, fps * 0.8], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleY = interpolate(frame, [0, fps * 0.8], [40, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const questionOpacity = interpolate(
    frame,
    [fps * 1.2, fps * 2],
    [0, 1],
    {
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const questionY = interpolate(frame, [fps * 1.2, fps * 2], [30, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const icons = [
    { label: "No escrow", icon: "⛔", delay: fps * 3 },
    { label: "No reputation", icon: "❓", delay: fps * 4.5 },
    { label: "No accountability", icon: "🚫", delay: fps * 6 },
  ];

  const pulseGlow = interpolate(
    frame,
    [0, fps * 2, fps * 4, fps * 6],
    [0, 0.3, 0.6, 1],
    {
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
          top: "50%",
          left: "50%",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${THEME.danger}15 0%, transparent 70%)`,
          transform: "translate(-50%, -50%)",
          opacity: pulseGlow,
        }}
      />

      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          fontSize: 28,
          fontWeight: 700,
          color: THEME.danger,
          letterSpacing: 6,
          textTransform: "uppercase",
          marginBottom: 24,
        }}
      >
        The Problem
      </div>

      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          fontSize: 72,
          fontWeight: 900,
          color: THEME.textPrimary,
          textAlign: "center",
          lineHeight: 1.15,
          maxWidth: 1200,
        }}
      >
        AI Agents Can't Trust
        <br />
        Each Other
      </div>

      <Sequence from={Math.round(fps * 1.2)} layout="none">
        <div
          style={{
            opacity: questionOpacity,
            transform: `translateY(${questionY}px)`,
            fontSize: 32,
            color: THEME.textSecondary,
            textAlign: "center",
            marginTop: 40,
            maxWidth: 900,
            lineHeight: 1.5,
          }}
        >
          Autonomous agents transact millions in value —{" "}
          <span style={{ color: THEME.accent }}>
            but who holds them accountable?
          </span>
        </div>
      </Sequence>

      <div
        style={{
          display: "flex",
          gap: 80,
          marginTop: 80,
        }}
      >
        {icons.map((item, i) => {
          const itemProgress = interpolate(
            frame,
            [item.delay, item.delay + fps * 0.6],
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
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 16,
                opacity: itemProgress,
                transform: `scale(${itemProgress})`,
              }}
            >
              <div
                style={{
                  width: 100,
                  height: 100,
                  borderRadius: 24,
                  backgroundColor: `${THEME.danger}15`,
                  border: `2px solid ${THEME.danger}40`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 48,
                }}
              >
                {item.icon}
              </div>
              <div
                style={{
                  fontSize: 20,
                  color: THEME.textSecondary,
                  fontWeight: 700,
                }}
              >
                {item.label}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
