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

const STATES = [
  { label: "Pending", description: "Initialize escrow on-chain" },
  { label: "Funded", description: "Deposit + beneficiary stakes" },
  { label: "Locked", description: "Dual-signature commitment" },
  { label: "Released", description: "7-day dispute window opens" },
  { label: "Claimed", description: "Funds transferred + reputation" },
];

const CODE_STEPS = [
  {
    lines: [
      { text: "const escrow = await client.escrow.createPact({", indent: 0 },
      { text: "  counterparty, counterpartyWallet,", indent: 0 },
      { text: "  mint: USDC_DEVNET,", indent: 0 },
      { text: "  amount: 1_000_000n, // 1 USDC", indent: 0 },
      { text: "  releaseCondition: {", indent: 0 },
      { text: '    kind: "task",', indent: 0 },
      { text: "    timeLockExpiresAt:", indent: 0 },
      { text: "      Math.floor(Date.now() / 1000) + 7 * 24 * 3600,", indent: 0 },
      { text: "  },", indent: 0 },
      { text: "});", indent: 0 },
    ],
  },
  {
    lines: [
      { text: "await client.escrow.depositEscrow(escrowId);", indent: 0 },
      { text: "", indent: 0 },
      { text: "// Beneficiary must stake before lock", indent: 0 },
      { text: "await beneficiaryClient.escrow", indent: 0 },
      { text: "  .stakeBeneficiary(escrowId);", indent: 0 },
    ],
  },
  {
    lines: [
      { text: "// Both parties must sign lockEscrow", indent: 0 },
      { text: "await client.escrow.lockEscrow(", indent: 0 },
      { text: "  escrowId,", indent: 0 },
      { text: "  beneficiarySigner,", indent: 0 },
      { text: "  beneficiaryWallet,", indent: 0 },
      { text: ");", indent: 0 },
    ],
  },
  {
    lines: [
      { text: "// Initiator releases on fulfillment", indent: 0 },
      { text: "await client.escrow.releasePact(escrowId);", indent: 0 },
    ],
  },
  {
    lines: [
      { text: "// After dispute window closes...", indent: 0 },
      { text: "await beneficiaryClient.escrow", indent: 0 },
      { text: "  .claimReleased(escrowId, initiatorPubkey);", indent: 0 },
      { text: "", indent: 0 },
      { text: "// Both parties get +50 reputation bp", indent: 0 },
    ],
  },
];

type TokenType = "keyword" | "string" | "comment" | "method" | "number" | "plain";

function tokenize(text: string): Array<{ text: string; type: TokenType }> {
  if (text.startsWith("//")) return [{ text, type: "comment" }];

  const tokens: Array<{ text: string; type: TokenType }> = [];
  const regex =
    /(\/\/.*$|"[^"]*"|'[^']*'|`[^`]*`|\b(?:import|from|const|await|new|return|Math)\b|\.(?:createPact|depositEscrow|stakeBeneficiary|lockEscrow|releasePact|claimReleased|escrow)\b|\b(?:\d[\d_,.]*)\b)/g;

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
    else if (/^(?:import|from|const|await|new|return|Math)$/.test(m))
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
  method: "#D2A8FF",
  number: "#79C0FF",
  plain: THEME.textPrimary,
};

