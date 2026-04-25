import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import { COLORS, FONTS, LOGO } from "../brand";
import { LogoMark } from "./LogoMark";
import { fadeIn, slideIn, springScale, pulse } from "./AnimUtils";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "900"],
  subsets: ["latin"],
});

export type OutroSceneProps = {
  primaryCta?: string;
  secondaryCta?: string;
  tagline?: string;
  accentColor?: string;
};

export const OutroScene: React.FC<OutroSceneProps> = ({
  primaryCta = "Explore the SDK",
  secondaryCta = "Join Devnet",
  tagline,
  accentColor = COLORS.accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const glowOpacity = pulse(frame, fps * 4, 0.3, 0.8);
  const logoScale = springScale(frame, 0, fps * 1);
  const taglineOpacity = fadeIn(frame, fps * 0.8, fps * 0.7);
  const ctaOpacity = fadeIn(frame, fps * 1.8, fps * 0.8);
  const ctaY = slideIn(frame, fps * 1.8, fps * 0.8, 20);
  const attributionOpacity = fadeIn(frame, fps * 3.5, fps * 0.8);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        fontFamily,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Dual radial glow */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 1100,
          height: 1100,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accentColor}18 0%, transparent 60%)`,
          transform: "translate(-50%, -50%)",
          opacity: glowOpacity,
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
          background: `radial-gradient(circle, ${COLORS.hardline}10 0%, transparent 60%)`,
          transform: "translate(-50%, -50%)",
          opacity: glowOpacity,
        }}
      />

      {/* Logo */}
      <div
        style={{
          marginBottom: 40,
          transform: `scale(${logoScale})`,
          filter: `drop-shadow(0 0 50px ${accentColor}60)`,
        }}
      >
        <LogoMark size={LOGO.sizes.hero} showWordmark />
      </div>

      {/* Tagline */}
      {tagline && (
        <div
          style={{
            opacity: taglineOpacity,
            fontSize: FONTS.sizes.subheading,
            fontWeight: FONTS.weights.bold,
            color: COLORS.textSecondary,
            textAlign: "center",
            marginBottom: 16,
            maxWidth: 900,
          }}
        >
          {tagline}
        </div>
      )}

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
            background: `linear-gradient(135deg, ${accentColor}, ${accentColor}CC)`,
            fontSize: FONTS.sizes.body,
            fontWeight: FONTS.weights.bold,
            color: "#FFFFFF",
            boxShadow: `0 4px 24px ${accentColor}40`,
          }}
        >
          {primaryCta}
        </div>
        <div
          style={{
            padding: "20px 48px",
            borderRadius: 16,
            backgroundColor: COLORS.bgCardRaised,
            border: `2px solid ${accentColor}40`,
            fontSize: FONTS.sizes.body,
            fontWeight: FONTS.weights.bold,
            color: accentColor,
          }}
        >
          {secondaryCta}
        </div>
      </div>

      {/* Attribution bar */}
      <div
        style={{
          marginTop: 72,
          opacity: attributionOpacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            fontSize: 20,
            color: COLORS.textTertiary,
            fontWeight: FONTS.weights.bold,
            letterSpacing: 4,
            textTransform: "uppercase" as const,
          }}
        >
          Casemate Labs
        </div>
        <div
          style={{
            width: 60,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
