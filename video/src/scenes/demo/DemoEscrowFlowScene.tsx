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

const PHASE_START = {
  create: 3,
  deposit: 10,
  lock: 18,
  release: 26,
};

const phases = [
  {
    key: "create",
    num: "1",
    title: "Create Pact",
    desc: "Agent A initiates an escrow pact with terms, deadline, and arbiter",
    color: THEME.accent,
    statusLabel: "CREATED",
  },
  {
    key: "deposit",
    num: "2",
    title: "Deposit Funds",
    desc: "SOL deposited into the escrow vault PDA — funds locked on-chain",
    color: THEME.warning,
    statusLabel: "FUNDED",
  },
  {
    key: "lock",
    num: "3",
    title: "Lock & Execute",
    desc: "Agent B fulfills the task. Both parties stake reputation on outcome",
    color: THEME.hardline,
    statusLabel: "LOCKED",
  },
  {
    key: "release",
    num: "4",
    title: "Release / Settle",
    desc: "Funds release to fulfiller. Reputation scores update. Pact complete",
    color: THEME.success,
    statusLabel: "SETTLED",
  },
];

export const DemoEscrowFlowScene: React.FC = () => {
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

  const agentAX = 260;
  const agentBX = 1660;
  const vaultX = 960;
  const diagramY = 440;

  const agentAOpacity = interpolate(frame, [fps * 1.5, fps * 2.3], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const agentBOpacity = interpolate(frame, [fps * 2, fps * 2.8], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const vaultOpacity = interpolate(frame, [fps * 2.5, fps * 3.3], [0, 1], {
    easing: Easing.bezier(0.34, 1.56, 0.64, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const activePhaseIndex =
    frame >= fps * PHASE_START.release
      ? 3
      : frame >= fps * PHASE_START.lock
        ? 2
        : frame >= fps * PHASE_START.deposit
          ? 1
          : frame >= fps * PHASE_START.create
            ? 0
            : -1;

  const arrowAToVault = interpolate(
    frame,
    [fps * PHASE_START.deposit, fps * (PHASE_START.deposit + 2)],
    [0, 1],
    {
      easing: Easing.bezier(0.45, 0, 0.55, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const arrowVaultToB = interpolate(
    frame,
    [fps * PHASE_START.release, fps * (PHASE_START.release + 2)],
    [0, 1],
    {
      easing: Easing.bezier(0.45, 0, 0.55, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const vaultGlowColor =
    activePhaseIndex >= 3
      ? THEME.success
      : activePhaseIndex >= 2
        ? THEME.hardline
        : activePhaseIndex >= 1
          ? THEME.warning
          : THEME.gold;

  const lockIconOpacity = interpolate(
    frame,
    [fps * PHASE_START.lock, fps * (PHASE_START.lock + 1)],
    [0, 1],
    {
      easing: Easing.bezier(0.34, 1.56, 0.64, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const checkmarkOpacity = interpolate(
    frame,
    [fps * (PHASE_START.release + 2), fps * (PHASE_START.release + 3)],
    [0, 1],
    {
      easing: Easing.bezier(0.34, 1.56, 0.64, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const particleAX =
    frame >= fps * PHASE_START.deposit && frame < fps * PHASE_START.lock
      ? interpolate(
          frame % Math.round(fps * 1.2),
          [0, fps * 1.2],
          [agentAX + 100, vaultX - 90],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )
      : -200;

  const particleBX =
    frame >= fps * PHASE_START.release
      ? interpolate(
          frame % Math.round(fps * 1.2),
          [0, fps * 1.2],
          [vaultX + 90, agentBX - 100],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )
      : -200;

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
          Live Escrow Flow
        </div>
        <div
          style={{
            fontSize: 58,
            fontWeight: 900,
            color: THEME.textPrimary,
          }}
        >
          Pact Lifecycle on Solana
        </div>
      </div>

      {/* Agent A */}
      <div
        style={{
          position: "absolute",
          left: agentAX - 90,
          top: diagramY - 90,
          width: 180,
          height: 180,
          borderRadius: "50%",
          backgroundColor: THEME.bgCardRaised,
          border: `3px solid ${THEME.accent}60`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: agentAOpacity,
          boxShadow: `0 0 50px ${THEME.accent}20`,
        }}
      >
        <div style={{ fontSize: 52 }}>🤖</div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: THEME.accent,
            marginTop: 4,
          }}
        >
          Agent A
        </div>
        <div
          style={{
            fontSize: 13,
            color: THEME.textTertiary,
            marginTop: 2,
          }}
        >
          Initiator
        </div>
      </div>

      {/* Agent B */}
      <div
        style={{
          position: "absolute",
          left: agentBX - 90,
          top: diagramY - 90,
          width: 180,
          height: 180,
          borderRadius: "50%",
          backgroundColor: THEME.bgCardRaised,
          border: `3px solid ${THEME.success}60`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: agentBOpacity,
          boxShadow: `0 0 50px ${THEME.success}20`,
        }}
      >
        <div style={{ fontSize: 52 }}>🤖</div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: THEME.success,
            marginTop: 4,
          }}
        >
          Agent B
        </div>
        <div
          style={{
            fontSize: 13,
            color: THEME.textTertiary,
            marginTop: 2,
          }}
        >
          Fulfiller
        </div>
      </div>

      {/* Escrow Vault */}
      <div
        style={{
          position: "absolute",
          left: vaultX - 100,
          top: diagramY - 110,
          width: 200,
          height: 220,
          borderRadius: 28,
          background: `linear-gradient(180deg, ${THEME.bgCardRaised}, ${THEME.bgCard})`,
          border: `2px solid ${vaultGlowColor}40`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: vaultOpacity,
          transform: `scale(${vaultOpacity})`,
          boxShadow: `0 0 80px ${vaultGlowColor}15`,
        }}
      >
        <LogoMark size={56} color={vaultGlowColor} />
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: vaultGlowColor,
            marginTop: 10,
            letterSpacing: 3,
          }}
        >
          ESCROW VAULT
        </div>

        {/* Lock icon overlay */}
        {activePhaseIndex >= 2 && activePhaseIndex < 3 && (
          <div
            style={{
              position: "absolute",
              top: -16,
              right: -16,
              width: 40,
              height: 40,
              borderRadius: "50%",
              backgroundColor: THEME.hardline,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              opacity: lockIconOpacity,
              transform: `scale(${lockIconOpacity})`,
              boxShadow: `0 0 20px ${THEME.hardline}60`,
            }}
          >
            🔒
          </div>
        )}

        {/* Checkmark overlay */}
        {activePhaseIndex >= 3 && (
          <div
            style={{
              position: "absolute",
              top: -16,
              right: -16,
              width: 40,
              height: 40,
              borderRadius: "50%",
              backgroundColor: THEME.success,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              opacity: checkmarkOpacity,
              transform: `scale(${checkmarkOpacity})`,
              boxShadow: `0 0 20px ${THEME.success}60`,
            }}
          >
            ✓
          </div>
        )}

        {/* Status label */}
        {activePhaseIndex >= 0 && (
          <div
            style={{
              marginTop: 12,
              padding: "4px 14px",
              borderRadius: 8,
              backgroundColor: `${phases[activePhaseIndex].color}20`,
              border: `1px solid ${phases[activePhaseIndex].color}40`,
              fontSize: 12,
              fontWeight: 700,
              color: phases[activePhaseIndex].color,
              letterSpacing: 2,
              opacity: interpolate(
                frame,
                [
                  fps * PHASE_START[phases[activePhaseIndex].key as keyof typeof PHASE_START],
                  fps * PHASE_START[phases[activePhaseIndex].key as keyof typeof PHASE_START] + fps * 0.5,
                ],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              ),
            }}
          >
            {phases[activePhaseIndex].statusLabel}
          </div>
        )}
      </div>

      {/* Arrow A → Vault */}
      <svg
        style={{
          position: "absolute",
          left: agentAX + 90,
          top: diagramY - 3,
          width: vaultX - agentAX - 190,
          height: 6,
        }}
      >
        <rect
          x={0}
          y={0}
          width={`${arrowAToVault * 100}%`}
          height={6}
          rx={3}
          fill={THEME.warning}
          opacity={0.8}
        />
      </svg>

      {/* Arrow Vault → B */}
      <svg
        style={{
          position: "absolute",
          left: vaultX + 100,
          top: diagramY - 3,
          width: agentBX - vaultX - 190,
          height: 6,
        }}
      >
        <rect
          x={0}
          y={0}
          width={`${arrowVaultToB * 100}%`}
          height={6}
          rx={3}
          fill={THEME.success}
          opacity={0.8}
        />
      </svg>

      {/* Flow particle A → Vault */}
      {particleAX > 0 && (
        <div
          style={{
            position: "absolute",
            left: particleAX - 8,
            top: diagramY - 8,
            width: 16,
            height: 16,
            borderRadius: "50%",
            backgroundColor: THEME.warning,
            boxShadow: `0 0 20px ${THEME.warning}`,
          }}
        />
      )}

      {/* Flow particle Vault → B */}
      {particleBX > 0 && (
        <div
          style={{
            position: "absolute",
            left: particleBX - 8,
            top: diagramY - 8,
            width: 16,
            height: 16,
            borderRadius: "50%",
            backgroundColor: THEME.success,
            boxShadow: `0 0 20px ${THEME.success}`,
          }}
        />
      )}

      {/* Phase cards at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 24,
          padding: "0 80px",
        }}
      >
        {phases.map((phase, i) => {
          const phaseStartSec =
            PHASE_START[phase.key as keyof typeof PHASE_START];
          const phaseDelay = fps * phaseStartSec;
          const phaseProgress = interpolate(
            frame,
            [phaseDelay, phaseDelay + fps * 0.6],
            [0, 1],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );
          const phaseY = interpolate(
            frame,
            [phaseDelay, phaseDelay + fps * 0.6],
            [20, 0],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );

          const isActive = i === activePhaseIndex;
          const isPast = i < activePhaseIndex;

          return (
            <div
              key={i}
              style={{
                flex: 1,
                padding: "24px 20px",
                borderRadius: 18,
                backgroundColor: isActive
                  ? `${phase.color}12`
                  : THEME.bgCard,
                border: `2px solid ${isActive ? `${phase.color}50` : isPast ? `${phase.color}25` : `${phase.color}12`}`,
                opacity: phaseProgress,
                transform: `translateY(${phaseY}px)`,
                transition: "border-color 0.3s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    backgroundColor: isPast
                      ? phase.color
                      : `${phase.color}20`,
                    color: isPast ? "#fff" : phase.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    fontWeight: 900,
                  }}
                >
                  {isPast ? "✓" : phase.num}
                </div>
                {isActive && (
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: phase.color,
                      boxShadow: `0 0 12px ${phase.color}`,
                    }}
                  />
                )}
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: isActive
                    ? phase.color
                    : THEME.textPrimary,
                  marginBottom: 6,
                }}
              >
                {phase.title}
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: THEME.textSecondary,
                  lineHeight: 1.4,
                }}
              >
                {phase.desc}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
