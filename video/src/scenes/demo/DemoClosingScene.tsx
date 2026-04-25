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

export const DemoClosingScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const glowPulse = interpolate(
    frame,
    [0, fps * 2, fps * 4, fps * 6, fps * 8, fps * 10],
    [0.2, 0.7, 0.3, 0.8, 0.4, 0.6],
    { extrapolateRight: "clamp" },
  );

  const logoScale = interpolate(frame, [0, fps * 1.2], [0.4, 1], {
    easing: Easing.bezier(0.34, 1.56, 0.64, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleOpacity = interpolate(frame, [fps * 0.8, fps * 1.8], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const pillarsOpacity = interpolate(frame, [fps * 2.5, fps * 3.5], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const ctaOpacity = interpolate(frame, [fps * 4, fps * 5], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ctaY = interpolate(frame, [fps * 4, fps * 5], [20, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const footerOpacity = interpolate(frame, [fps * 6, fps * 7], [0, 1], {
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
      {/* Ambient glows */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 1200,
          height: 1200,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${THEME.accent}15 0%, transparent 55%)`,
          transform: "translate(-50%, -50%)",
          opacity: glowPulse,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "45%",
          left: "45%",
          width: 700,
          height: 700,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${THEME.hardline}10 0%, transparent 55%)`,
          transform: "translate(-50%, -50%)",
          opacity: glowPulse,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "55%",
          left: "55%",
          width: 500,
          height: 500,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${THEME.gold}08 0%, transparent 55%)`,
          transform: "translate(-50%, -50%)",
          opacity: glowPulse,
        }}
      />

      {/* Logo */}
      <div
        style={{
          transform: `scale(${logoScale})`,
          filter: `drop-shadow(0 0 60px ${THEME.accent}50)`,
          marginBottom: 36,
        }}
      >
        <LogoMark size={220} showWordmark />
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
            fontSize: 64,
            fontWeight: 900,
            color: THEME.textPrimary,
            lineHeight: 1.2,
          }}
        >
          The Missing Trust Layer
        </div>
        <div
          style={{
            fontSize: 28,
            color: THEME.textSecondary,
            marginTop: 16,
          }}
        >
          for the Autonomous Agent Economy
        </div>
      </div>

      {/* Three pillar badges */}
      <div
        style={{
          display: "flex",
          gap: 24,
          marginTop: 48,
          opacity: pillarsOpacity,
        }}
      >
        {[
          { label: "Escrow", color: THEME.accent },
          { label: "Reputation", color: THEME.gold },
          { label: "Attestation", color: THEME.hardline },
        ].map((p, i) => (
          <div
            key={i}
            style={{
              padding: "10px 28px",
              borderRadius: 40,
              backgroundColor: `${p.color}12`,
              border: `1.5px solid ${p.color}35`,
              fontSize: 18,
              fontWeight: 700,
              color: p.color,
            }}
          >
            {p.label}
          </div>
        ))}
      </div>

      {/* CTA */}
      <div
        style={{
          display: "flex",
          gap: 28,
          marginTop: 56,
          opacity: ctaOpacity,
          transform: `translateY(${ctaY}px)`,
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
          Try on Devnet
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
          Read the Docs
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          position: "absolute",
          bottom: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          opacity: footerOpacity,
        }}
      >
        <div
          style={{
            fontSize: 18,
            color: THEME.textTertiary,
            fontWeight: 700,
            letterSpacing: 4,
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
        <div
          style={{
            fontSize: 14,
            color: THEME.textTertiary,
            marginTop: 4,
          }}
        >
          Pre-audit software. Solana devnet only. Not for production use.
        </div>
      </div>
    </AbsoluteFill>
  );
};
