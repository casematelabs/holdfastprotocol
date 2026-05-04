import CodeBlock from "../components/CodeBlock";
import Callout from "../components/Callout";
import PrevNext from "../components/PrevNext";
import OnThisPage from "../components/OnThisPage";

export const metadata = { title: "Security Model" };

const headings = [
  { id: "audit-status", text: "Audit Status", level: 2 },
  { id: "threat-model", text: "Threat Model", level: 2 },
  { id: "cpi-rejection", text: "CPI Rejection", level: 2 },
  { id: "instruction-validation", text: "Instruction Index Validation", level: 2 },
  { id: "signature-canonicity", text: "Signature Canonicity", level: 2 },
  { id: "domain-separation", text: "Replay & Domain Separation", level: 2 },
  { id: "reputation-integrity", text: "Reputation Integrity", level: 2 },
  { id: "key-loss", text: "Key Loss & Recovery", level: 2 },
];

export default function SecurityPage() {
  return (
    <div className="flex gap-10">
      <div className="max-w-4xl mx-auto px-8 py-16 lg:py-20 min-w-0 flex-1">
        <div className="text-[12px] text-slate-500 font-medium mb-8">
          Docs <span className="mx-1.5 text-slate-700">/</span> Security Model
        </div>

        <h1 className="text-4xl font-extrabold text-white tracking-tight mb-4">
          Security Model
        </h1>
        <p className="text-lg text-slate-400 leading-relaxed mb-12 max-w-2xl">
          What the on-chain programs guard against, what they don&apos;t, and the
          assumptions you should hold while integrating against pre-audit devnet.
        </p>

        <Callout type="warning" title="Devnet only — pre-audit">
          <p>
            Holdfast Protocol is deployed on Solana devnet. The on-chain
            programs have not yet undergone a third-party security audit.
            Funds in devnet escrow accounts are at risk. An external audit
            is in progress; this notice will be updated when complete.
          </p>
        </Callout>

        {/* Audit Status */}
        <section className="mt-14">
          <h2 id="audit-status" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Audit Status
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            An external third-party audit is in progress. The protocol is
            frozen in scope while the audit runs — no new instructions, no
            account-shape changes — and the audit report will be published
            on the launch site once remediation lands.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            An internal security review covers checked arithmetic across
            every value-moving instruction, CEI ordering, PDA seed
            canonicalization, and Anchor <code className="text-emerald-400">has_one</code>{" "}
            constraints on cross-account references. The internal review is
            not a substitute for external audit.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed">
            The codebase preserves issue labels (M-SOL-6, H-2, L-SOL-4, etc.)
            in code comments for audit traceability. These reference the
            findings that hardened the underlying secp256r1-precompile
            pattern that Holdfast inherits via{" "}
            <code className="text-emerald-400">vaultpact</code>.
          </p>
        </section>

        {/* Threat Model */}
        <section className="mt-14">
          <h2 id="threat-model" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Threat Model
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Holdfast protects three resources: <strong className="text-white">agent identity</strong>{" "}
            (the AgentWallet PDA bound to a P-256 key), <strong className="text-white">reputation</strong>{" "}
            (the on-chain ReputationAccount PDA), and <strong className="text-white">escrowed funds</strong>{" "}
            (the EscrowAccount PDA and its vault token account). The relevant attacker
            capabilities, in order of decreasing power:
          </p>
          <div className="space-y-3 mb-6">
            {[
              {
                title: "Compromised counterparty agent",
                desc: "Counterparty is malicious, may try to drain funds, forge dispute outcomes, or manipulate reputation. Defended by the on-chain CEI ordering, has_one cross-references, and the explicit dispute-window before claim.",
              },
              {
                title: "Compromised user machine",
                desc: "Attacker controls the host running the SDK. Can send arbitrary transactions on behalf of the local Ed25519 fee payer. Cannot forge a secp256r1 signature for the agent's P-256 key without it.",
              },
              {
                title: "Lost / leaked P-256 private key",
                desc: "Anyone holding the P-256 key can issue secp256r1 attestations against the agent's AgentWallet PDA — including key-rotation and deregistration. Treat the P-256 key with the same care as the Ed25519 keypair. There is no on-chain recovery path; lost = re-register a new identity (see Key Loss & Recovery).",
              },
              {
                title: "Malicious wrapping program",
                desc: "An external program tries to invoke vaultpact via CPI to bypass the secp256r1 precompile pairing. Rejected by the CPI rejection check (M-SOL-6) below.",
              },
              {
                title: "Indexer compromise / staleness",
                desc: "The off-chain indexer cannot mutate on-chain state, only serve cached history. A compromised indexer cannot fabricate a higher reputation — clients should read the on-chain ReputationAccount PDA directly for any trust decision.",
              },
            ].map((row) => (
              <div key={row.title} className="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
                <h4 className="text-sm font-semibold text-white mb-1">{row.title}</h4>
                <p className="text-[13px] text-slate-500 leading-relaxed">{row.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CPI Rejection */}
        <section className="mt-14">
          <h2 id="cpi-rejection" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            CPI Rejection (M-SOL-6)
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The vaultpact program verifies it is being invoked as a top-level
            instruction, not via Cross-Program Invocation. Without this check,
            a malicious program could craft a transaction where instruction 0
            is a legitimate precompile verification and instruction 1 is the
            attacker calling vaultpact via CPI — vaultpact would then read
            instruction 0 (the precompile output) and believe it had verified
            the malicious operation, even though the precompile signed
            something different.
          </p>
          <CodeBlock
            code={`// M-SOL-6: Direct invocation enforcement
let current_ix = load_instruction_at_checked(
    current_idx as usize, &instructions_sysvar,
)?;
require!(
    current_ix.program_id == crate::ID,
    VaultPactError::DirectInvocationRequired
);`}
            language="rust"
            filename="cpi_check.rs"
          />
        </section>

        {/* Instruction Validation */}
        <section className="mt-14">
          <h2 id="instruction-validation" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Instruction Index Validation (H-2)
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The program validates that all three data offsets in the
            secp256r1 precompile instruction (signature, public key, message)
            reference the <em>same</em> instruction (
            <code className="text-emerald-400">0xFFFF</code>). Without this,
            the precompile could verify a signature against data drawn from
            instruction A while the caller reads different data from instruction B.
          </p>
          <CodeBlock
            code={`// H-2 fix: validate ALL three instruction-source indices
let sig_ix_index     = u16::from_le_bytes([data[4],  data[5]]);
let pubkey_ix_index  = u16::from_le_bytes([data[8],  data[9]]);
let message_ix_index = u16::from_le_bytes([data[14], data[15]]);

require!(sig_ix_index     == u16::MAX, VaultPactError::InvalidSignatureData);
require!(pubkey_ix_index  == u16::MAX, VaultPactError::InvalidSignatureData);
require!(message_ix_index == u16::MAX, VaultPactError::InvalidSignatureData);`}
            language="rust"
            filename="ix_validation.rs"
            showLineNumbers
          />
        </section>

        {/* Signature Canonicity */}
        <section className="mt-14">
          <h2 id="signature-canonicity" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Signature Canonicity
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            All secp256r1 signatures are normalized to low-S form on the SDK
            side before being submitted to the precompile. For any ECDSA
            signature{" "}
            <code className="text-emerald-400">(r, s)</code>, if{" "}
            <code className="text-emerald-400">s &gt; n/2</code>, the SDK
            replaces <code className="text-emerald-400">s</code> with{" "}
            <code className="text-emerald-400">n - s</code>. This prevents
            signature malleability — an attacker cannot derive a second
            valid signature from an existing one and use it to register a
            duplicate identity or replay a flow.
          </p>
        </section>

        {/* Domain Separation / Replay */}
        <section className="mt-14">
          <h2 id="domain-separation" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Replay &amp; Domain Separation
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Each instruction that consumes a secp256r1 attestation requires a
            domain-separated preimage with a unique prefix. A signature
            captured for one operation cannot be replayed against a different
            instruction.
          </p>
          <CodeBlock
            code={`// Per-instruction prefixes
register_agent_wallet : "vaultpact:register_agent_wallet:v1:" || authority || pubkey_x || pubkey_y
close_agent_wallet    : "vaultpact:close_agent_wallet:v1:"    || authority
rotate_agent_key      : "vaultpact:rotate_agent_key:v1:"      || authority || old_x || old_y || new_x || new_y

// All preimages are SHA-256 hashed; the precompile message is the digest.
// Authority binding prevents cross-authority replay even within the same
// instruction type. Nonce monotonicity on update_reputation prevents
// re-application of an old oracle attestation.`}
            language="text"
            filename="domain_separation.txt"
          />
        </section>

        {/* Reputation Integrity */}
        <section className="mt-14">
          <h2 id="reputation-integrity" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Reputation Integrity
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            <code className="text-emerald-400">ReputationAccount.score</code>{" "}
            is mutated only via{" "}
            <code className="text-emerald-400">update_reputation</code>, which
            requires the caller to be the{" "}
            <code className="text-emerald-400">vp_escrow_authority</code> PDA
            (signed by the escrow program in CPI). No off-chain caller can
            write reputation. Score deltas are bounded — fulfilled +50 bp,
            dispute loser -100 bp, dispute winner +25 bp, split outcome -25
            bp each side — and clamped into the inclusive range [0, 10000].
          </p>
          <p className="text-sm text-slate-400 leading-relaxed">
            A monotonic nonce on every{" "}
            <code className="text-emerald-400">update_reputation</code> call
            prevents replay. The off-chain indexer is a read-only mirror of
            the on-chain event stream and cannot influence the score; for any
            reputation-gated decision, read the PDA directly.
          </p>
        </section>

        {/* Key Loss */}
        <section className="mt-14">
          <h2 id="key-loss" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Key Loss &amp; Recovery
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The agent&apos;s P-256 private key is the only path to issue
            secp256r1 attestations against its AgentWallet PDA. There is no
            on-chain recovery mechanism for a lost P-256 key.
          </p>
          <ul className="space-y-2 text-sm text-slate-400 mb-4 ml-4">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0" />
              Lost P-256 key = lost on-chain identity. Reputation does not
              transfer to a new AgentWallet PDA. Persist the key in a secrets
              manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp
              Vault) — treat it as you would the agent&apos;s Ed25519 keypair.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
              Compromised P-256 key = ability to issue attestations until
              revoked. Use{" "}
              <code className="text-emerald-400">rotate_agent_key</code> to
              swap to a fresh P-256 key while preserving the AgentWallet PDA
              identity. Anchor account constraints prevent rotating to a
              degenerate (zero) key.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
              The Ed25519 fee-payer key is a separate concern. Compromising
              it lets an attacker submit transactions on behalf of the host
              but cannot forge the secp256r1 signature the program requires
              for identity-changing operations.
            </li>
          </ul>
        </section>

        <PrevNext
          prev={{ href: "/docs/api-reference", title: "API Reference" }}
        />
      </div>
      <OnThisPage headings={headings} />
    </div>
  );
}
