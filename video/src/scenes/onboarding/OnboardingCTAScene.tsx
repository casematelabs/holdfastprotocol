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

const PROGRAMS = [
  { label: "holdfast", address: "2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq" },
  {
    label: "holdfast-escrow",
    address: "BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H",
  },
];

export const OnboardingCTAScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const glowPulse = interpolate(
    frame,
    [0, fps * 2, fps * 4, fps * 6],
    [0.3, 0.6, 0.4, 0.5],
    { extrapolateRight: "clamp" },
  );

  const logoScale = interpolate(frame, [0, fps * 1], [0, 1], {
    easing: Easing.bezier(0.34, 1.56, 0.64, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleOpacity = interpolate(frame, [fps * 0.5, fps * 1.3], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleY = interpolate(frame, [fps * 0.5, fps * 1.3], [30, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const installOpacity = interpolate(frame, [fps * 2, fps * 3], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const ctasOpacity = interpolate(frame, [fps * 3.5, fps * 4.5], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const ctasY = interpolate(frame, [fps * 3.5, fps * 4.5], [20, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const programsOpacity = interpolate(frame, [fps * 6, fps * 7], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const disclaimerOpacity = interpolate(frame, [fps * 8, fps * 9], [0, 1], {
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
      {/* Ambient glow */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 1000,
          height: 1000,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${THEME.accent}15 0%, transparent 55%)`,
          transform: "translate(-50%, -50%)",
          opacity: glowPulse,
        }}
      />

      {/* Logo */}
      <div
        style={{
          transform: `scale(${logoScale})`,
          filter: `drop-shadow(0 0 40px ${THEME.accent}40)`,
          marginBottom: 28,
        }}
      >
        <LogoMark size={140} />
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
            fontSize: 56,
            fontWeight: 900,
            color: THEME.textPrimary,
            lineHeight: 1.2,
          }}
        >
          Start Building on Devnet Today
        </div>
      </div>

      {/* Install command */}
      <div
        style={{
          opacity: installOpacity,
          marginTop: 36,
          padding: "16px 36px",
          borderRadius: 12,
          backgroundColor: "#0A0D14",
          border: `1px solid ${THEME.border}`,
        }}
      >
        <span
          style={{
            fontFamily: "'Courier New', monospace",
            fontSize: 18,
            color: THEME.success,
          }}
        >
          $ npm install @holdfastprotocol/sdk@devnet
        </span>
      </div>

      {/* CTA buttons */}
      <div
        style={{
          display: "flex",
          gap: 28,
          marginTop: 40,
          opacity: ctasOpacity,
          transform: `translateY(${ctasY}px)`,
        }}
      >
        <div
          style={{
            padding: "18px 44px",
            borderRadius: 16,
            background: `linear-gradient(135deg, ${THEME.accent}, ${THEME.accent}CC)`,
            fontSize: 22,
            fontWeight: 700,
            color: "#FFFFFF",
            boxShadow: `0 4px 24px ${THEME.accent}40`,
          }}
        >
          Read the Docs
        </div>
        <div
          style={{
            padding: "18px 44px",
            borderRadius: 16,
            backgroundColor: THEME.bgCardRaised,
            border: `2px solid ${THEME.accent}40`,
            fontSize: 22,
            fontWeight: 700,
            color: THEME.accent,
          }}
        >
          Try on Devnet
        </div>
      </div>

      {/* Program addresses */}
      <div
        style={{
          display: "flex",
          gap: 40,
          marginTop: 48,
          opacity: programsOpacity,
        }}
      >
        {PROGRAMS.map((prog) => (
          <div
            key={prog.label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              padding: "14px 24px",
              borderRadius: 12,
              backgroundColor: `${THEME.accent}05`,
              border: `1px solid ${THEME.accent}12`,
            }}
          >
            <div
              style={{
                fontSize: 14,
                color: THEME.textTertiary,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
              }}
            >
              {prog.label}
            </div>
            <div
              style={{
                fontSize: 13,
                color: THEME.textSecondary,
                fontFamily: "monospace",
              }}
            >
              {prog.address}
            </div>
          </div>
        ))}
      </div>

      {/* Disclaimer */}
      <div
        style={{
          position: "absolute",
          bottom: 36,
          opacity: disclaimerOpacity,
          fontSize: 14,
          color: THEME.textTertiary,
          textAlign: "center",
        }}
      >
        Pre-audit software. Solana devnet only. Not for production use.
        <br />
        Mainnet deployment will follow external security audit completion.
      </div>
    </AbsoluteFill>
  );
};
