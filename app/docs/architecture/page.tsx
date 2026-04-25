import CodeBlock from "../components/CodeBlock";
import Callout from "../components/Callout";
import PrevNext from "../components/PrevNext";
import OnThisPage from "../components/OnThisPage";

export const metadata = { title: "Architecture" };

const headings = [
  { id: "overview", text: "System Overview", level: 2 },
  { id: "transaction-flow", text: "Transaction Flow", level: 2 },
  { id: "simd48", text: "SIMD-48 Precompile", level: 2 },
  { id: "account-model", text: "Account Model", level: 2 },
  { id: "fee-model", text: "Fee Model", level: 2 },
  { id: "evm-bridge", text: "EVM Bridge (ERC-4337)", level: 2 },
  { id: "indexer", text: "Trust Indexer", level: 2 },
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
          A technical deep-dive into how the Holdfast protocol stack is built,
          from the Solana runtime up through the Trust indexer.
        </p>

        {/* Overview */}
        <section>
          <h2 id="overview" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            System Overview
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">
            Holdfast is a Solana-native protocol built on the Anchor framework (v0.30.1).
            The system comprises four major components:
          </p>
          <div className="space-y-3 mb-6">
            {[
              { label: "Solana Program", desc: "On-chain Anchor program handling vault lifecycle, escrow, and trust data. Deployed at a fixed program ID." },
              { label: "SIMD-48 Precompile", desc: "Native Solana precompile for secp256r1 signature verification. Runs in native code, not BPF -- effectively free in compute units." },
              { label: "Client SDK", desc: "TypeScript library that constructs transactions, handles WebAuthn assertions, and manages the precompile pairing." },
              { label: "Trust Indexer", desc: "Off-chain service that indexes on-chain events into queryable reputation scores. Read-only -- cannot modify chain state." },
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

        {/* Transaction Flow */}
        <section className="mt-14">
          <h2 id="transaction-flow" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Transaction Flow
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Every signed vault operation follows this precise sequence. The two-instruction
            pattern is critical for security -- the precompile must immediately precede
            the vault instruction.
          </p>
          <CodeBlock
            code={`┌─────────────────────────────────────────────────────────────────┐
│                        SOLANA TRANSACTION                       │
│                                                                 │
│  Instruction 0: Secp256r1Program.verify()  ← SIMD-48 precompile│
│  ┌────────────────────────────────────────────────────────��────┐│
│  │  signature: [r (32B), s (32B)]                              ││
│  │  public_key: [x (32B), y (32B)]  ← from hardware key       ││
│  │  message: authData || sha256(clientDataJSON)                ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Instruction 1: HardlineVault.withdraw()   ← our program       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  1. Read Instruction 0 via Instructions sysvar              ││
│  │  2. Verify program_id == Secp256r1Program                   ││
│  │  3. Extract verified public key �� match vault.pubkey_x/y   ││
│  │  4. Extract verified message → recompute binding            ││
│  │  5. Verify challenge in clientDataJSON matches intent hash  ││
│  │  6. Verify origin in clientDataJSON is in allowlist         ││
│  │  7. Execute the operation (transfer, whitelist, etc.)       ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Signed by: relayer (pays fees)  ← has ZERO vault authority    │
��─────────────────────────────────────────────────────────────────┘`}
            language="text"
            filename="transaction_anatomy.txt"
          />
          <Callout type="danger" title="CPI Rejection (M-SOL-6)">
            <p>
              The vault program verifies it is being invoked as a top-level instruction,
              not via CPI. If called through another program, the instruction index pairing
              would point to the wrong instruction, potentially allowing signature substitution.
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
          </p>
          <CodeBlock
            code={`// Precompile instruction data layout:
//
// Offset  Size  Field
// ──────  ────  ─────
//   0      1    num_signatures (must be 1)
//   1      1    padding
//   2      2    signature_offset
//   4      2    signature_instruction_index (must be 0xFFFF = same ix)
//   6      2    public_key_offset
//   8      2    public_key_instruction_index (must be 0xFFFF)
//  10      2    message_offset
//  12      2    message_size
//  14      2    message_instruction_index (must be 0xFFFF)
//  16+     var  signature (64B) | public_key (33B or 65B) | message

// All three instruction indices MUST be 0xFFFF (H-2 fix)
// This ensures sig, pubkey, and message are all read from
// the same instruction — not from a different ix in the tx.`}
            language="text"
            filename="precompile_layout.txt"
            showLineNumbers
          />
        </section>

        {/* Account Model */}
        <section className="mt-14">
          <h2 id="account-model" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Account Model
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The program uses four PDA types:
          </p>
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800/60 bg-slate-950/50">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Account</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Seeds</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Size</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { account: "VaultState", seeds: '[b"vault", pubkey_x, pubkey_y]', size: "234 bytes" },
                  { account: "WhitelistEntry", seeds: '[b"whitelist", vault_key, target_key]', size: "73 bytes" },
                  { account: "InheritanceConfig", seeds: '[b"inheritance", vault_key]', size: "157 bytes" },
                  { account: "ProtocolConfig", seeds: '[b"protocol_config"]', size: "145 bytes" },
                ].map((row) => (
                  <tr key={row.account} className="border-b border-slate-800/30 last:border-0">
                    <td className="px-5 py-3 font-mono text-[13px] text-emerald-400">{row.account}</td>
                    <td className="px-5 py-3 font-mono text-[12px] text-slate-400">{row.seeds}</td>
                    <td className="px-5 py-3 text-slate-400">{row.size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Fee Model */}
        <section className="mt-14">
          <h2 id="fee-model" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Fee Model
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Withdrawals incur a 0.25% protocol fee (25 basis points), split three ways:
          </p>
          <div className="grid sm:grid-cols-3 gap-3 my-6">
            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-5 text-center">
              <div className="text-3xl font-bold text-emerald-400 mb-1">50%</div>
              <div className="text-sm font-medium text-white mb-1">Staking Pool</div>
              <p className="text-[11px] text-slate-500">Revenue share for token stakers</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-5 text-center">
              <div className="text-3xl font-bold text-cyan-400 mb-1">30%</div>
              <div className="text-sm font-medium text-white mb-1">Treasury</div>
              <p className="text-[11px] text-slate-500">Operations, development, audits</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-5 text-center">
              <div className="text-3xl font-bold text-purple-400 mb-1">20%</div>
              <div className="text-sm font-medium text-white mb-1">Buyback Reserve</div>
              <p className="text-[11px] text-slate-500">Token buy-and-burn + dust</p>
            </div>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed">
            The fee rate is configurable via <code className="text-emerald-400">update_protocol_config</code> (max
            5%) without redeploying the program. The rate is read fresh from the ProtocolConfig
            PDA on every withdrawal. Deposits are free.
          </p>
        </section>

        {/* EVM Bridge */}
        <section className="mt-14">
          <h2 id="evm-bridge" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            EVM Bridge (ERC-4337 + RIP-7212)
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The Solidity contracts provide the same secp256r1 verification on EVM chains
            using the RIP-7212 precompile (address <code className="text-emerald-400">0x0100</code>).
            The account abstraction model follows ERC-4337 v0.7, enabling gasless transactions
            through a bundler/paymaster pattern.
          </p>
          <CodeBlock
            code={`// EVM contract structure:
//
// HardlineAccountFactory.sol  → deploys new accounts
//   └─ HardlineAccount.sol    → ERC-4337 account with RIP-7212
//       ├─ PolicyEngine.sol   → whitelist + velocity (shared)
//       └─ RecoveryModule.sol → backup key recovery
//
// The secp256r1 verification is identical to Solana:
//   message = sha256(authData || sha256(clientDataJSON))
//   verify via RIP-7212 precompile at 0x0100
//   low-S normalization enforced (P256_N_HALF constant)`}
            language="text"
            filename="evm_architecture.txt"
          />
        </section>

        {/* Indexer */}
        <section className="mt-14">
          <h2 id="indexer" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Trust Indexer
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The Trust indexer is an off-chain service that watches on-chain events (vault
            creations, Pact settlements, disputes) and computes reputation scores. It is
            strictly read-only -- it cannot modify chain state. The indexer provides a
            query API for the Trust SDK methods.
          </p>
          <Callout type="info" title="Decentralization roadmap">
            <p>
              The initial Trust indexer is centrally operated. The roadmap includes
              migration to a decentralized indexing network (e.g., The Graph) with
              multiple independent operators computing scores from the same on-chain data.
            </p>
          </Callout>
        </section>

        <PrevNext
          prev={{ href: "/docs/api-reference/trust", title: "Trust SDK" }}
          next={{ href: "/docs/security", title: "Security Model" }}
        />
      </div>
      <OnThisPage headings={headings} />
    </div>
  );
}