export const OnboardingPactScene: React.FC = () => {
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

  // Step duration: 4.5s each
  const stepDuration = fps * 4.5;
  const activeStep = Math.min(
    Math.floor(frame / stepDuration),
    STATES.length - 1,
  );

  const codeOpacity = interpolate(
    frame,
    [fps * 1, fps * 1.8],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const codeScale = interpolate(frame, [fps * 1, fps * 1.8], [0.96, 1], {
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
          top: 55,
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
          Walkthrough
        </div>
        <div
          style={{
            fontSize: 52,
            fontWeight: 900,
            color: THEME.textPrimary,
          }}
        >
          From Zero to First Pact
        </div>
      </div>

      {/* State timeline */}
      <div
        style={{
          position: "absolute",
          top: 240,
          left: 100,
          right: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 0,
        }}
      >
        {STATES.map((state, i) => {
          const isActive = i === activeStep;
          const isDone = i < activeStep;

          const dotColor = isDone
            ? THEME.success
            : isActive
              ? THEME.accent
              : THEME.textTertiary;

          const dotScale = interpolate(
            frame,
            [i * stepDuration, i * stepDuration + fps * 0.5],
            [1, 1.3],
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
                gap: 0,
              }}
            >
              {/* Node */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: isActive ? 20 : 16,
                    height: isActive ? 20 : 16,
                    borderRadius: "50%",
                    backgroundColor: isDone
                      ? THEME.success
                      : isActive
                        ? THEME.accent
                        : THEME.bgCard,
                    border: `2px solid ${dotColor}`,
                    transform: isActive ? `scale(${dotScale})` : undefined,
                    boxShadow: isActive
                      ? `0 0 16px ${THEME.accent}50`
                      : isDone
                        ? `0 0 8px ${THEME.success}30`
                        : undefined,
                    transition: "background-color 0.3s ease",
                  }}
                />
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: isActive ? 700 : 400,
                    color: isActive
                      ? THEME.accent
                      : isDone
                        ? THEME.textSecondary
                        : THEME.textTertiary,
                    textAlign: "center",
                    whiteSpace: "nowrap",
                  }}
                >
                  {state.label}
                </div>
              </div>

              {/* Connector line */}
              {i < STATES.length - 1 && (
                <div
                  style={{
                    width: 100,
                    height: 2,
                    margin: "0 8px 24px",
                    background: isDone
                      ? THEME.success
                      : THEME.border,
                    opacity: isDone ? 0.6 : 0.3,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Active step description */}
      <div
        style={{
          position: "absolute",
          top: 310,
          width: "100%",
          textAlign: "center",
          fontSize: 18,
          color: THEME.textSecondary,
        }}
      >
        {STATES[activeStep].description}
      </div>

      {/* Code block */}
      <div
        style={{
          position: "absolute",
          top: 370,
          left: 240,
          right: 240,
          bottom: 56,
          borderRadius: 20,
          backgroundColor: THEME.bgCard,
          border: `1px solid ${THEME.border}`,
          opacity: codeOpacity,
          transform: `scale(${codeScale})`,
          overflow: "hidden",
        }}
      >
        {/* Editor top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 24px",
            borderBottom: `1px solid ${THEME.border}`,
            backgroundColor: THEME.bgCardRaised,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <div
              style={{
                width: 13,
                height: 13,
                borderRadius: "50%",
                backgroundColor: THEME.danger,
                opacity: 0.7,
              }}
            />
            <div
              style={{
                width: 13,
                height: 13,
                borderRadius: "50%",
                backgroundColor: THEME.warning,
                opacity: 0.7,
              }}
            />
            <div
              style={{
                width: 13,
                height: 13,
                borderRadius: "50%",
                backgroundColor: THEME.success,
                opacity: 0.7,
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
            pact-flow.ts
          </div>
        </div>

        {/* Code content */}
        <div
          style={{
            padding: "24px 32px",
            fontFamily: "'Courier New', monospace",
            fontSize: 17,
            lineHeight: 1.7,
          }}
        >
          {CODE_STEPS[activeStep].lines.map((line, i) => {
            const lineStart = frame % stepDuration;
            const lineProgress = interpolate(
              lineStart,
              [i * fps * 0.15, i * fps * 0.15 + fps * 0.3],
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
                  minHeight: 28,
                  paddingLeft: line.indent * 20,
                }}
              >
                {tokens.map((token, j) => (
                  <span key={j} style={{ color: TOKEN_COLORS[token.type] }}>
                    {token.text}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
