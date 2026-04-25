// Canonical brand constants for Holdfast video production.
// New compositions should import from here. theme.ts re-exports these
// values for backward compatibility with existing scenes.

export const COLORS = {
  bg: "#0D1117",
  bgCard: "#141B27",
  bgCardRaised: "#18202E",
  border: "#1E2D42",
  textPrimary: "#E8EDF2",
  textSecondary: "#8A99AC",
  textTertiary: "#4D5E72",
  accent: "#2D8CFF",
  accentDim: "rgba(45, 140, 255, 0.12)",
  accentBorder: "rgba(45, 140, 255, 0.22)",
  hardline: "#9F6BFF",
  hardlineDim: "rgba(159, 107, 255, 0.12)",
  success: "#22C55E",
  successDim: "rgba(34, 197, 94, 0.08)",
  warning: "#F59E0B",
  danger: "#EF4444",
  gold: "#D4AF37",
} as const;

export const FONTS = {
  primary: "Inter",
  fallback: "'Helvetica Neue', Arial, sans-serif",
  weights: {
    regular: "400",
    bold: "700",
    black: "900",
  } as const,
  sizes: {
    eyebrow: 26,
    body: 24,
    subheading: 32,
    heading: 64,
    display: 88,
    superDisplay: 120,
  } as const,
} as const;

export const LOGO = {
  sizes: {
    small: 48,
    medium: 80,
    large: 120,
    hero: 200,
  } as const,
} as const;

export const VIDEO = {
  fps: 30,
  width: 1920,
  height: 1080,
} as const;

// Bezier control points for use with Easing.bezier(...)
export const EASING = {
  entrance: [0.16, 1, 0.3, 1] as [number, number, number, number],
  spring: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
  smooth: [0.45, 0, 0.55, 1] as [number, number, number, number],
} as const;

export const TRANSITION_FRAMES = 15;
