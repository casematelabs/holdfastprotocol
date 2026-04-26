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
  { text: 'import { registerAgentWallet } from "@holdfastprotocol/sdk/registration";', delay: 0 },
  { text: 'import { Keypair, Connection } from "@solana/web3.js";', delay: 0.4 },
  { text: "", delay: 0.8 },
  { text: "const connection = new Connection(", delay: 1.2 },
  { text: '  "https://api.devnet.solana.com",', delay: 1.6 },
  { text: '  "confirmed"', delay: 2.0 },
  { text: ");", delay: 2.4 },
  { text: "", delay: 2.8 },
  { text: "const { agentWallet, p256PrivateKey } =", delay: 3.2 },
  { text: "  await registerAgentWallet({ connection, signer });", delay: 3.8 },
  { text: "", delay: 4.2 },
  { text: "// Save p256PrivateKey — re-derives the same PDA", delay: 4.6 },
  { text: 'writeFileSync("agent-identity.json", JSON.stringify({', delay: 5.2 },
  { text: "  agentWallet: agentWallet.toBase58(),", delay: 5.8 },
  { text: "  p256PrivateKey: Array.from(p256PrivateKey),", delay: 6.2 },
  { text: "}));", delay: 6.6 },
];

type TokenType = "keyword" | "string" | "comment" | "method" | "plain";

function tokenize(text: string): Array<{ text: string; type: TokenType }> {
  if (text.startsWith("//")) return [{ text, type: "comment" }];

  const tokens: Array<{ text: string; type: TokenType }> = [];
  const regex =
    /(\/\/.*$|"[^"]*"|'[^']*'|`[^`]*`|\b(?:import|from|const|await|new|return)\b|\.(?:toBase58|from)\b)/g;

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
  method: "#D2A8FF",
  plain: THEME.textPrimary,
};

export const OnboardingRegisterScene: React.FC = () => {
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

  const editorOpacity = interpolate(frame, [fps * 0.8, fps * 1.6], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const editorScale = interpolate(frame, [fps * 0.8, fps * 1.6], [0.96, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const calloutOpacity = interpolate(frame, [fps * 10, fps * 11.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const calloutGlow = interpolate(
    frame,
    [fps * 11.5, fps * 12.5, fps * 13.5, fps * 14.5],
    [0.4, 0.8, 0.5, 0.7],
    { extrapolateRight: "clamp" },
  );

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
          Agent Identity
        </div>
        <div
          style={{
            fontSize: 58,
            fontWeight: 900,
            color: THEME.textPrimary,
          }}
        >
          registerAgentWallet()
        </div>
      </div>

      {/* Code editor card */}
      <div
        style={{
          position: "absolute",
          top: 240,
          left: 180,
          right: 180,
          bottom: 140,
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
            register-agent.ts
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
            padding: "28px 36px",
            fontFamily: "'Courier New', monospace",
            fontSize: 18,
            lineHeight: 1.65,
          }}
        >
          {CODE_LINES.map((line, i) => {
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

            const tokens = tokenize(line.text);

            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  opacity: lineProgress,
                  minHeight: 29,
                }}
              >
                <span
                  style={{
                    width: 42,
                    color: THEME.textTertiary,
                    opacity: 0.35,
                    userSelect: "none",
                    fontSize: 14,
                    textAlign: "right",
                    paddingRight: 18,
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

      {/* Warning callout */}
      <div
        style={{
          position: "absolute",
          bottom: 40,
          left: 180,
          right: 180,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: "22px 36px",
          borderRadius: 16,
          backgroundColor: `${THEME.warning}08`,
          border: `1px solid ${THEME.warning}25`,
          opacity: calloutOpacity,
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: THEME.warning,
            boxShadow: `0 0 ${16 * calloutGlow}px ${THEME.warning}60`,
            flexShrink: 0,
          }}
        />
        <div
          style={{
            fontSize: 19,
            fontWeight: 700,
            color: THEME.warning,
          }}
        >
          Save p256PrivateKey — it is the only way to re-derive your AgentWallet
          PDA
        </div>
      </div>
    </AbsoluteFill>
  );
};
