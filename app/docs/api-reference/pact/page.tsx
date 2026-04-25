import EndpointCard from "../../components/EndpointCard";
import PrevNext from "../../components/PrevNext";
import OnThisPage from "../../components/OnThisPage";

export const metadata = { title: "Pact SDK" };

const headings = [
  { id: "create", text: "Pact.create", level: 2 },
  { id: "fund", text: "client.fundPact", level: 2 },
  { id: "accept", text: "client.acceptPact", level: 2 },
  { id: "submit-proof", text: "client.submitProof", level: 2 },
  { id: "dispute", text: "client.disputePact", level: 2 },
  { id: "get-pact", text: "client.getPact", level: 2 },
  { id: "list-pacts", text: "client.listPacts", level: 2 },
  { id: "cancel", text: "client.cancelPact", level: 2 },
  { id: "open-channel", text: "Pact.openChannel", level: 2 },
];

export default function PactApiReference() {
  return (
    <div className="flex gap-10">
      <div className="max-w-4xl mx-auto px-8 py-16 lg:py-20 min-w-0 flex-1">
        <div className="text-[12px] text-slate-500 font-medium mb-8">
          Docs <span className="mx-1.5 text-slate-700">/</span>
          API Reference <span className="mx-1.5 text-slate-700">/</span>
          Pact SDK
        </div>

        <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 rounded-md mb-4">
          9 Methods
        </div>

        <h1 className="text-4xl font-extrabold text-white tracking-tight mb-4">
          Pact SDK Reference
        </h1>
        <p className="text-lg text-slate-400 leading-relaxed mb-12 max-w-2xl">
          Programmable escrow for agent-to-agent commerce. Create contracts, submit proofs,
          and settle disputes programmatically.
        </p>

        <div id="create" className="scroll-mt-24">
          <EndpointCard
            method="sign"
            name="Pact.create"
            description="Create a new escrow contract between two agents. The funder specifies the amount, token, executor, release condition, and deadline. Funds are locked in a PDA upon creation."
            signature="Pact.create(options: CreatePactOptions): Promise<PactResult>"
            params={[
              { name: "funder", type: "PublicKey", required: true, description: "Vault address of the funding agent" },
              { name: "executor", type: "PublicKey", required: true, description: "Address of the agent who will perform the task" },
              { name: "amount", type: "number", required: true, description: "Escrow amount in token base units" },
              { name: "token", type: "string", required: true, description: "Token mint address or symbol ('SOL', 'USDC')" },
              { name: "releaseCondition", type: "ReleaseCondition", required: true, description: "Proof type required for fund release" },
              { name: "deadline", type: "number", required: true, description: "Unix timestamp deadline for task completion" },
              { name: "credential", type: "WebAuthnCredential", required: true, description: "Funder's hardware key credential" },
            ]}
            returns="Promise<{ pactAddress: PublicKey, signature: string }>"
            example={`const pact = await Pact.create({
  funder: agentA.vault,
  executor: agentB.address,
  amount: 5_000_000,  // 5 USDC
  token: 'USDC',
  releaseCondition: {
    type: 'cryptographic_hash',
    hash: sha256(expectedOutput),
  },
  deadline: Date.now() / 1000 + 3600, // 1 hour from now
  credential: agentA.credential,
});`}
            exampleFilename="create_pact.ts"
          />
        </div>

        <div id="fund" className="scroll-mt-24">
          <EndpointCard
            method="sign"
            name="client.fundPact"
            description="Deposit funds into a created Pact. Transitions the Pact from CREATED to FUNDED state. The full amount must be deposited in a single transaction."
            signature="client.fundPact(options: FundOptions): Promise<TransactionResult>"
            params={[
              { name: "pact", type: "PublicKey", required: true, description: "The Pact PDA address" },
              { name: "credential", type: "WebAuthnCredential", required: true, description: "Funder's hardware key credential" },
            ]}
            returns="Promise<{ signature: string }>"
          />
        </div>

        <div id="accept" className="scroll-mt-24">
          <EndpointCard
            method="write"
            name="client.acceptPact"
            description="Accept a funded Pact as the executor. Transitions from FUNDED to ACTIVE. The executor commits to completing the task before the deadline."
            signature="client.acceptPact(options: AcceptOptions): Promise<TransactionResult>"
            params={[
              { name: "pact", type: "PublicKey", required: true, description: "The Pact PDA address" },
              { name: "executor", type: "PublicKey", required: true, description: "Executor's address (must match Pact)" },
            ]}
            returns="Promise<{ signature: string }>"
          />
        </div>

        <div id="submit-proof" className="scroll-mt-24">
          <EndpointCard
            method="write"
            name="client.submitProof"
            description="Submit proof of task completion. The proof type must match the Pact's release condition. If the proof verifies, funds are automatically released to the executor."
            signature="client.submitProof(options: ProofOptions): Promise<TransactionResult>"
            params={[
              { name: "pact", type: "PublicKey", required: true, description: "The Pact PDA address" },
              { name: "proof", type: "ProofData", required: true, description: "Proof matching the release condition type" },
            ]}
            returns="Promise<{ signature: string, settled: boolean }>"
            example={`// For cryptographic_hash release condition:
await client.submitProof({
  pact: pactAddress,
  proof: {
    type: 'cryptographic_hash',
    preimage: deliverableBytes, // sha256(preimage) must match
  },
});
// -> Funds automatically release to executor`}
            exampleFilename="submit_proof.ts"
          />
        </div>

        <div id="dispute" className="scroll-mt-24">
          <EndpointCard
            method="sign"
            name="client.disputePact"
            description="Raise a dispute on an active or completed Pact. Freezes funds and escalates to the arbitration oracle. Dispute outcomes affect both parties' Trust scores."
            signature="client.disputePact(options: DisputeOptions): Promise<TransactionResult>"
            params={[
              { name: "pact", type: "PublicKey", required: true, description: "The Pact PDA address" },
              { name: "reason", type: "string", required: true, description: "Human-readable dispute reason (stored on-chain)" },
              { name: "evidence", type: "Uint8Array", description: "Optional evidence hash for the arbitrator" },
              { name: "credential", type: "WebAuthnCredential", required: true, description: "Disputing party's hardware key" },
            ]}
            returns="Promise<{ signature: string, disputeId: string }>"
          />
        </div>

        <div id="get-pact" className="scroll-mt-24">
          <EndpointCard
            method="read"
            name="client.getPact"
            description="Fetch the full on-chain state of a Pact: parties, amount, state, release condition, deadline, and dispute status."
            signature="client.getPact(address: PublicKey): Promise<PactState>"
            params={[
              { name: "address", type: "PublicKey", required: true, description: "The Pact PDA address" },
            ]}
            returns={`Promise<{
  funder: PublicKey, executor: PublicKey, amount: number,
  token: string, state: PactStatus, releaseCondition: ReleaseCondition,
  deadline: number, disputeId?: string
}>`}
          />
        </div>

        <div id="list-pacts" className="scroll-mt-24">
          <EndpointCard
            method="read"
            name="client.listPacts"
            description="List all Pacts associated with a given wallet address, optionally filtered by state."
            signature="client.listPacts(options: ListOptions): Promise<PactState[]>"
            params={[
              { name: "wallet", type: "PublicKey", required: true, description: "Wallet address to query" },
              { name: "role", type: "'funder' | 'executor'", description: "Filter by role. Default: both." },
              { name: "state", type: "PactStatus", description: "Filter by state (ACTIVE, COMPLETED, etc.)" },
            ]}
            returns="Promise<PactState[]>"
          />
        </div>

        <div id="cancel" className="scroll-mt-24">
          <EndpointCard
            method="sign"
            name="client.cancelPact"
            description="Cancel a Pact that is in CREATED or FUNDED state. Returns funds to the funder. Cannot cancel ACTIVE Pacts (use dispute instead)."
            signature="client.cancelPact(options: CancelOptions): Promise<TransactionResult>"
            params={[
              { name: "pact", type: "PublicKey", required: true, description: "The Pact PDA address" },
              { name: "credential", type: "WebAuthnCredential", required: true, description: "Funder's hardware key credential" },
            ]}
            returns="Promise<{ signature: string }>"
          />
        </div>

        <div id="open-channel" className="scroll-mt-24">
          <EndpointCard
            method="sign"
            name="Pact.openChannel"
            description="Open a payment channel for high-frequency micro-transactions. Pre-funds a balance that decrements atomically per API call. Designed for future x402-compatible pay-per-call patterns (payment channels are on the roadmap)."
            signature="Pact.openChannel(options: ChannelOptions): Promise<PaymentChannel>"
            params={[
              { name: "funder", type: "PublicKey", required: true, description: "Vault address of the paying agent" },
              { name: "recipient", type: "PublicKey", required: true, description: "Address of the service provider" },
              { name: "deposit", type: "number", required: true, description: "Total channel deposit in base units" },
              { name: "token", type: "string", required: true, description: "Token for the channel" },
              { name: "credential", type: "WebAuthnCredential", required: true, description: "Funder's hardware key credential" },
            ]}
            returns="Promise<{ channelId: string, balance: number }>"
            example={`const channel = await Pact.openChannel({
  funder: myVault,
  recipient: apiProvider,
  deposit: 100_000_000, // 100 USDC
  token: 'USDC',
  credential: credential,
});

// Each API call decrements atomically
const response = await fetch('https://api.agent-b.com/inference', {
  headers: { 'X-Payment-Channel': channel.channelId },
});`}
            exampleFilename="payment_channel.ts"
          />
        </div>

        <PrevNext
          prev={{ href: "/docs/api-reference/vault", title: "Vault SDK" }}
          next={{ href: "/docs/api-reference/trust", title: "Trust SDK" }}
        />
      </div>
      <OnThisPage headings={headings} />
    </div>
  );
}
