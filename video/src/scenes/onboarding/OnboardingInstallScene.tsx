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

const TERMINAL_LINES = [
  { text: "$ npm install @holdfastprotocol/sdk@devnet \\", delay: 0 },
  { text: "  @solana/web3.js @noble/curves", delay: 0.6 },
  { text: "", delay: 1.2 },
  { text: "added 47 packages in 3.2s", delay: 2.0 },
];

const PREREQS = [
  { icon: "1", text: "Node.js 18+ and npm/yarn", delay: 2.6 },
  { icon: "2", text: "Solana keypair with devnet SOL", delay: 3.2 },
  { icon: "3", text: "Two keypairs for end-to-end testing", delay: 3.8 },
];

export const OnboardingInstallScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerOpacity = interpolate(frame, [0, fps * 0.6], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const headerY = interpolate(frame, [0, fps * 0.6], [30, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const terminalOpacity = interpolate(frame, [fps * 0.8, fps * 1.6], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const terminalScale = interpolate(frame, [fps * 0.8, fps * 1.6], [0.96, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const prereqOpacity = interpolate(frame, [fps * 3, fps * 4], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
          top: 70,
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
            color: THEME.accent,
            letterSpacing: 6,
            textTransform: "uppercase",
            marginBottom: 16,
          }}
        >
          Getting Started
        </div>
        <div
          style={{
            fontSize: 58,
            fontWeight: 900,
            color: THEME.textPrimary,
          }}
        >
          One Command to Install
        </div>
      </div>

      {/* Terminal card */}
      <div
        style={{
          position: "absolute",
          top: 250,
          left: 200,
          right: 520,
          height: 320,
          borderRadius: 20,
          backgroundColor: "#0A0D14",
          border: `1px solid ${THEME.border}`,
          opacity: terminalOpacity,
          transform: `scale(${terminalScale})`,
          overflow: "hidden",
        }}
      >
        {/* Terminal top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 22px",
            borderBottom: `1px solid ${THEME.border}`,
            backgroundColor: "#0D1117",
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <div
              style={{
                width: 13,
                height: 13,
                borderRadius: "50%",
                backgroundColor: THEME.danger,
                opacity: 0.6,
              }}
            />
            <div
              style={{
                width: 13,
                height: 13,
                borderRadius: "50%",
                backgroundColor: THEME.warning,
                opacity: 0.6,
              }}
            />
            <div
              style={{
                width: 13,
                height: 13,
                borderRadius: "50%",
                backgroundColor: THEME.success,
                opacity: 0.6,
              }}
            />
          </div>
          <div
            style={{
              flex: 1,
              marginLeft: 20,
              fontSize: 14,
              color: THEME.textTertiary,
              fontFamily: "monospace",
            }}
          >
            terminal
          </div>
        </div>

        {/* Terminal content */}
        <div
          style={{
            padding: "28px 32px",
            fontFamily: "'Courier New', monospace",
            fontSize: 18,
            lineHeight: 1.8,
          }}
        >
          {TERMINAL_LINES.map((line, i) => {
            const lineStart = fps * 1.6 + line.delay * fps;
            const lineProgress = interpolate(
              frame,
              [lineStart, lineStart + fps * 0.3],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            );

            const isCommand = line.text.startsWith("$");
            const isOutput = line.text.startsWith("added");

            return (
              <div
                key={i}
                style={{
                  opacity: lineProgress,
                  minHeight: 30,
                  color: isCommand
                    ? THEME.success
                    : isOutput
                      ? THEME.textTertiary
                      : THEME.textPrimary,
                }}
              >
                {line.text}
              </div>
            );
          })}
        </div>
      </div>

      {/* Prerequisites checklist */}
      <div
        style={{
          position: "absolute",
          top: 250,
          right: 200,
          width: 270,
          display: "flex",
          flexDirection: "column",
          gap: 24,
          opacity: prereqOpacity,
        }}
      >
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: THEME.textSecondary,
            letterSpacing: 3,
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Prerequisites
        </div>
        {PREREQS.map((item, i) => {
          const itemStart = fps * 3.2 + item.delay * fps;
          const itemOpacity = interpolate(
            frame,
            [itemStart, itemStart + fps * 0.6],
            [0, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );

          const itemX = interpolate(
            frame,
            [itemStart, itemStart + fps * 0.6],
            [-20, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );

          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                opacity: itemOpacity,
                transform: `translateX(${itemX}px)`,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  backgroundColor: `${THEME.accent}15`,
                  border: `1.5px solid ${THEME.accent}35`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  fontWeight: 900,
                  color: THEME.accent,
                  flexShrink: 0,
                }}
              >
                {item.icon}
              </div>
              <div
                style={{
                  fontSize: 17,
                  color: THEME.textSecondary,
                  lineHeight: 1.4,
                }}
              >
                {item.text}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom tagline */}
      <div
        style={{
          position: "absolute",
          bottom: 50,
          width: "100%",
          textAlign: "center",
          opacity: interpolate(frame, [fps * 10, fps * 11], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          fontSize: 20,
          color: THEME.textTertiary,
        }}
      >
        Full TypeScript support with Anchor IDL types
      </div>
    </AbsoluteFill>
  );
};
