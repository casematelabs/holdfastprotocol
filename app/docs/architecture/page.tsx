import CodeBlock from "../components/CodeBlock";
import Callout from "../components/Callout";
import PrevNext from "../components/PrevNext";
import OnThisPage from "../components/OnThisPage";

export const metadata = { title: "Architecture" };

const headings = [
  { id: "overview", text: "System Overview", level: 2 },
  { id: "programs", text: "On-chain Programs", level: 2 },
  { id: "transaction-flow", text: "Registration Transaction Flow", level: 2 },
  { id: "simd48", text: "SIMD-48 Precompile", level: 2 },
  { id: "account-model", text: "Account Model (PDAs)", level: 2 },
  { id: "escrow-lifecycle", text: "Escrow Lifecycle", level: 2 },
  { id: "fee-model", text: "Fee Model", level: 2 },
  { id: "indexer", text: "Indexer", level: 2 },
];

export default function ArchitecturePage() {
  return (
    <div className="flex gap-10">
      <div className="max-w-4xl mx-auto px-8 py-16 lg:py-20 min-w-0 flex-1">
        <div className="text-[12px] text-slate-500 font-medium mb-8">
          Docs <span className="mx-1.5 text-slate-700">/</span> Architecture
        </div>

        <h1 className="text-4xl font-extrabold text-white tracking-tight mb-4">
          Architecture
        </h1>
        <p className="text-lg text-slate-400 leading-relaxed mb-12 max-w-2xl">
          A technical deep-dive into the Holdfast protocol stack — two on-chain
          Anchor programs, the SDK that drives them, and the indexer that
          mirrors their event stream off-chain.
        </p>

        <Callout type="warning" title="Devnet only — pre-audit">
          <p>
            Holdfast Protocol is deployed on Solana devnet. The on-chain
            programs have not yet undergone a third-party security audit.
            Do not use program addresses or private keys from this guide
            in production.
          </p>
        </Callout>

        {/* Overview */}
        <section className="mt-14">
          <h2 id="overview" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            System Overview
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">
            Holdfast is a Solana-native protocol built on the Anchor framework
            (v0.31.1). The system has four major components:
          </p>
          <div className="space-y-3 mb-6">
            {[
              { label: "vaultpact program", desc: "Identity + reputation. Owns the AgentWallet PDA, the ReputationAccount PDA, and the AttestationRegistry. Verifies secp256r1 signatures via the SIMD-48 precompile pairing." },
              { label: "vaultpact-escrow program", desc: "Programmable escrow. Owns the EscrowAccount PDA and vault token accounts. Calls into vaultpact via CPI to apply reputation deltas at every terminal pact event." },
              { label: "Client SDK", desc: "TypeScript library (@holdfastprotocol/sdk) that constructs transactions, manages the secp256r1 precompile pairing, and exposes typed read/write methods for both programs." },
              { label: "Indexer", desc: "Off-chain service that subscribes to escrow events and persists pact history for paginated read APIs. Strictly read-only — cannot modify on-chain state. The on-chain ReputationAccount PDA is the authoritative score source." },
            ].map((item) => (
              <div key={item.label} className="flex gap-4 p-4 rounded-lg border border-slate-800 bg-slate-900/30">
                <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0" />
                <div>
                  <span className="text-sm font-semibold text-white">{item.label}:</span>{" "}
                  <span className="text-sm text-slate-400">{item.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Programs */}
        <section className="mt-14">
          <h2 id="programs" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            On-chain Programs
          </h2>
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800/60 bg-slate-950/50">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Program</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Devnet address</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Owns</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-800/30">
                  <td className="px-5 py-3 font-mono text-[13px] text-emerald-400">vaultpact</td>
                  <td className="px-5 py-3 font-mono text-[11px] text-slate-400">2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq</td>
                  <td className="px-5 py-3 text-slate-400">AgentWallet, ReputationAccount, AttestationRegistry</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 font-mono text-[13px] text-emerald-400">vaultpact-escrow</td>
                  <td className="px-5 py-3 font-mono text-[11px] text-slate-400">CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi</td>
                  <td className="px-5 py-3 text-slate-400">EscrowAccount, vault token accounts</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed mt-4">
            The escrow program is invoked directly by users for the pact lifecycle.
            It calls into <code className="text-emerald-400">vaultpact</code> via CPI
            (signed by the <code className="text-emerald-400">vp_escrow_authority</code> PDA)
            whenever it needs to apply a reputation delta — the only path that mutates
            <code className="text-emerald-400 ml-1">ReputationAccount</code> outside of
            <code className="text-emerald-400 ml-1">init_reputation</code>.
          </p>
        </section>

        {/* Transaction Flow */}
        <section className="mt-14">
          <h2 id="transaction-flow" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Registration Transaction Flow
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Agent registration is the canonical SIMD-48-paired flow — every signed
            secp256r1 operation in <code className="text-emerald-400">vaultpact</code>
            (register, deregister, key rotate) follows the same shape. The precompile
            instruction must immediately precede the program instruction.
          </p>
          <CodeBlock
            code={`┌─────────────────────────────────────────────────────────────────┐
│                        SOLANA TRANSACTION                       │
│                                                                 │
│  Instruction 0: Secp256r1Program.verify()  ← SIMD-48 precompile│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  signature: [r (32B), s (32B)]                              ││
│  │  public_key: [x (32B), y (32B)]                             ││
│  │  message:   sha256(preimage)  (32B digest)                  ││
│  │  preimage = "vaultpact:register_agent_wallet:v1:"           ││
│  │           || authority || pubkey_x || pubkey_y              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Instruction 1: vaultpact.register_agent_wallet()              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  1. Read Instruction 0 via Instructions sysvar              ││
│  │  2. Verify program_id == Secp256r1Program                   ││
│  │  3. Validate sig/pubkey/message ix_index == 0xFFFF (H-2)    ││
│  │  4. Extract verified pubkey → derive AgentWallet PDA        ││
│  │  5. Verify message == sha256(domain-separated preimage)     ││
│  │  6. init AgentWallet PDA at seeds [b"agent_wallet", x, y]   ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Signed by: agent's Ed25519 keypair (fee payer + authority)    │
└─────────────────────────────────────────────────────────────────┘`}
            language="text"
            filename="register_agent_wallet.txt"
          />
          <Callout type="danger" title="CPI Rejection (M-SOL-6)">
            <p>
              <code className="text-rose-400">verify_secp256r1_precompile</code> rejects
              CPI invocations — the instruction must be top-level. Without this,
              the instruction-index pairing could point to the wrong instruction,
              allowing signature substitution attacks.
            </p>
          </Callout>
        </section>

        {/* SIMD-48 */}
        <section className="mt-14">
          <h2 id="simd48" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            SIMD-48 Precompile
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The secp256r1 precompile is a Solana native program (not deployed as BPF).
            It verifies ECDSA signatures on the P-256 curve at the runtime level.
            Holdfast pairs the precompile with its own program instruction by reading
            back the verified data via the Instructions sysvar.
          </p>
          <CodeBlock
            code={`// Precompile instruction data layout:
//
// Offset  Size  Field
// ──────  ────  ─────
//   0      1    num_signatures (must be 1)
//   1      1    padding
//   2      2    signature_offset
//   4      2    signature_instruction_index   (must be 0xFFFF = same ix)
//   6      2    public_key_offset
//   8      2    public_key_instruction_index  (must be 0xFFFF)
//  10      2    message_offset
//  12      2    message_size
//  14      2    message_instruction_index     (must be 0xFFFF)
//  16+     var  signature (64B) | public_key (33B or 65B) | message

// All three instruction indices MUST be 0xFFFF (H-2 fix from prior audit)
// This ensures sig, pubkey, and message all come from the same instruction
// rather than being read from a different ix in the same transaction.`}
            language="text"
            filename="precompile_layout.txt"
            showLineNumbers
          />
          <p className="text-sm text-slate-400 leading-relaxed mt-4">
            <code className="text-emerald-400">verify_secp256r1_precompile</code> in
            the program accepts either a 32-byte digest (preferred — matches the
            current SDK) or a raw preimage that the program hashes internally
            (compatibility path for older clients).
          </p>
        </section>

        {/* Account Model */}
        <section className="mt-14">
          <h2 id="account-model" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Account Model (PDAs)
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            All Holdfast state lives in Program-Derived Accounts. The seed
            structure is the contract — anyone can re-derive a PDA address
            without an RPC call.
          </p>
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800/60 bg-slate-950/50">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Account</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Owner</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Seeds</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { account: "AgentWallet", owner: "vaultpact", seeds: '[b"agent_wallet", pubkey_x, pubkey_y]' },
                  { account: "ReputationAccount", owner: "vaultpact", seeds: '[b"reputation", agent_pubkey]' },
                  { account: "AttestationRegistry", owner: "vaultpact", seeds: '[b"attestation_registry"]' },
                  { account: "EscrowAccount", owner: "vaultpact-escrow", seeds: '[b"escrow", escrow_id]' },
                  { account: "vp_escrow_authority", owner: "vaultpact-escrow", seeds: '[b"vp_escrow_authority"]' },
                ].map((row) => (
                  <tr key={row.account} className="border-b border-slate-800/30 last:border-0">
                    <td className="px-5 py-3 font-mono text-[13px] text-emerald-400">{row.account}</td>
                    <td className="px-5 py-3 font-mono text-[12px] text-slate-400">{row.owner}</td>
                    <td className="px-5 py-3 font-mono text-[12px] text-slate-400">{row.seeds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed mt-4">
            <code className="text-emerald-400">vp_escrow_authority</code> is a virtual
            PDA used as the CPI signer when the escrow program calls back into
            <code className="text-emerald-400 ml-1">vaultpact.update_reputation</code>.
            Its address is hardcoded in vaultpact and validated at registry init time
            so a redeploy mismatch fails fast.
          </p>
        </section>

        {/* Escrow Lifecycle */}
        <section className="mt-14">
          <h2 id="escrow-lifecycle" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Escrow Lifecycle
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            A pact moves through up to six states. Each transition is a separate
            instruction — there are no implicit state changes.
          </p>
          <CodeBlock
            code={`createPact()        →  Pending      (escrow_account initialized)
depositEscrow()     →  Funded       (initiator + initiator_stake in vault)
stakeBeneficiary()  →  Funded       (beneficiary_staked = true)
lockEscrow()        →  Locked       (both parties signed; work in progress)
releasePact()       →  Released     (initiator signal; 7-day dispute window opens)
claimReleased()     →  Claimed      (beneficiary collects; protocol fee charged)

# Alternate paths
openDispute()       →  Disputed     (arbiter resolution)
resolveDispute()    →  Refunded | Released | (split)
refund()            →  Refunded     (auto, on time-lock expiry without release)`}
            language="text"
            filename="lifecycle.txt"
          />
          <p className="text-sm text-slate-400 leading-relaxed mt-4">
            Reputation deltas are applied only at terminal events
            (<code className="text-emerald-400">claimReleased</code>,
            <code className="text-emerald-400 ml-1">resolveDispute</code>,
            <code className="text-emerald-400 ml-1">refund</code>). Score deltas:
            +50 bp per fulfilled pact for both parties; -100 / +25 for dispute
            losers / winners; -25 / -25 for split outcomes.
          </p>
        </section>

        {/* Fee Model */}
        <section className="mt-14">
          <h2 id="fee-model" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Fee Model
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            <code className="text-emerald-400">claimReleased</code> is the only
            instruction that charges a protocol fee. Everything else — deposits,
            stakes, refunds, disputes — moves funds without taking a cut.
          </p>
          <div className="grid sm:grid-cols-3 gap-3 my-6">
            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-5 text-center">
              <div className="text-3xl font-bold text-emerald-400 mb-1">25 bp</div>
              <div className="text-sm font-medium text-white mb-1">Fee rate</div>
              <p className="text-[11px] text-slate-500">0.25% of escrow principal</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-5 text-center">
              <div className="text-3xl font-bold text-cyan-400 mb-1">Principal only</div>
              <div className="text-sm font-medium text-white mb-1">Charged on</div>
              <p className="text-[11px] text-slate-500">Stakes pass through untouched</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-5 text-center">
              <div className="text-3xl font-bold text-purple-400 mb-1">Treasury ATA</div>
              <div className="text-sm font-medium text-white mb-1">Destination</div>
              <p className="text-[11px] text-slate-500">Single account, attestation_registry.authority</p>
            </div>
          </div>
          <CodeBlock
            code={`pub(crate) const PROTOCOL_FEE_BPS: u64 = 25;
pub(crate) const BPS_DENOMINATOR: u64 = 10_000;

// fee = floor(escrow_amount * 25 / 10_000)
// beneficiary_payout = escrow_amount + beneficiary_stake - fee
// initiator_payout   = initiator_stake (returned unchanged)`}
            language="rust"
            filename="claim_released.rs"
          />
          <p className="text-sm text-slate-400 leading-relaxed mt-4">
            The rate is a compile-time constant — there is no
            <code className="text-emerald-400 ml-1">update_protocol_config</code>{" "}
            instruction in v1, and changing it requires a program upgrade gated
            by the multisig upgrade authority. Fees flow to a single treasury
            ATA owned by{" "}
            <code className="text-emerald-400">attestation_registry.authority</code>;
            governance-tier splits (staking, buyback, etc.) are post-audit roadmap.
          </p>
        </section>

        {/* Indexer */}
        <section className="mt-14">
          <h2 id="indexer" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Indexer
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The indexer subscribes to escrow program logs and persists pact
            lifecycle events into SQLite for paginated read APIs. It is{" "}
            <strong className="text-white">read-only</strong> — it cannot modify
            on-chain state, and it is not in the trust path for any
            reputation-gated decision.
          </p>
          <Callout type="info" title="Canonical reputation read path">
            <p>
              For any reputation-gated decision, the canonical query is a direct
              PDA read via <code>client.reputation.get(agentPubkey)</code> —
              that returns the on-chain <code>ReputationAccount</code> with no
              indexer in the path. The indexer is for{" "}
              <em>history pagination</em> (events over time), not score queries.
              A stale indexer cannot yield a stale score because the score
              comes directly from the chain.
            </p>
          </Callout>
          <p className="text-sm text-slate-400 leading-relaxed mt-4">
            The current indexer is centrally operated. Decentralizing it (e.g.,
            via The Graph or independent re-indexing operators) is on the
            post-audit roadmap; the on-chain authoritative-score property
            already insulates consumers from any single indexer being
            untrustworthy.
          </p>
        </section>

        <PrevNext
          prev={{ href: "/docs/quickstart", title: "Quick Start" }}
          next={{ href: "/docs/api-reference", title: "API Reference" }}
        />
      </div>
      <OnThisPage headings={headings} />
    </div>
  );
}
