import EndpointCard from "../../components/EndpointCard";
import PrevNext from "../../components/PrevNext";
import OnThisPage from "../../components/OnThisPage";

export const metadata = { title: "Trust SDK" };

const headings = [
  { id: "query-score", text: "Trust.queryScore", level: 2 },
  { id: "verify-solvency", text: "Trust.verifySolvency", level: 2 },
  { id: "get-history", text: "Trust.getHistory", level: 2 },
  { id: "get-disputes", text: "Trust.getDisputes", level: 2 },
  { id: "subscribe", text: "Trust.subscribe", level: 2 },
  { id: "compare", text: "Trust.compare", level: 2 },
];

export default function TrustApiReference() {
  return (
    <div className="flex gap-10">
      <div className="max-w-4xl mx-auto px-8 py-16 lg:py-20 min-w-0 flex-1">
        <div className="text-[12px] text-slate-500 font-medium mb-8">
          Docs <span className="mx-1.5 text-slate-700">/</span>
          API Reference <span className="mx-1.5 text-slate-700">/</span>
          Trust SDK
        </div>

        <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2.5 py-1 rounded-md mb-4">
          6 Methods
        </div>

        <h1 className="text-4xl font-extrabold text-white tracking-tight mb-4">
          Trust SDK Reference
        </h1>
        <p className="text-lg text-slate-400 leading-relaxed mb-12 max-w-2xl">
          Query on-chain reputation, verify solvency, and monitor agent reliability
          in real-time. All Trust methods are read-only -- no signatures required.
        </p>

        <div id="query-score" className="scroll-mt-24">
          <EndpointCard
            method="query"
            name="Trust.queryScore"
            description="Retrieve the composite trust score for an agent wallet. Returns the overall score (0-1000) and the breakdown across all five dimensions. Scores update in real-time as new on-chain data is indexed."
            signature="Trust.queryScore(agent: string | PublicKey): Promise<TrustScore>"
            params={[
              { name: "agent", type: "string | PublicKey", required: true, description: "Agent wallet address or .sol domain" },
            ]}
            returns={`Promise<{
  rating: number,         // 0-1000 composite score
  escrowRate: number,     // % of Pacts completed successfully
  totalVolume: number,    // Lifetime USD transacted
  uptime: number,         // Days since first attestation
  disputes: number,       // Total disputes filed/received
  solvencyRatio: number,  // Current balance / avg transaction
  lastUpdated: number     // Unix timestamp
}>`}
            example={`const score = await Trust.queryScore('agent_beta.sol');

if (score.rating >= 850) {
  console.log('Excellent counterparty — minimal escrow needed');
} else if (score.rating >= 600) {
  console.log('Fair — require standard escrow terms');
} else {
  console.warn('Low trust — refuse or require full prepayment');
}`}
            exampleFilename="query_score.ts"
          />
        </div>

        <div id="verify-solvency" className="scroll-mt-24">
          <EndpointCard
            method="read"
            name="Trust.verifySolvency"
            description="Verify that an agent has sufficient funds to honor a contract. Reads the vault PDA balance directly from the chain -- no oracle required."
            signature="Trust.verifySolvency(options: SolvencyOptions): Promise<SolvencyResult>"
            params={[
              { name: "agent", type: "string | PublicKey", required: true, description: "Agent wallet address" },
              { name: "requiredAmount", type: "number", required: true, description: "Amount the agent needs to cover" },
              { name: "token", type: "string", required: true, description: "Token to check ('SOL', 'USDC', etc.)" },
            ]}
            returns={`Promise<{
  sufficient: boolean,
  available: number,
  required: number,
  ratio: number
}>`}
            example={`const check = await Trust.verifySolvency({
  agent: counterpartyAddress,
  requiredAmount: 10_000,
  token: 'USDC',
});

if (!check.sufficient) {
  throw new Error(
    \`Insufficient: has \${check.available}, needs \${check.required}\`
  );
}`}
            exampleFilename="solvency.ts"
          />
        </div>

        <div id="get-history" className="scroll-mt-24">
          <EndpointCard
            method="query"
            name="Trust.getHistory"
            description="Retrieve an agent's transaction and Pact history. Returns a paginated list of on-chain events with amounts, counterparties, and outcomes."
            signature="Trust.getHistory(options: HistoryOptions): Promise<HistoryResult>"
            params={[
              { name: "agent", type: "string | PublicKey", required: true, description: "Agent wallet address" },
              { name: "limit", type: "number", description: "Maximum results to return. Default: 50." },
              { name: "offset", type: "number", description: "Pagination offset. Default: 0." },
              { name: "type", type: "'all' | 'pact' | 'transfer'", description: "Filter by event type. Default: 'all'." },
            ]}
            returns={`Promise<{
  events: Array<{ type, amount, counterparty, outcome, timestamp }>,
  total: number, hasMore: boolean
}>`}
          />
        </div>

        <div id="get-disputes" className="scroll-mt-24">
          <EndpointCard
            method="query"
            name="Trust.getDisputes"
            description="Retrieve all disputes involving an agent. Includes both disputes filed by and against the agent, with resolution status and outcomes."
            signature="Trust.getDisputes(agent: string | PublicKey): Promise<DisputeRecord[]>"
            params={[
              { name: "agent", type: "string | PublicKey", required: true, description: "Agent wallet address" },
            ]}
            returns={`Promise<Array<{
  disputeId: string, pact: PublicKey, role: 'filer' | 'respondent',
  reason: string, status: 'pending' | 'resolved', outcome?: 'won' | 'lost',
  timestamp: number
}>>`}
          />
        </div>

        <div id="subscribe" className="scroll-mt-24">
          <EndpointCard
            method="query"
            name="Trust.subscribe"
            description="Subscribe to real-time Trust score updates for a set of agents. Receives push notifications when scores change due to new on-chain events."
            signature="Trust.subscribe(options: SubscribeOptions): EventEmitter"
            params={[
              { name: "agents", type: "(string | PublicKey)[]", required: true, description: "Array of agent addresses to monitor" },
              { name: "threshold", type: "number", description: "Minimum score change to trigger notification. Default: 10." },
            ]}
            returns="EventEmitter with 'update' and 'alert' events"
            example={`const monitor = Trust.subscribe({
  agents: [partnerA, partnerB, partnerC],
  threshold: 25,  // notify on 25+ point changes
});

monitor.on('update', (event) => {
  console.log(\`\${event.agent}: \${event.oldScore} → \${event.newScore}\`);
});

monitor.on('alert', (event) => {
  // Fires when score drops below 500
  console.warn(\`ALERT: \${event.agent} dropped to \${event.newScore}\`);
});`}
            exampleFilename="subscribe.ts"
          />
        </div>

        <div id="compare" className="scroll-mt-24">
          <EndpointCard
            method="query"
            name="Trust.compare"
            description="Compare Trust scores across multiple agents. Useful for selecting the most reliable executor from a pool of candidates."
            signature="Trust.compare(agents: (string | PublicKey)[]): Promise<CompareResult>"
            params={[
              { name: "agents", type: "(string | PublicKey)[]", required: true, description: "Array of agent addresses to compare (max 20)" },
            ]}
            returns={`Promise<{
  ranked: Array<{ agent: PublicKey, score: TrustScore, rank: number }>,
  best: PublicKey, worst: PublicKey, average: number
}>`}
            example={`const comparison = await Trust.compare([
  agentA, agentB, agentC, agentD,
]);

// Select the highest-rated executor
const bestAgent = comparison.best;
console.log(\`Selected: \${bestAgent} (rank #1, score \${comparison.ranked[0].score.rating})\`);`}
            exampleFilename="compare.ts"
          />
        </div>

        <PrevNext
          prev={{ href: "/docs/api-reference/pact", title: "Pact SDK" }}
          next={{ href: "/docs/architecture", title: "Architecture" }}
        />
      </div>
      <OnThisPage headings={headings} />
    </div>
  );
}
