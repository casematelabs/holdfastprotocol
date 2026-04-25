import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import { COLORS, FONTS } from "../brand";
import { fadeIn, slideIn } from "./AnimUtils";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "900"],
  subsets: ["latin"],
});

export type SectionDividerProps = {
  label: string;
  sectionNumber?: number;
  accentColor?: string;
  description?: string;
};

export const SectionDivider: React.FC<SectionDividerProps> = ({
  label,
  sectionNumber,
  accentColor = COLORS.accent,
  description,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Line sweep animation
  const lineWidth = interpolate(frame, [0, fps * 0.6], [0, 120], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const numberOpacity = fadeIn(frame, fps * 0.2, fps * 0.5);
  const labelOpacity = fadeIn(frame, fps * 0.5, fps * 0.6);
  const labelY = slideIn(frame, fps * 0.5, fps * 0.6, 32);
  const descOpacity = fadeIn(frame, fps * 1.0, fps * 0.6);

  // Background pulse glow
  const glowOpacity = interpolate(frame, [0, fps * 0.8], [0, 0.6], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
      {/* Subtle glow */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 700,
          height: 400,
          borderRadius: "50%",
          background: `radial-gradient(ellipse, ${accentColor}12 0%, transparent 70%)`,
          transform: "translate(-50%, -50%)",
          opacity: glowOpacity,
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
        }}
      >
        {/* Animated accent line */}
        <div
          style={{
            width: lineWidth,
            height: 3,
            borderRadius: 2,
            background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
            boxShadow: `0 0 12px ${accentColor}60`,
          }}
        />

        {/* Section number */}
        {sectionNumber !== undefined && (
          <div
            style={{
              opacity: numberOpacity,
              fontSize: FONTS.sizes.eyebrow,
              fontWeight: FONTS.weights.bold,
              color: accentColor,
              letterSpacing: 4,
              textTransform: "uppercase" as const,
            }}
          >
            {String(sectionNumber).padStart(2, "0")}
          </div>
        )}

        {/* Section label */}
        <div
          style={{
            opacity: labelOpacity,
            transform: `translateY(${labelY}px)`,
            fontSize: FONTS.sizes.heading,
            fontWeight: FONTS.weights.black,
            color: COLORS.textPrimary,
            letterSpacing: -1,
            textAlign: "center",
          }}
        >
          {label}
        </div>

        {/* Description */}
        {description && (
          <div
            style={{
              opacity: descOpacity,
              fontSize: FONTS.sizes.body,
              color: COLORS.textSecondary,
              textAlign: "center",
              maxWidth: 700,
              lineHeight: 1.5,
            }}
          >
            {description}
          </div>
        )}

        {/* Bottom accent line */}
        <div
          style={{
            width: lineWidth,
            height: 3,
            borderRadius: 2,
            background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
            boxShadow: `0 0 12px ${accentColor}60`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
