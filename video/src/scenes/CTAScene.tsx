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

export const CTAScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const glowPulse = interpolate(
    frame,
    [0, fps * 2, fps * 4, fps * 6, fps * 8],
    [0.3, 0.8, 0.3, 0.8, 0.3],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const logoScale = interpolate(frame, [0, fps * 1], [0.5, 1], {
    easing: Easing.bezier(0.34, 1.56, 0.64, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleOpacity = interpolate(frame, [fps * 0.5, fps * 1.3], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const ctaOpacity = interpolate(frame, [fps * 2, fps * 3], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const ctaY = interpolate(frame, [fps * 2, fps * 3], [20, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const urlOpacity = interpolate(frame, [fps * 4, fps * 5], [0, 1], {
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
      }}
    >
      {/* Radial glow */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 1000,
          height: 1000,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${THEME.accent}20 0%, transparent 60%)`,
          transform: "translate(-50%, -50%)",
          opacity: glowPulse,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${THEME.hardline}12 0%, transparent 60%)`,
          transform: "translate(-50%, -50%)",
          opacity: glowPulse,
        }}
      />

      {/* Logo */}
      <div
        style={{
          marginBottom: 40,
          transform: `scale(${logoScale})`,
          filter: `drop-shadow(0 0 50px ${THEME.accent}60)`,
        }}
      >
        <LogoMark size={200} showWordmark />
      </div>

      {/* Title */}
      <div
        style={{
          opacity: titleOpacity,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 900,
            color: THEME.textPrimary,
            lineHeight: 1.15,
          }}
        >
          Build with Holdfast Protocol
        </div>
      </div>

      {/* CTA buttons */}
      <div
        style={{
          display: "flex",
          gap: 32,
          marginTop: 48,
          opacity: ctaOpacity,
          transform: `translateY(${ctaY}px)`,
        }}
      >
        <div
          style={{
            padding: "20px 48px",
            borderRadius: 16,
            background: `linear-gradient(135deg, ${THEME.accent}, ${THEME.accent}CC)`,
            fontSize: 24,
            fontWeight: 700,
            color: "#FFFFFF",
            boxShadow: `0 4px 24px ${THEME.accent}40`,
          }}
        >
          Explore the SDK
        </div>
        <div
          style={{
            padding: "20px 48px",
            borderRadius: 16,
            backgroundColor: THEME.bgCardRaised,
            border: `2px solid ${THEME.accent}40`,
            fontSize: 24,
            fontWeight: 700,
            color: THEME.accent,
          }}
        >
          Join Devnet
        </div>
      </div>

      {/* URL */}
      <div
        style={{
          marginTop: 60,
          opacity: urlOpacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            fontSize: 22,
            color: THEME.textTertiary,
            fontWeight: 700,
            letterSpacing: 3,
          }}
        >
          CASEMATE LABS
        </div>
        <div
          style={{
            width: 60,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${THEME.accent}, transparent)`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
