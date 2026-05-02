import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import bs58 from "bs58";
import { AgentRuntime } from "@elizaos/core";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { EscrowStatus, createHoldfastClient } from "@holdfastprotocol/sdk";
import { createHoldfastPlugin } from "../index.js";

const env = {
  privateKeyBase58: process.env.HF_DEVNET_SIGNER_PRIVATE_KEY_BASE58?.trim(),
  agentWallet: process.env.HF_DEVNET_AGENT_WALLET?.trim(),
  counterparty: process.env.HF_DEVNET_COUNTERPARTY?.trim(),
  counterpartyWallet: process.env.HF_DEVNET_COUNTERPARTY_WALLET?.trim(),
  mint: process.env.HF_DEVNET_MINT?.trim(),
  amount: process.env.HF_DEVNET_AMOUNT_BASE_UNITS?.trim(),
  arbiter: process.env.HF_DEVNET_ARBITER?.trim(),
  arbiterWallet: process.env.HF_DEVNET_ARBITER_WALLET?.trim(),
  counterpartyKeypairPath: process.env.HF_DEVNET_COUNTERPARTY_KEYPAIR_PATH?.trim() ?? "~/.config/solana/agent-a.json",
  rpcUrl: process.env.HF_DEVNET_RPC_URL?.trim() ?? "https://api.devnet.solana.com",
  indexerUrl: process.env.HF_DEVNET_INDEXER_URL?.trim(),
  escrowProgramId: process.env.HF_DEVNET_ESCROW_PROGRAM_ID?.trim() ?? "CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi",
  holdfastProgramId: process.env.HF_DEVNET_HOLDFAST_PROGRAM_ID?.trim() ?? "2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq",
};

const missing = [
  ["HF_DEVNET_SIGNER_PRIVATE_KEY_BASE58", env.privateKeyBase58],
  ["HF_DEVNET_AGENT_WALLET", env.agentWallet],
  ["HF_DEVNET_COUNTERPARTY", env.counterparty],
  ["HF_DEVNET_MINT", env.mint],
  ["HF_DEVNET_AMOUNT_BASE_UNITS", env.amount],
].filter(([, value]) => !value).map(([name]) => name);

const DEVNET_TEST_TIMEOUT_MS = 180_000;
const GET_PACT_RETRIES = 8;
const GET_PACT_RETRY_DELAY_MS = 750;
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSVAR_RENT = new PublicKey("SysvarRent111111111111111111111111111111111");

if (missing.length > 0) {
  console.warn(
    `[CAS-3] Skipping live devnet integration test. Missing required env vars: ${missing.join(", ")}. ` +
    "Create .env.devnet.integration from .env.devnet.integration.example and run npm run test:integration:devnet:ps1.",
  );
}

function makeCallback() {
  const calls: string[] = [];
  return {
    calls,
    fn: async (c: { text: string }) => { calls.push(c.text); },
  };
}

