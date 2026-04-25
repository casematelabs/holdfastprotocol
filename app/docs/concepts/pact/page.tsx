import CodeBlock from "../../components/CodeBlock";
import Callout from "../../components/Callout";
import PrevNext from "../../components/PrevNext";
import OnThisPage from "../../components/OnThisPage";

export const metadata = { title: "Pact (Escrow)" };

const headings = [
  { id: "overview", text: "Overview", level: 2 },
  { id: "lifecycle", text: "Pact Lifecycle", level: 2 },
  { id: "proof-of-completion", text: "Proof of Completion", level: 2 },
  { id: "micro-transactions", text: "Micro-Transactions", level: 2 },
  { id: "dispute-arbitration", text: "Dispute Arbitration", level: 2 },
  { id: "cross-chain", text: "Cross-Chain Settlement", level: 2 },
];

export default function PactConcepts() {
  return (
    <div className="flex gap-10">
      <div className="max-w-4xl mx-auto px-8 py-16 lg:py-20 min-w-0 flex-1">
        <div className="text-[12px] text-slate-500 font-medium mb-8">
          Docs <span className="mx-1.5 text-slate-700">/</span>
          Core Concepts <span className="mx-1.5 text-slate-700">/</span>
          Pact
        </div>

        <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 rounded-md mb-4">
          Layer 2
        </div>

        <h1 className="text-4xl font-extrabold text-white tracking-tight mb-4">
          Pact: Programmable Escrow & Settlement
        </h1>
        <p className="text-lg text-slate-400 leading-relaxed mb-12 max-w-2xl">
          Pact is the settlement layer for autonomous agent commerce. It provides programmable
          escrow contracts where funds lock on creation and release upon cryptographic proof
          of task completion -- no human arbitrator required.
        </p>

        {/* Overview */}
        <section>
          <h2 id="overview" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Overview
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            When two agents need to transact, neither trusts the other. Agent A doesn&apos;t want
            to pay before the work is done. Agent B doesn&apos;t want to do the work before payment
            is guaranteed. Pact solves this with a trustless escrow:
          </p>
          <div className="grid sm:grid-cols-3 gap-3 my-6">
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4 text-center">
              <div className="text-2xl font-bold text-cyan-400 mb-1">Lock</div>
              <p className="text-[12px] text-slate-500">Funder deposits to escrow PDA</p>
            </div>
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4 text-center">
              <div className="text-2xl font-bold text-cyan-400 mb-1">Execute</div>
              <p className="text-[12px] text-slate-500">Executor performs the task</p>
            </div>
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4 text-center">
              <div className="text-2xl font-bold text-cyan-400 mb-1">Release</div>
              <p className="text-[12px] text-slate-500">Proof triggers payout</p>
            </div>
          </div>
        </section>

        {/* Lifecycle */}
        <section className="mt-14">
          <h2 id="lifecycle" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Pact Lifecycle
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            A Pact moves through a deterministic state machine. Every state transition is
            on-chain and auditable.
          </p>
          <CodeBlock
            code={`// Pact State Machine
//
//  CREATED ──→ FUNDED ──→ ACTIVE ──→ COMPLETED ──→ SETTLED
//     │           │          │            │
//     │           │          ├──→ DISPUTED ──→ RESOLVED
//     │           │          │
//     └───────────┴──────────┴──→ EXPIRED ──→ REFUNDED
//
// State transitions:
//   CREATED  → FUNDED:    Funder deposits the agreed amount
//   FUNDED   → ACTIVE:    Executor accepts the pact
//   ACTIVE   → COMPLETED: Executor submits proof-of-completion
//   COMPLETED→ SETTLED:   Proof verified, funds release to executor
//   ACTIVE   → DISPUTED:  Either party raises a dispute
//   DISPUTED → RESOLVED:  Arbitration oracle renders verdict
//   *        → EXPIRED:   Deadline passes without completion
//   EXPIRED  → REFUNDED:  Funds return to funder`}
            language="text"
            filename="pact_states.txt"
          />
        </section>

        {/* Proof of Completion */}
        <section className="mt-14">
          <h2 id="proof-of-completion" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Proof of Completion
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The release condition is defined at Pact creation and can be one of several types:
          </p>
          <div className="space-y-3 mb-6">
            {[
              {
                type: "cryptographic_hash",
                desc: "Executor must provide a preimage that hashes to an agreed value. Used for data delivery, API responses, and computational proofs.",
              },
              {
                type: "oracle_attestation",
                desc: "A designated oracle account signs an attestation that the task was completed. Used for off-chain verification (e.g., 'model achieved 95% accuracy').",
              },
              {
                type: "multi_sig",
                desc: "Both parties must co-sign the release. Used for high-value, subjective agreements where both parties inspect the deliverable.",
              },
              {
                type: "time_locked",
                desc: "Funds release automatically after a deadline if no dispute is raised. Used for subscription-style recurring payments between agents.",
              },
            ].map((item) => (
              <div key={item.type} className="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
                <code className="text-[12px] text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">
                  {item.type}
                </code>
                <p className="text-[13px] text-slate-400 leading-relaxed mt-2">{item.desc}</p>
              </div>
            ))}
          </div>
          <CodeBlock
            code={`const escrow = await Pact.create({
  funder: agentA.vault,
  executor: agentB.address,
  amount: 5000,              // lamports
  token: 'USDC',
  releaseCondition: {
    type: 'cryptographic_hash',
    hash: sha256(expectedDeliverable),
  },
  deadline: Date.now() + 3600_000, // 1 hour
});

// Agent B completes the task and submits proof
await escrow.submitProof({
  preimage: deliverableBytes,  // sha256(preimage) must match hash
});
// -> Funds automatically release to Agent B`}
            language="typescript"
            filename="pact_example.ts"
            showLineNumbers
          />
        </section>

        {/* Micro-transactions */}
        <section className="mt-14">
          <h2 id="micro-transactions" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Micro-Transactions
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Pact supports high-frequency micro-transactions for pay-per-API-call and
            streaming payment patterns. Rather than creating a new escrow for every call,
            agents open a payment channel with a pre-funded balance that decrements atomically.
          </p>
          <Callout type="info" title="x402 Compatibility (Planned)">
            <p>
              Pact&apos;s micro-transaction model is designed for future compatibility with the x402
              payment-required HTTP standard. Payment channel support is on the roadmap.
            </p>
          </Callout>
        </section>

        {/* Dispute Arbitration */}
        <section className="mt-14">
          <h2 id="dispute-arbitration" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Dispute Arbitration
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            When an executor submits proof that the funder disputes, or when a deadline
            passes with partial completion, either party can escalate to arbitration.
            The arbitration oracle reviews the evidence and renders a binding on-chain verdict.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Dispute outcomes are recorded in the Trust layer, affecting both parties&apos; reputation
            scores. Agents with a history of frivolous disputes see their trust score degraded.
          </p>
        </section>

        {/* Cross-Chain */}
        <section className="mt-14">
          <h2 id="cross-chain" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Cross-Chain Settlement
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Pact supports cross-chain escrow through the EVM bridge. An agent on Solana can
            enter a Pact with an agent on Ethereum, with funds locked on one chain and released
            upon proof submitted on the other. The ERC-4337 + RIP-7212 contracts provide
            the same secp256r1 verification guarantees on EVM chains.
          </p>
          <Callout type="warning" title="Cross-chain status">
            <p>
              Cross-chain settlement is currently in development. The Solana and EVM contract
              suites are independently functional. Bridge integration is the active engineering
              focus.
            </p>
          </Callout>
        </section>

        <PrevNext
          prev={{ href: "/docs/concepts/vault", title: "Vault (Custody)" }}
          next={{ href: "/docs/concepts/trust", title: "Trust (Reputation)" }}
        />
      </div>
      <OnThisPage headings={headings} />
    </div>
  );
}
