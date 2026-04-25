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

export type IntroSceneProps = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  accentColor?: string;
};

export const IntroScene: React.FC<IntroSceneProps> = ({
  title,
  subtitle,
  eyebrow,
  accentColor = COLORS.accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const glowOpacity = pulse(frame, fps * 4, 0.25, 0.7);
  const logoScale = springScale(frame, 0, fps * 1);
  const eyebrowOpacity = fadeIn(frame, fps * 0.8, fps * 0.6);
  const eyebrowY = slideIn(frame, fps * 0.8, fps * 0.6, 24);
  const titleOpacity = fadeIn(frame, fps * 1.2, fps * 0.8);
  const titleY = slideIn(frame, fps * 1.2, fps * 0.8, 40);
  const subtitleOpacity = fadeIn(frame, fps * 2, fps * 0.8);
  const subtitleY = slideIn(frame, fps * 2, fps * 0.8, 28);

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
      {/* Radial glow */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 900,
          height: 900,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accentColor}18 0%, transparent 65%)`,
          transform: "translate(-50%, -50%)",
          opacity: glowOpacity,
        }}
      />

      {/* Logo */}
      <div
        style={{
          marginBottom: 48,
          transform: `scale(${logoScale})`,
          filter: `drop-shadow(0 0 40px ${accentColor}55)`,
        }}
      >
        <LogoMark size={LOGO.sizes.large} />
      </div>

      {/* Eyebrow */}
      {eyebrow && (
        <div
          style={{
            opacity: eyebrowOpacity,
            transform: `translateY(${eyebrowY}px)`,
            fontSize: FONTS.sizes.eyebrow,
            fontWeight: FONTS.weights.bold,
            color: accentColor,
            letterSpacing: 6,
            textTransform: "uppercase" as const,
            marginBottom: 20,
          }}
        >
          {eyebrow}
        </div>
      )}

      {/* Title */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          fontSize: FONTS.sizes.display,
          fontWeight: FONTS.weights.black,
          color: COLORS.textPrimary,
          textAlign: "center",
          lineHeight: 1.1,
          maxWidth: 1400,
          padding: "0 120px",
        }}
      >
        {title}
      </div>

      {/* Subtitle */}
      {subtitle && (
        <div
          style={{
            opacity: subtitleOpacity,
            transform: `translateY(${subtitleY}px)`,
            fontSize: FONTS.sizes.subheading,
            color: COLORS.textSecondary,
            textAlign: "center",
            marginTop: 32,
            maxWidth: 1000,
            lineHeight: 1.5,
          }}
        >
          {subtitle}
        </div>
      )}
    </AbsoluteFill>
  );
};