function loadKeypair(filePath: string): Keypair {
  const resolved = filePath.replace(/^~/, os.homedir());
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPactWithRetry(
  client: ReturnType<typeof createHoldfastClient>,
  escrowId: string,
) {
  let lastErr: unknown;
  for (let i = 0; i < GET_PACT_RETRIES; i += 1) {
    try {
      return await client.escrow.getPact(new PublicKey(escrowId));
    } catch (err) {
      lastErr = err;
      await sleep(GET_PACT_RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

async function ensureAta(
  client: ReturnType<typeof createHoldfastClient>,
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  const ata = deriveAta(owner, mint);
  const existing = await client.connection.getAccountInfo(ata);
  if (existing) return ata;

  const ix = new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  });
  const tx = new Transaction().add(ix);
  await client.connection.sendTransaction(tx, [payer], { skipPreflight: false });
  return ata;
}

function extractEscrowId(text: string): string {
  const hex = text.match(/Escrow ID:\s*([0-9a-fA-F]{64})(?:\b|[.\s]|$)/);
  if (hex) {
    return new PublicKey(Buffer.from(hex[1], "hex")).toBase58();
  }

  const base58 = text.match(/Escrow ID:\s*([1-9A-HJ-NP-Za-km-z]{32,44})(?:\b|[.\s]|$)/);
  if (base58) return base58[1];

  throw new Error(`Unable to parse escrow id from callback: ${text}`);
}

test(
  "devnet integration: all five actions execute with expected status transitions",
  { skip: missing.length > 0, timeout: DEVNET_TEST_TIMEOUT_MS },
  async () => {
    const signer = Keypair.fromSecretKey(bs58.decode(env.privateKeyBase58!));
    const counterpartySigner = loadKeypair(env.counterpartyKeypairPath);
    const runtime = new AgentRuntime({});
    const plugin = createHoldfastPlugin({
      rpcUrl: env.rpcUrl,
      indexerUrl: env.indexerUrl,
      signer,
      agentWallet: env.agentWallet!,
      escrowProgramId: env.escrowProgramId,
      holdfastProgramId: env.holdfastProgramId,
    });

    const byName = new Map(plugin.actions!.map((action) => [action.name, action]));
    const checkReputation = byName.get("CHECK_REPUTATION");
    const createPact = byName.get("CREATE_PACT");
    const depositEscrow = byName.get("DEPOSIT_ESCROW");
    const releasePact = byName.get("RELEASE_PACT");
    const openDispute = byName.get("OPEN_DISPUTE");
    assert.ok(checkReputation && createPact && depositEscrow && releasePact && openDispute);

    const repCb = makeCallback();
    await checkReputation!.handler(
      runtime as never,
      { content: { text: `Check reputation for ${signer.publicKey.toBase58()}` } } as never,
      {} as never,
      {},
      repCb.fn as never,
    );
    assert.equal(repCb.calls.length, 1);
    const repText = repCb.calls[0];
    const repSucceeded = /Tier:/.test(repText) && /Score:/.test(repText);
    const repExpectedDevnetFailure =
      /Failed to fetch reputation:/.test(repText) &&
      (
        /ReputationAccount not found/.test(repText) ||
        /schema_version mismatch/.test(repText)
      );
    assert.ok(
      repSucceeded || repExpectedDevnetFailure,
      `Unexpected CHECK_REPUTATION response: ${repText}`,
    );

    const commonCreateOptions = {
      counterparty: env.counterparty!,
      counterpartyWallet: env.counterpartyWallet ?? env.agentWallet!,
      mint: env.mint!,
      amount: env.amount!,
      arbiter: env.arbiter ?? env.counterparty!,
      arbiterWallet: env.arbiterWallet ?? env.counterpartyWallet ?? env.agentWallet!,
    };

    const createReleaseCb = makeCallback();
    await createPact!.handler(runtime as never, {} as never, {} as never, commonCreateOptions, createReleaseCb.fn as never);
    assert.equal(createReleaseCb.calls.length, 1);
    const releaseEscrowId = extractEscrowId(createReleaseCb.calls[0]);

    const client = createHoldfastClient({
      rpcUrl: env.rpcUrl,
      indexerUrl: env.indexerUrl,
      signer,
      agentWallet: new PublicKey(env.agentWallet!),
      escrowProgramId: new PublicKey(env.escrowProgramId),
      holdfastProgramId: new PublicKey(env.holdfastProgramId),
    });
    const beneficiaryClient = createHoldfastClient({
      rpcUrl: env.rpcUrl,
      indexerUrl: env.indexerUrl,
      signer: counterpartySigner,
      agentWallet: new PublicKey(commonCreateOptions.counterpartyWallet),
      escrowProgramId: new PublicKey(env.escrowProgramId),
      holdfastProgramId: new PublicKey(env.holdfastProgramId),
    });
    await ensureAta(
      client,
      signer,
      new PublicKey(commonCreateOptions.counterparty),
      new PublicKey(commonCreateOptions.mint),
    );

    let pact = await getPactWithRetry(client, releaseEscrowId);
    assert.equal(pact.status, EscrowStatus.Pending);

    const depositReleaseCb = makeCallback();
    await depositEscrow!.handler(
      runtime as never,
      {} as never,
      {} as never,
      { escrowId: releaseEscrowId },
      depositReleaseCb.fn as never,
    );
    assert.match(depositReleaseCb.calls[0], /funded and active/);
    pact = await getPactWithRetry(client, releaseEscrowId);
    assert.equal(pact.status, EscrowStatus.Funded);
    await beneficiaryClient.escrow.stakeBeneficiary(new PublicKey(releaseEscrowId));

    await client.escrow.lockEscrow(
      new PublicKey(releaseEscrowId),
      counterpartySigner,
      new PublicKey(commonCreateOptions.counterpartyWallet),
      new PublicKey(commonCreateOptions.arbiterWallet),
    );
    pact = await getPactWithRetry(client, releaseEscrowId);
    assert.equal(pact.status, EscrowStatus.Locked);

    const releaseCb = makeCallback();
    await releasePact!.handler(
      runtime as never,
      { content: { escrowId: releaseEscrowId } } as never,
      {} as never,
      { escrowId: releaseEscrowId },
      releaseCb.fn as never,
    );
    assert.match(releaseCb.calls[0], /released/);
    pact = await getPactWithRetry(client, releaseEscrowId);
    assert.equal(pact.status, EscrowStatus.Released);

    const createDisputeCb = makeCallback();
    await createPact!.handler(runtime as never, {} as never, {} as never, commonCreateOptions, createDisputeCb.fn as never);
    const disputeEscrowId = extractEscrowId(createDisputeCb.calls[0]);

    await depositEscrow!.handler(
      runtime as never,
      {} as never,
      {} as never,
      { escrowId: disputeEscrowId },
      makeCallback().fn as never,
    );
    await beneficiaryClient.escrow.stakeBeneficiary(new PublicKey(disputeEscrowId));
    await client.escrow.lockEscrow(
      new PublicKey(disputeEscrowId),
      counterpartySigner,
      new PublicKey(commonCreateOptions.counterpartyWallet),
      new PublicKey(commonCreateOptions.arbiterWallet),
    );
    pact = await getPactWithRetry(client, disputeEscrowId);
    assert.equal(pact.status, EscrowStatus.Locked);

    const disputeCb = makeCallback();
    await openDispute!.handler(
      runtime as never,
      { content: { escrowId: disputeEscrowId } } as never,
      {} as never,
      { escrowId: disputeEscrowId, reason: "Integration test dispute path validation" },
      disputeCb.fn as never,
    );
    assert.match(disputeCb.calls[0], /Dispute opened/);
    pact = await getPactWithRetry(client, disputeEscrowId);
    assert.equal(pact.status, EscrowStatus.Disputed);
  },
);

if (missing.length > 0) {
  test("devnet integration env contract", () => {
    assert.ok(true, `Skipping devnet integration test; missing env: ${missing.join(", ")}`);
  });
}
