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

export const DemoTitleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = interpolate(frame, [fps * 0.2, fps * 1.2], [0, 1], {
    easing: Easing.bezier(0.34, 1.56, 0.64, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleOpacity = interpolate(frame, [fps * 0.8, fps * 1.8], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleY = interpolate(frame, [fps * 0.8, fps * 1.8], [40, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subtitleOpacity = interpolate(frame, [fps * 2, fps * 3], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const badgeOpacity = interpolate(frame, [fps * 3.5, fps * 4.5], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const badgeY = interpolate(frame, [fps * 3.5, fps * 4.5], [20, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const disclaimerOpacity = interpolate(frame, [fps * 5, fps * 6], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const glowPulse = interpolate(
    frame,
    [0, fps * 3, fps * 6, fps * 9],
    [0.2, 0.6, 0.3, 0.5],
    { extrapolateRight: "clamp" },
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
      }}
    >
      {/* Ambient glow */}
      <div
        style={{
          position: "absolute",
          top: "40%",
          left: "50%",
          width: 900,
          height: 900,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${THEME.accent}18 0%, transparent 60%)`,
          transform: "translate(-50%, -50%)",
          opacity: glowPulse,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "45%",
          left: "55%",
          width: 500,
          height: 500,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${THEME.hardline}10 0%, transparent 60%)`,
          transform: "translate(-50%, -50%)",
          opacity: glowPulse,
        }}
      />

      {/* Logo */}
      <div
        style={{
          transform: `scale(${logoScale})`,
          filter: `drop-shadow(0 0 60px ${THEME.accent}50)`,
          marginBottom: 48,
        }}
      >
        <LogoMark size={180} showWordmark />
      </div>

      {/* Title */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 68,
            fontWeight: 900,
            color: THEME.textPrimary,
            lineHeight: 1.15,
          }}
        >
          Protocol Demo
        </div>
      </div>

      {/* Subtitle */}
      <div
        style={{
          opacity: subtitleOpacity,
          fontSize: 30,
          color: THEME.textSecondary,
          marginTop: 24,
          textAlign: "center",
          maxWidth: 800,
        }}
      >
        Hardware-attested trust infrastructure for autonomous AI agents
      </div>

      {/* Conference badge */}
      <div
        style={{
          opacity: badgeOpacity,
          transform: `translateY(${badgeY}px)`,
          marginTop: 64,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "16px 36px",
          borderRadius: 50,
          backgroundColor: THEME.bgCard,
          border: `1px solid ${THEME.accent}30`,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${THEME.accent}, ${THEME.hardline})`,
            boxShadow: `0 0 12px ${THEME.accent}60`,
          }}
        />
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: THEME.textSecondary,
            letterSpacing: 2,
          }}
        >
          AI AGENT CONFERENCE NYC — MAY 2026
        </div>
      </div>

      {/* Disclaimer */}
      <div
        style={{
          position: "absolute",
          bottom: 40,
          opacity: disclaimerOpacity,
          fontSize: 16,
          color: THEME.textTertiary,
          textAlign: "center",
          maxWidth: 700,
        }}
      >
        Holdfast Protocol is pre-audit software deployed on Solana devnet. Not
        for mainnet or production use.
      </div>
    </AbsoluteFill>
  );
};
