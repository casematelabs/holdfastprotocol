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

const CODE_LINES = [
  { text: 'import { HoldfastSDK } from "@holdfast/sdk";', delay: 0 },
  { text: "", delay: 0.3 },
  { text: "const holdfast = new HoldfastSDK({", delay: 0.6 },
  { text: '  network: "devnet",', delay: 1.0 },
  { text: "  wallet: agentKeypair,", delay: 1.3 },
  { text: "});", delay: 1.6 },
  { text: "", delay: 1.9 },
  { text: "// Create an escrow pact between two agents", delay: 2.2 },
  { text: "const pact = await holdfast.createPact({", delay: 2.8 },
  { text: "  fulfiller: agentB.publicKey,", delay: 3.2 },
  { text: "  amount: 1.5, // SOL", delay: 3.6 },
  { text: "  deadline: Date.now() + 86_400_000,", delay: 4.0 },
  { text: "});", delay: 4.4 },
  { text: "", delay: 4.7 },
  { text: "// Deposit funds into escrow vault", delay: 5.0 },
  { text: "await pact.deposit();", delay: 5.5 },
  { text: "", delay: 5.8 },
  { text: "// Release on fulfillment", delay: 6.1 },
  { text: "await pact.release();", delay: 6.6 },
];

type TokenType = "keyword" | "string" | "comment" | "number" | "method" | "plain";

function tokenize(text: string): Array<{ text: string; type: TokenType }> {
  if (text.startsWith("//")) return [{ text, type: "comment" }];

  const tokens: Array<{ text: string; type: TokenType }> = [];
  const regex =
    /(\/\/.*$|"[^"]*"|'[^']*'|`[^`]*`|\b(?:import|from|const|await|new|return)\b|\b\d[\d_,.]*\b|\.(?:createPact|deposit|release|publicKey)\b)/g;

  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: text.slice(lastIndex, match.index), type: "plain" });
    }
    const m = match[0];
    let type: TokenType = "plain";
    if (m.startsWith("//")) type = "comment";
    else if (m.startsWith('"') || m.startsWith("'") || m.startsWith("`"))
      type = "string";
    else if (/^(?:import|from|const|await|new|return)$/.test(m))
      type = "keyword";
    else if (m.startsWith(".")) type = "method";
    else if (/^\d/.test(m)) type = "number";
    tokens.push({ text: m, type });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push({ text: text.slice(lastIndex), type: "plain" });
  }
  return tokens;
}

const TOKEN_COLORS: Record<TokenType, string> = {
  keyword: "#FF7B72",
  string: "#A5D6FF",
  comment: THEME.textTertiary,
  number: "#79C0FF",
  method: "#D2A8FF",
  plain: THEME.textPrimary,
};

export const DemoSDKScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerOpacity = interpolate(frame, [0, fps * 0.8], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const headerY = interpolate(frame, [0, fps * 0.8], [30, 0], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const editorOpacity = interpolate(frame, [fps * 1, fps * 1.8], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const editorScale = interpolate(frame, [fps * 1, fps * 1.8], [0.96, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const calloutOpacity = interpolate(frame, [fps * 13, fps * 14.5], [0, 1], {
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
          top: 60,
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
          SDK Integration
        </div>
        <div
          style={{
            fontSize: 58,
            fontWeight: 900,
            color: THEME.textPrimary,
          }}
        >
          Three Calls to Trust
        </div>
      </div>

      {/* Code editor card */}
      <div
        style={{
          position: "absolute",
          top: 220,
          left: 240,
          right: 240,
          bottom: 120,
          borderRadius: 24,
          backgroundColor: THEME.bgCard,
          border: `1px solid ${THEME.border}`,
          opacity: editorOpacity,
          transform: `scale(${editorScale})`,
          overflow: "hidden",
        }}
      >
        {/* Editor top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 28px",
            borderBottom: `1px solid ${THEME.border}`,
            backgroundColor: THEME.bgCardRaised,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                backgroundColor: THEME.danger,
                opacity: 0.7,
              }}
            />
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                backgroundColor: THEME.warning,
                opacity: 0.7,
              }}
            />
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                backgroundColor: THEME.success,
                opacity: 0.7,
              }}
            />
          </div>
          <div
            style={{
              flex: 1,
              marginLeft: 24,
              fontSize: 15,
              color: THEME.textTertiary,
              fontFamily: "monospace",
            }}
          >
            agent-setup.ts
          </div>
          <div
            style={{
              padding: "4px 14px",
              borderRadius: 6,
              backgroundColor: `${THEME.accent}15`,
              border: `1px solid ${THEME.accent}30`,
              fontSize: 12,
              fontWeight: 700,
              color: THEME.accent,
              letterSpacing: 1,
            }}
          >
            TypeScript
          </div>
        </div>

        {/* Code content */}
        <div
          style={{
            padding: "32px 36px",
            fontFamily: "'Courier New', monospace",
            fontSize: 19,
            lineHeight: 1.7,
          }}
        >
          {CODE_LINES.map((line, i) => {
            const lineStart = fps * 2 + line.delay * fps;
            const lineProgress = interpolate(
              frame,
              [lineStart, lineStart + fps * 0.3],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            );

            const tokens = tokenize(line.text);

            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  opacity: lineProgress,
                  minHeight: 32,
                }}
              >
                <span
                  style={{
                    width: 48,
                    color: THEME.textTertiary,
                    opacity: 0.4,
                    userSelect: "none",
                    fontSize: 15,
                    textAlign: "right",
                    paddingRight: 20,
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </span>
                <span>
                  {tokens.map((token, j) => (
                    <span key={j} style={{ color: TOKEN_COLORS[token.type] }}>
                      {token.text}
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom callout */}
      <div
        style={{
          position: "absolute",
          bottom: 36,
          width: "100%",
          textAlign: "center",
          opacity: calloutOpacity,
          fontSize: 22,
          color: THEME.textSecondary,
          fontWeight: 700,
        }}
      >
        npm install @holdfast/sdk — full TypeScript support with Anchor IDL types
      </div>
    </AbsoluteFill>
  );
};
