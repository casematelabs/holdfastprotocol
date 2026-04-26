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

const NODES = [
  { id: "pending", label: "Pending", x: 340, y: 380 },
  { id: "funded", label: "Funded", x: 580, y: 320 },
  { id: "locked", label: "Locked", x: 820, y: 260 },
  { id: "released", label: "Released", x: 1060, y: 320 },
  { id: "claimed", label: "Claimed", x: 1260, y: 460 },
  { id: "disputed", label: "Disputed", x: 820, y: 660 },
];

const EDGES = [
  { from: "pending", to: "funded", label: "deposit" },
  { from: "funded", to: "locked", label: "lock" },
  { from: "locked", to: "released", label: "release" },
  { from: "released", to: "claimed", label: "claim" },
  { from: "locked", to: "disputed", label: "dispute" },
  { from: "disputed", to: "claimed", label: "resolve", dashed: true, via: "right" },
];

const ANNOTATIONS = [
  {
    text: "Program-owned ATA — only the program can move funds",
    delay: 1.5,
  },
  {
    text: "Dual-signature lock: both parties commit",
    delay: 5.0,
  },
  {
    text: "7-day dispute window after release",
    delay: 8.5,
  },
  {
    text: "Reputation updates on-chain at claim time",
    delay: 11.5,
  },
];

export const OnboardingLifecycleScene: React.FC = () => {
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

  const diagramOpacity = interpolate(frame, [fps * 0.8, fps * 1.6], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const nodeLocs = new Map(NODES.map((n) => [n.id, { x: n.x, y: n.y }]));

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
          top: 50,
          width: "100%",
          textAlign: "center",
          opacity: headerOpacity,
          transform: `translateY(${headerY}px)`,
        }}
      >
        <div
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: THEME.accent,
            letterSpacing: 6,
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          Architecture
        </div>
        <div
          style={{
            fontSize: 48,
            fontWeight: 900,
            color: THEME.textPrimary,
          }}
        >
          Escrow State Machine
        </div>
      </div>

      {/* Diagram container */}
      <div
        style={{
          position: "absolute",
          top: 230,
          left: 80,
          right: 80,
          bottom: 130,
          opacity: diagramOpacity,
        }}
      >
        {/* SVG for edges */}
        <svg
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
          }}
        >
          {EDGES.map((edge) => {
            const fromLoc = nodeLocs.get(edge.from)!;
            const toLoc = nodeLocs.get(edge.to)!;
            const edgeIndex = EDGES.indexOf(edge);
            const edgeStart = fps * (1.5 + edgeIndex * 1.8);
            const edgeProgress = interpolate(
              frame,
              [edgeStart, edgeStart + fps * 1],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            );

            // Draw the line segment visibility based on progress
            if (edgeProgress <= 0) return null;

            const midX = (fromLoc.x + toLoc.x) / 2;
            const midY = (fromLoc.y + toLoc.y) / 2;

            return (
              <g key={`${edge.from}-${edge.to}`}>
                {/* Edge line */}
                <line
                  x1={fromLoc.x}
                  y1={fromLoc.y}
                  x2={toLoc.x}
                  y2={toLoc.y}
                  stroke={THEME.border}
                  strokeWidth={2}
                  strokeDasharray={edge.dashed ? "8 4" : undefined}
                  opacity={edgeProgress}
                />
                {/* Arrowhead */}
                {edgeProgress > 0.3 && (
                  <polygon
                    points={`${toLoc.x - 14},${toLoc.y - 6} ${toLoc.x},${toLoc.y} ${toLoc.x - 14},${toLoc.y + 6}`}
                    fill={THEME.border}
                    opacity={edgeProgress}
                    transform={`rotate(${Math.atan2(toLoc.y - fromLoc.y, toLoc.x - fromLoc.x) * (180 / Math.PI)}, ${toLoc.x}, ${toLoc.y})`}
                  />
                )}
                {/* Edge label */}
                {edgeProgress > 0.5 && (
                  <text
                    x={midX}
                    y={midY - 12}
                    textAnchor="middle"
                    fill={THEME.textTertiary}
                    fontSize={13}
                    fontFamily={fontFamily}
                    opacity={edgeProgress}
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Nodes */}
        {NODES.map((node, i) => {
          const nodeStart = fps * (1.2 + i * 1.2);
          const nodeOpacity = interpolate(
            frame,
            [nodeStart, nodeStart + fps * 0.6],
            [0, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );

          const nodeScale = interpolate(
            frame,
            [nodeStart, nodeStart + fps * 0.6],
            [0.6, 1],
            {
              easing: Easing.bezier(0.34, 1.56, 0.64, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );

          const isTerminal = node.id === "claimed" || node.id === "disputed";
          const isNegative = node.id === "disputed";
          const accentColor = isNegative
            ? THEME.danger
            : isTerminal
              ? THEME.success
              : THEME.accent;

          return (
            <div
              key={node.id}
              style={{
                position: "absolute",
                left: node.x - 70,
                top: node.y - 24,
                width: 140,
                height: 48,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 12,
                backgroundColor: isNegative
                  ? `${THEME.danger}10`
                  : isTerminal
                    ? `${THEME.success}10`
                    : THEME.bgCard,
                border: `2px solid ${
                  isNegative
                    ? THEME.danger
                    : isTerminal
                      ? THEME.success
                      : THEME.border
                }`,
                opacity: nodeOpacity,
                transform: `scale(${nodeScale})`,
                fontSize: 17,
                fontWeight: 700,
                color: accentColor,
                boxShadow: isTerminal
                  ? `0 0 12px ${THEME.success}15`
                  : undefined,
              }}
            >
              {node.label}
            </div>
          );
        })}
      </div>

      {/* Annotations bar at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 30,
          left: 100,
          right: 100,
          display: "flex",
          justifyContent: "center",
          gap: 36,
        }}
      >
        {ANNOTATIONS.map((ann, i) => {
          const annOpacity = interpolate(
            frame,
            [fps * ann.delay, fps * (ann.delay + 1.2)],
            [0, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );

          return (
            <div
              key={i}
              style={{
                opacity: annOpacity,
                fontSize: 15,
                color: THEME.textSecondary,
                backgroundColor: `${THEME.accent}08`,
                padding: "8px 18px",
                borderRadius: 20,
                border: `1px solid ${THEME.accent}15`,
              }}
            >
              {ann.text}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
