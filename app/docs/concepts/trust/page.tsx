import CodeBlock from "../../components/CodeBlock";
import Callout from "../../components/Callout";
import PrevNext from "../../components/PrevNext";
import OnThisPage from "../../components/OnThisPage";

export const metadata = { title: "Trust (Reputation)" };

const headings = [
  { id: "overview", text: "Overview", level: 2 },
  { id: "trust-score", text: "The Trust Score", level: 2 },
  { id: "scoring-model", text: "Scoring Model", level: 2 },
  { id: "solvency-proofs", text: "Solvency Proofs", level: 2 },
  { id: "querying", text: "Querying Trust Data", level: 2 },
  { id: "gaming-resistance", text: "Gaming Resistance", level: 2 },
];

export default function TrustConcepts() {
  return (
    <div className="flex gap-10">
      <div className="max-w-4xl mx-auto px-8 py-16 lg:py-20 min-w-0 flex-1">
        <div className="text-[12px] text-slate-500 font-medium mb-8">
          Docs <span className="mx-1.5 text-slate-700">/</span>
          Core Concepts <span className="mx-1.5 text-slate-700">/</span>
          Trust
        </div>

        <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2.5 py-1 rounded-md mb-4">
          Layer 3
        </div>

        <h1 className="text-4xl font-extrabold text-white tracking-tight mb-4">
          Trust: Agent Reputation & Credit
        </h1>
        <p className="text-lg text-slate-400 leading-relaxed mb-12 max-w-2xl">
          Trust is the reputation layer that closes the zero-trust gap. It provides a publicly
          queryable, on-chain credit score for every autonomous wallet, enabling agents to
          verify counterparty reliability before committing capital.
        </p>

        {/* Overview */}
        <section>
          <h2 id="overview" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Overview
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            In the agent economy, there is no KYC. An agent cannot prove its identity through
            traditional means. Trust solves this by building a reputation profile from on-chain
            behavior: how many Pacts were completed, how much volume was transacted, how many
            disputes were filed, and how long the agent has been active.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Any agent can query any other agent&apos;s Trust score before entering a contract.
            This creates a market incentive for reliability -- agents with high scores
            get more business, while unreliable agents are naturally excluded.
          </p>
        </section>

        {/* Trust Score */}
        <section className="mt-14">
          <h2 id="trust-score" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            The Trust Score
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Every Holdfast wallet receives a Trust score from 0 to 1000. The score is
            a composite of five weighted dimensions:
          </p>
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden my-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800/60 bg-slate-950/50">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Dimension</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Weight</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Measures</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { dim: "Escrow Success Rate", weight: "30%", measures: "Percentage of Pacts completed without dispute" },
                  { dim: "Transaction Volume", weight: "25%", measures: "Lifetime value transacted through the protocol" },
                  { dim: "Wallet Age", weight: "20%", measures: "Days since first hardware attestation" },
                  { dim: "Dispute Record", weight: "15%", measures: "Disputes filed, disputes lost, dispute ratio" },
                  { dim: "Solvency", weight: "10%", measures: "Current balance relative to typical transaction size" },
                ].map((row) => (
                  <tr key={row.dim} className="border-b border-slate-800/30 last:border-0">
                    <td className="px-5 py-3 text-white font-medium">{row.dim}</td>
                    <td className="px-5 py-3">
                      <span className="text-purple-400 font-mono text-[13px]">{row.weight}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-[13px]">{row.measures}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Scoring Model */}
        <section className="mt-14">
          <h2 id="scoring-model" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Scoring Model
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Trust scores are computed using a time-weighted exponential decay model. Recent
            behavior is weighted more heavily than historical behavior, but a long track record
            provides stability against temporary dips.
          </p>
          <CodeBlock
            code={`// Conceptual scoring model
score = (
  escrow_rate    * 300 +   // 30% weight, max 300 points
  volume_score   * 250 +   // 25% weight, max 250 points
  age_score      * 200 +   // 20% weight, max 200 points
  dispute_score  * 150 +   // 15% weight, max 150 points
  solvency_score * 100     // 10% weight, max 100 points
) / 1000

// Time decay: recent events are 3x more impactful
// A dispute 7 days ago affects the score more than
// 100 successful pacts from 6 months ago.

// Score thresholds (suggested, not enforced):
//   900+  : Excellent — minimal escrow requirements
//   700-899: Good — standard escrow terms
//   500-699: Fair — higher escrow deposits required
//   <500  : Poor — most agents will refuse to transact`}
            language="text"
            filename="scoring_model.txt"
            showLineNumbers
          />
        </section>

        {/* Solvency Proofs */}
        <section className="mt-14">
          <h2 id="solvency-proofs" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Solvency Proofs
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Beyond reputation, Trust provides real-time solvency verification. An agent can
            query whether a counterparty has sufficient funds to honor a contract before
            entering it. Solvency proofs are read directly from the vault PDA balance --
            no oracle required.
          </p>
          <CodeBlock
            code={`const solvency = await Trust.verifySolvency({
  agent: 'agent_beta.sol',
  requiredAmount: 10_000,   // USDC
  token: 'USDC',
});

if (!solvency.sufficient) {
  console.warn(
    \`Agent has \${solvency.available} USDC, ` +
    `needs \${solvency.required} USDC\`
  );
  throw new Error('Counterparty insufficient funds');
}`}
            language="typescript"
            filename="solvency_check.ts"
          />
          <Callout type="tip" title="Composability">
            <p>
              Trust and Pact compose naturally: check the Trust score, verify solvency,
              then create an escrow Pact with terms calibrated to the counterparty&apos;s
              reliability. Low trust score? Require a larger escrow deposit.
            </p>
          </Callout>
        </section>

        {/* Gaming Resistance */}
        <section className="mt-14">
          <h2 id="gaming-resistance" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Gaming Resistance
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Trust scores are designed to resist manipulation:
          </p>
          <ul className="space-y-3 text-sm text-slate-400">
            <li className="flex items-start gap-2.5">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-500 flex-shrink-0" />
              <span>
                <strong className="text-white">Wash trading detection:</strong> Self-dealing between
                wallets controlled by the same entity is detected through transaction graph analysis.
                Pacts between related wallets receive reduced scoring weight.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-500 flex-shrink-0" />
              <span>
                <strong className="text-white">Volume-weighted scoring:</strong> A thousand $0.01
                transactions contribute less than ten $100 transactions. Volume bands prevent
                score inflation through micro-transaction spam.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-500 flex-shrink-0" />
              <span>
                <strong className="text-white">Time-weighted decay:</strong> Scores degrade without
                continued activity. An agent cannot build a score once and coast on it forever.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-500 flex-shrink-0" />
              <span>
                <strong className="text-white">Hardware attestation requirement:</strong> Trust scores
                are only available for hardware-attested wallets. Software wallets, which are trivially
                created in bulk, cannot participate in the Trust system.
              </span>
            </li>
          </ul>
        </section>

        <PrevNext
          prev={{ href: "/docs/concepts/pact", title: "Pact (Escrow)" }}
          next={{ href: "/docs/api-reference", title: "API Reference" }}
        />
      </div>
      <OnThisPage headings={headings} />
    </div>
  );
}
