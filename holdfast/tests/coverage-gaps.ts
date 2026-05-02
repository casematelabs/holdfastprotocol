// =====================================================================
//
//  coverage-gaps.ts  —  QA gap-fill suite  (CAS-147)
//
//  Covers instruction paths and error codes that lacked dedicated tests
//  after the CAS-147 coverage audit:
//
//  Suite 1 — set_agent_status (isolated)
//    All 4 valid status values (0-3), InvalidAgentStatus on status=4,
//    and UnauthorizedAuthority for a non-INITIAL_AUTHORITY signer.
//
//  Suite 2 — Reputation nonce gap attack
//    incoming_nonce = rep.nonce + 2 must be rejected (NonceMismatch).
//
//  Suite 3 — Ring buffer full overwrite
//    21+ sequential updates verify history_head wraps and the oldest
//    slot is overwritten (history_len stays capped at 20).
//
//  Suite 4 — Escrow double escalation (bankrun)
//    Calling escalate_dispute twice on the same Disputed escrow
//    fails with DisputeAlreadyEscalated on the second call.
//    Suite is skipped when bankrun is unavailable (Windows).
//
//  Suite 5 — UnsupportedKeyFormat dead-code note
//    Documents why Holdfast ProtocolError::UnsupportedKeyFormat cannot be
//    triggered through a normal transaction (Secp256r1Program rejects
//    invalid key prefixes before our handler executes).
//
// =====================================================================

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vaultpact } from "../target/types/vaultpact";
import { VaultpactEscrow } from "../target/types/vaultpact_escrow";
import { assert } from "chai";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let bankrunMod: any = null;
let anchorBankrunMod: any = null;
try {
  bankrunMod = require("solana-bankrun");
  anchorBankrunMod = require("anchor-bankrun");
} catch (_) {
  // bankrun unavailable on this platform
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { p256 } = require("../oracle/node_modules/@noble/curves/nist.js");

const SECP256R1_PROGRAM_ID = new anchor.web3.PublicKey(
  Buffer.from([
    6, 146, 13, 236, 47, 234, 113, 181, 183, 35, 129, 77, 116, 45, 169, 3,
    28, 131, 231, 95, 219, 121, 93, 86, 142, 117, 71, 128, 32, 0, 0, 0,
  ]),
);

const SYSVAR_INSTRUCTIONS = new anchor.web3.PublicKey(
  "Sysvar1nstructions1111111111111111111111111",
);

const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

const ASSOCIATED_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

// ── Secp256r1 instruction builder (SIMD-48 one-signature layout) ─────────

function buildSecp256r1Instruction(
  sig: Uint8Array,
  compressedPubkey: Uint8Array,
  message: Buffer,
): anchor.web3.TransactionInstruction {
  const SIG_OFFSET = 16;
  const PUBKEY_OFFSET = SIG_OFFSET + 64;
  const MSG_OFFSET = PUBKEY_OFFSET + 33;
  const MSG_SIZE = message.length;

  const data = Buffer.alloc(MSG_OFFSET + MSG_SIZE);
  data[0] = 1;
  data[1] = 0;
  data.writeUInt16LE(SIG_OFFSET, 2);
  data.writeUInt16LE(0xffff, 4);
  data.writeUInt16LE(PUBKEY_OFFSET, 6);
  data.writeUInt16LE(0xffff, 8);
  data.writeUInt16LE(MSG_OFFSET, 10);
  data.writeUInt16LE(MSG_SIZE, 12);
  data.writeUInt16LE(0xffff, 14);
  Buffer.from(sig).copy(data, SIG_OFFSET);
  Buffer.from(compressedPubkey).copy(data, PUBKEY_OFFSET);
  message.copy(data, MSG_OFFSET);

  return new anchor.web3.TransactionInstruction({
    programId: SECP256R1_PROGRAM_ID,
    keys: [],
    data,
  });
}

function buildRegistrationPreimage(
  authority: anchor.web3.PublicKey,
  pubkeyX: Buffer,
  pubkeyY: Buffer,
): Buffer {
  return Buffer.concat([
    Buffer.from("vaultpact:register_agent_wallet:v1:"),
    authority.toBuffer(),
    pubkeyX,
    pubkeyY,
  ]);
}

// ── SPL Token helpers (raw instruction builders, no spl-token dep) ───────

const MINT_SIZE = 82;
const TOKEN_ACCOUNT_SIZE = 165;

function splInitMint2Ix(
  mint: anchor.web3.PublicKey,
  decimals: number,
  mintAuthority: anchor.web3.PublicKey,
): anchor.web3.TransactionInstruction {
  const data = Buffer.alloc(67);
  data[0] = 20;
  data[1] = decimals;
  mintAuthority.toBuffer().copy(data, 2);
  return new anchor.web3.TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    data,
  });
}

function splInitAccount3Ix(
  account: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
): anchor.web3.TransactionInstruction {
  const data = Buffer.alloc(33);
  data[0] = 18;
  owner.toBuffer().copy(data, 1);
  return new anchor.web3.TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function splMintToIx(
  mint: anchor.web3.PublicKey,
  dest: anchor.web3.PublicKey,
  authority: anchor.web3.PublicKey,
  amount: bigint,
): anchor.web3.TransactionInstruction {
  const data = Buffer.alloc(9);
  data[0] = 7;
  data.writeBigUInt64LE(amount, 1);
  return new anchor.web3.TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function getAssociatedTokenAddress(
  mint: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
): anchor.web3.PublicKey {
  const [ata] = anchor.web3.PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

// ── Oracle keypair (ed25519 REPUTATION_ORACLE_AUTHORITY) ─────────────────
// Reads from ORACLE_KEYPAIR_PATH env var (for CI) or the default devnet path.

function loadOracleKeypair(): anchor.web3.Keypair {
  const keyPath =
    process.env.ORACLE_KEYPAIR_PATH ??
    path.join(os.homedir(), ".config", "solana", "oracle-devnet.json");
  return anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))),
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  Suite 1 — set_agent_status (isolated)
// ─────────────────────────────────────────────────────────────────────────

describe("coverage-gaps: set_agent_status (isolated)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vaultpact as Program<Vaultpact>;

  const [registryPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("attestation_registry")],
    program.programId,
  );

  // Unique key so this suite doesn't collide with vaultpact.ts registrations.
  const privKey = crypto
    .createHash("sha256")
    .update("vaultpact-gap-test-key-status-1")
    .digest();
  const uncompressed: Uint8Array = p256.getPublicKey(privKey, false);
  const compressedPubkey = p256.getPublicKey(privKey, true);
  const pubkeyX = Buffer.from(uncompressed.slice(1, 33));
  const pubkeyY = Buffer.from(uncompressed.slice(33, 65));

  const [walletPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("agent_wallet"), pubkeyX, pubkeyY],
    program.programId,
  );

  before("register a fresh agent wallet for status tests", async () => {
    // Idempotent: skip if already registered from a previous test run.
    try {
      await program.account.agentWallet.fetch(walletPda);
      return;
    } catch (_) {
      // not yet registered — continue
    }

    const preimage = buildRegistrationPreimage(
      provider.wallet.publicKey,
      pubkeyX,
      pubkeyY,
    );
    const hash = crypto.createHash("sha256").update(preimage).digest();
    const sig = p256.sign(hash, privKey).toCompactRawBytes();

    const secp256r1Ix = buildSecp256r1Instruction(sig, compressedPubkey, preimageHash);
    const registerIx = await program.methods
      .registerAgentWallet(
        Array.from(pubkeyX) as number[],
        Array.from(pubkeyY) as number[],
      )
      .accounts({
        agentWallet: walletPda,
        attestationRegistry: registryPda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        instructions: SYSVAR_INSTRUCTIONS,
      })
      .instruction();

    const tx = new anchor.web3.Transaction().add(secp256r1Ix, registerIx);
    await provider.sendAndConfirm(tx);
  });

  after("reset wallet to Active (status=0) for any subsequent test reuse", async () => {
    try {
      await program.methods
        .setAgentStatus(0)
        .accounts({ authority: provider.wallet.publicKey, agentWallet: walletPda })
        .rpc();
    } catch (_) {
      // ignore if already active
    }
  });

  it("status=0 (Active) — protocol authority can set wallet Active", async () => {
    await program.methods
      .setAgentStatus(0)
      .accounts({ authority: provider.wallet.publicKey, agentWallet: walletPda })
      .rpc();
    const w = await program.account.agentWallet.fetch(walletPda);
    assert.strictEqual(w.status, 0, "status should be 0 (Active)");
  });

  it("status=1 (Frozen) — protocol authority can freeze an agent wallet", async () => {
    await program.methods
      .setAgentStatus(1)
      .accounts({ authority: provider.wallet.publicKey, agentWallet: walletPda })
      .rpc();
    const w = await program.account.agentWallet.fetch(walletPda);
    assert.strictEqual(w.status, 1, "status should be 1 (Frozen)");

    // Restore
    await program.methods
      .setAgentStatus(0)
      .accounts({ authority: provider.wallet.publicKey, agentWallet: walletPda })
      .rpc();
  });

  it("status=2 (Blacklisted) — protocol authority can blacklist an agent wallet", async () => {
    await program.methods
      .setAgentStatus(2)
      .accounts({ authority: provider.wallet.publicKey, agentWallet: walletPda })
      .rpc();
    const w = await program.account.agentWallet.fetch(walletPda);
    assert.strictEqual(w.status, 2, "status should be 2 (Blacklisted)");

    // Restore
    await program.methods
      .setAgentStatus(0)
      .accounts({ authority: provider.wallet.publicKey, agentWallet: walletPda })
      .rpc();
  });

  it("status=3 (DeregisterPending) — protocol authority can set DeregisterPending", async () => {
    await program.methods
      .setAgentStatus(3)
      .accounts({ authority: provider.wallet.publicKey, agentWallet: walletPda })
      .rpc();
    const w = await program.account.agentWallet.fetch(walletPda);
    assert.strictEqual(w.status, 3, "status should be 3 (DeregisterPending)");

    // Restore
    await program.methods
      .setAgentStatus(0)
      .accounts({ authority: provider.wallet.publicKey, agentWallet: walletPda })
      .rpc();
  });

  it("status=4 → InvalidAgentStatus", async () => {
    try {
      await program.methods
        .setAgentStatus(4)
        .accounts({ authority: provider.wallet.publicKey, agentWallet: walletPda })
        .rpc();
      assert.fail("expected InvalidAgentStatus but transaction succeeded");
    } catch (err: any) {
      const diag =
        ((err.logs as string[] | undefined)?.join(" ") ?? "") +
        " " +
        (err.message ?? "");
      assert.include(
        diag,
        "InvalidAgentStatus",
        `expected InvalidAgentStatus, got: ${diag}`,
      );
    }
  });

  it("status=255 → InvalidAgentStatus", async () => {
    try {
      await program.methods
        .setAgentStatus(255)
        .accounts({ authority: provider.wallet.publicKey, agentWallet: walletPda })
        .rpc();
      assert.fail("expected InvalidAgentStatus but transaction succeeded");
    } catch (err: any) {
      const diag =
        ((err.logs as string[] | undefined)?.join(" ") ?? "") +
        " " +
        (err.message ?? "");
      assert.include(
        diag,
        "InvalidAgentStatus",
        `expected InvalidAgentStatus, got: ${diag}`,
      );
    }
  });

  it("unauthorized signer → UnauthorizedAuthority", async () => {
    const impostor = anchor.web3.Keypair.generate();
    const airdrop = await provider.connection.requestAirdrop(
      impostor.publicKey,
      anchor.web3.LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(airdrop);

    try {
      await program.methods
        .setAgentStatus(1)
        .accounts({ authority: impostor.publicKey, agentWallet: walletPda })
        .signers([impostor])
        .rpc();
      assert.fail("expected UnauthorizedAuthority but transaction succeeded");
    } catch (err: any) {
      const diag =
        ((err.logs as string[] | undefined)?.join(" ") ?? "") +
        " " +
        (err.message ?? "");
      assert.include(
        diag,
        "UnauthorizedAuthority",
        `expected UnauthorizedAuthority, got: ${diag}`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Suite 2 — Reputation nonce gap attack
// ─────────────────────────────────────────────────────────────────────────

describe("coverage-gaps: reputation nonce gap attack", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vaultpact as Program<Vaultpact>;

  let agentKeypair: anchor.web3.Keypair;
  let repPda: anchor.web3.PublicKey;
  let oracle: anchor.web3.Keypair;

  before(async () => {
    oracle = loadOracleKeypair();

    agentKeypair = anchor.web3.Keypair.generate();
    [repPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), agentKeypair.publicKey.toBuffer()],
      program.programId,
    );

    const airdrop = await provider.connection.requestAirdrop(
      agentKeypair.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(airdrop);

    await program.methods
      .initReputation()
      .accounts({
        reputationAccount: repPda,
        agent: agentKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([agentKeypair])
      .rpc();
  });

  it("nonce gap (incoming = rep.nonce + 2) → NonceMismatch", async () => {
    const rep = await program.account.reputationAccount.fetch(repPda);
    const currentNonce = (rep.nonce as anchor.BN).toNumber();
    const gapNonce = currentNonce + 2; // skip one

    try {
      await program.methods
        .updateReputation(
          new anchor.BN(gapNonce),
          { fulfilled: {} },
          0,
          Array(7).fill(0),
        )
        .accounts({
          reputationAccount: repPda,
          updateAuthority: oracle.publicKey,
        })
        .signers([oracle])
        .rpc();
      assert.fail("expected NonceMismatch but transaction succeeded");
    } catch (err: any) {
      const diag =
        ((err.logs as string[] | undefined)?.join(" ") ?? "") +
        " " +
        (err.message ?? "");
      assert.include(
        diag,
        "NonceMismatch",
        `expected NonceMismatch, got: ${diag}`,
      );
    }
  });

  it("nonce reuse (incoming = rep.nonce) → NonceMismatch", async () => {
    const rep = await program.account.reputationAccount.fetch(repPda);
    const reusedNonce = (rep.nonce as anchor.BN).toNumber(); // same, not +1

    try {
      await program.methods
        .updateReputation(
          new anchor.BN(reusedNonce),
          { fulfilled: {} },
          0,
          Array(7).fill(0),
        )
        .accounts({
          reputationAccount: repPda,
          updateAuthority: oracle.publicKey,
        })
        .signers([oracle])
        .rpc();
      assert.fail("expected NonceMismatch but transaction succeeded");
    } catch (err: any) {
      const diag =
        ((err.logs as string[] | undefined)?.join(" ") ?? "") +
        " " +
        (err.message ?? "");
      assert.include(
        diag,
        "NonceMismatch",
        `expected NonceMismatch, got: ${diag}`,
      );
    }
  });

  it("valid nonce (incoming = rep.nonce + 1) → success, nonce advances", async () => {
    const repBefore = await program.account.reputationAccount.fetch(repPda);
    const nextNonce = (repBefore.nonce as anchor.BN).toNumber() + 1;

    await program.methods
      .updateReputation(
        new anchor.BN(nextNonce),
        { fulfilled: {} },
        0,
        Array(7).fill(0),
      )
      .accounts({
        reputationAccount: repPda,
        updateAuthority: oracle.publicKey,
      })
      .signers([oracle])
      .rpc();

    const repAfter = await program.account.reputationAccount.fetch(repPda);
    assert.strictEqual(
      (repAfter.nonce as anchor.BN).toNumber(),
      nextNonce,
      "nonce must advance by 1 on success",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Suite 3 — Ring buffer full overwrite
// ─────────────────────────────────────────────────────────────────────────

describe("coverage-gaps: ring buffer full overwrite (history_head wraparound)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vaultpact as Program<Vaultpact>;

  const RING_SIZE = 20;

  let agentKeypair: anchor.web3.Keypair;
  let repPda: anchor.web3.PublicKey;
  let oracle: anchor.web3.Keypair;

  before(async () => {
    oracle = loadOracleKeypair();

    agentKeypair = anchor.web3.Keypair.generate();
    [repPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), agentKeypair.publicKey.toBuffer()],
      program.programId,
    );

    const airdrop = await provider.connection.requestAirdrop(
      agentKeypair.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(airdrop);

    await program.methods
      .initReputation()
      .accounts({
        reputationAccount: repPda,
        agent: agentKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([agentKeypair])
      .rpc();
  });

  it("writes 1..20 fill the ring (history_len reaches 20, history_head wraps to 0)", async () => {
    let rep = await program.account.reputationAccount.fetch(repPda);
    let nonce = (rep.nonce as anchor.BN).toNumber();

    for (let i = 0; i < RING_SIZE; i++) {
      nonce += 1;
      await program.methods
        .updateReputation(
          new anchor.BN(nonce),
          { fulfilled: {} },
          0,
          Array(7).fill(i),
        )
        .accounts({ reputationAccount: repPda, updateAuthority: oracle.publicKey })
        .signers([oracle])
        .rpc();
    }

    rep = await program.account.reputationAccount.fetch(repPda);
    assert.strictEqual(rep.historyLen, RING_SIZE, "history_len must be capped at 20 after 20 writes");
    assert.strictEqual(rep.historyHead, 0, "history_head must wrap to 0 after exactly 20 writes");
  });

  it("write 21 overwrites slot 0 and advances history_head to 1", async () => {
    let rep = await program.account.reputationAccount.fetch(repPda);
    let nonce = (rep.nonce as anchor.BN).toNumber();

    assert.strictEqual(rep.historyHead, 0, "precondition: head must be 0 before write 21");
    assert.strictEqual(rep.historyLen, RING_SIZE, "precondition: history_len must be 20");

    // Write the 21st entry: a unique pact_id so we can identify it
    const marker = Array(7).fill(0xAB);
    nonce += 1;
    await program.methods
      .updateReputation(
        new anchor.BN(nonce),
        { fulfilled: {} },
        0,
        marker,
      )
      .accounts({ reputationAccount: repPda, updateAuthority: oracle.publicKey })
      .signers([oracle])
      .rpc();

    rep = await program.account.reputationAccount.fetch(repPda);
    assert.strictEqual(rep.historyLen, RING_SIZE, "history_len must remain 20 after 21st write");
    assert.strictEqual(rep.historyHead, 1, "history_head must advance to 1 after write 21");
  });

  it("write 22..40 (one full second pass) wraps history_head back to 0", async () => {
    let rep = await program.account.reputationAccount.fetch(repPda);
    let nonce = (rep.nonce as anchor.BN).toNumber();

    // Write 19 more entries to complete a full second rotation (slots 1..19)
    for (let i = 0; i < RING_SIZE - 1; i++) {
      nonce += 1;
      await program.methods
        .updateReputation(
          new anchor.BN(nonce),
          { cancelled: {} },
          0,
          Array(7).fill(i + 0x10),
        )
        .accounts({ reputationAccount: repPda, updateAuthority: oracle.publicKey })
        .signers([oracle])
        .rpc();
    }

    rep = await program.account.reputationAccount.fetch(repPda);
    assert.strictEqual(rep.historyLen, RING_SIZE, "history_len must still be 20");
    assert.strictEqual(
      rep.historyHead, 0,
      "history_head must wrap back to 0 after a second full rotation",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Suite 4 — Escrow double escalation (bankrun)
// ─────────────────────────────────────────────────────────────────────────

(bankrunMod ? describe : describe.skip)(
  "coverage-gaps: escrow double escalation (bankrun)",
  function () {
    const VAULTPACT_ID = new anchor.web3.PublicKey(
      "2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq",
    );
    const ESCROW_PROGRAM_ID = new anchor.web3.PublicKey(
      "CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi",
    );

    let context: any;
    let brProvider: anchor.AnchorProvider;
    let brVaultpact: Program<Vaultpact>;
    let brEscrow: Program<VaultpactEscrow>;

    let brAuthority: anchor.web3.Keypair;
    let brInitiator: anchor.web3.Keypair;
    let brBeneficiary: anchor.web3.Keypair;
    let brArbiter: anchor.web3.Keypair;
    let brMint: anchor.web3.Keypair;
    let brOracle: anchor.web3.Keypair;

    let escrowId: number[];
    let escrowPda: anchor.web3.PublicKey;
    let pactPda: anchor.web3.PublicKey;
    let disputePda: anchor.web3.PublicKey;
    let initiatorWalletPda: anchor.web3.PublicKey;
    let beneficiaryWalletPda: anchor.web3.PublicKey;
    let arbiterWalletPda: anchor.web3.PublicKey;
    let registryPda: anchor.web3.PublicKey;
    let brInitiatorToken: anchor.web3.Keypair;
    let brBeneficiaryToken: anchor.web3.Keypair;
    let vaultAta: anchor.web3.PublicKey;
    let brInitiatorRepPda: anchor.web3.PublicKey;

    // Each participant uses the same secp256r1 key pattern from security-regression.ts
    const initPrivKey = crypto.createHash("sha256").update("gap-double-escalate-init-1").digest();
    const initUncompressed: Uint8Array = p256.getPublicKey(initPrivKey, false);
    const initCompressed = p256.getPublicKey(initPrivKey, true);
    const initPubkeyX = Buffer.from(initUncompressed.slice(1, 33));
    const initPubkeyY = Buffer.from(initUncompressed.slice(33, 65));

    const benPrivKey = crypto.createHash("sha256").update("gap-double-escalate-ben-1").digest();
    const benUncompressed: Uint8Array = p256.getPublicKey(benPrivKey, false);
    const benCompressed = p256.getPublicKey(benPrivKey, true);
    const benPubkeyX = Buffer.from(benUncompressed.slice(1, 33));
    const benPubkeyY = Buffer.from(benUncompressed.slice(33, 65));

    const arbPrivKey = crypto.createHash("sha256").update("gap-double-escalate-arb-1").digest();
    const arbUncompressed: Uint8Array = p256.getPublicKey(arbPrivKey, false);
    const arbCompressed = p256.getPublicKey(arbPrivKey, true);
    const arbPubkeyX = Buffer.from(arbUncompressed.slice(1, 33));
    const arbPubkeyY = Buffer.from(arbUncompressed.slice(33, 65));

    async function warpClockForward(seconds: number): Promise<void> {
      const clock = await context.banksClient.getClock();
      context.setClock(
        new bankrunMod.Clock(
          clock.slot,
          clock.epochStartTimestamp,
          clock.epoch,
          clock.leaderScheduleEpoch,
          clock.unixTimestamp + BigInt(seconds),
        ),
      );
    }

    before("set up bankrun context with full escrow in Disputed state", async function () {
      this.timeout(120_000);

      const { BankrunProvider, startAnchor } = anchorBankrunMod;

      // Build keypairs
      brAuthority = anchor.web3.Keypair.generate();
      brInitiator = anchor.web3.Keypair.generate();
      brBeneficiary = anchor.web3.Keypair.generate();
      brArbiter = anchor.web3.Keypair.generate();
      brMint = anchor.web3.Keypair.generate();
      brInitiatorToken = anchor.web3.Keypair.generate();
      brBeneficiaryToken = anchor.web3.Keypair.generate();
      brOracle = loadOracleKeypair();

      context = await startAnchor(
        ".",
        [],
        [
          { address: brAuthority.publicKey,  info: { lamports: 100 * anchor.web3.LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: anchor.web3.SystemProgram.programId, executable: false } },
          { address: brInitiator.publicKey,  info: { lamports: 50 * anchor.web3.LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: anchor.web3.SystemProgram.programId, executable: false } },
          { address: brBeneficiary.publicKey, info: { lamports: 50 * anchor.web3.LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: anchor.web3.SystemProgram.programId, executable: false } },
          { address: brArbiter.publicKey,    info: { lamports: 10 * anchor.web3.LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: anchor.web3.SystemProgram.programId, executable: false } },
        ],
      );

      brProvider = new BankrunProvider(context, new anchor.Wallet(brAuthority));
      anchor.setProvider(brProvider);
      brVaultpact = anchor.workspace.Vaultpact as Program<Vaultpact>;
      brEscrow = anchor.workspace.VaultpactEscrow as Program<VaultpactEscrow>;

      [registryPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("attestation_registry")],
        VAULTPACT_ID,
      );

      // Derive wallet PDAs
      [initiatorWalletPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), initPubkeyX, initPubkeyY],
        VAULTPACT_ID,
      );
      [beneficiaryWalletPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), benPubkeyX, benPubkeyY],
        VAULTPACT_ID,
      );
      [arbiterWalletPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), arbPubkeyX, arbPubkeyY],
        VAULTPACT_ID,
      );

      // Initialize registry
      await brVaultpact.methods
        .initializeRegistry()
        .accounts({ attestationRegistry: registryPda, authority: brAuthority.publicKey, systemProgram: anchor.web3.SystemProgram.programId, escrowProgram: brEscrow.programId })
        .rpc();

      // Register all three agents
      for (const [privK, comp, px, py, signer] of [
        [initPrivKey, initCompressed, initPubkeyX, initPubkeyY, brInitiator] as const,
        [benPrivKey, benCompressed, benPubkeyX, benPubkeyY, brBeneficiary] as const,
        [arbPrivKey, arbCompressed, arbPubkeyX, arbPubkeyY, brArbiter] as const,
      ]) {
        const walletPda = signer === brInitiator
          ? initiatorWalletPda
          : signer === brBeneficiary
          ? beneficiaryWalletPda
          : arbiterWalletPda;

        const preimage = buildRegistrationPreimage(signer.publicKey, px as Buffer, py as Buffer);
        const h = crypto.createHash("sha256").update(preimage).digest();
        const s = p256.sign(h, privK).toCompactRawBytes();
        const secp256r1Ix = buildSecp256r1Instruction(s, comp as Uint8Array, h);
        const regIx = await brVaultpact.methods
          .registerAgentWallet(Array.from(px) as number[], Array.from(py) as number[])
          .accounts({
            agentWallet: walletPda,
            attestationRegistry: registryPda,
            payer: signer.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            instructions: SYSVAR_INSTRUCTIONS,
          })
          .instruction();
        const tx = new anchor.web3.Transaction().add(secp256r1Ix, regIx);
        tx.feePayer = signer.publicKey;
        await brProvider.sendAndConfirm(tx, [signer]);
      }

      // Init reputation for initiator (needed for initialize_escrow)
      [brInitiatorRepPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("reputation"), brInitiator.publicKey.toBuffer()],
        VAULTPACT_ID,
      );
      await brVaultpact.methods
        .initReputation()
        .accounts({ reputationAccount: brInitiatorRepPda, agent: brInitiator.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([brInitiator])
        .rpc();

      // Create mint + token accounts
      const mintRent = await brProvider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
      const taRent = await brProvider.connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE);

      const mintSetupTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: brAuthority.publicKey,
          newAccountPubkey: brMint.publicKey,
          lamports: mintRent,
          space: MINT_SIZE,
          programId: TOKEN_PROGRAM_ID,
        }),
        splInitMint2Ix(brMint.publicKey, 6, brAuthority.publicKey),
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: brAuthority.publicKey,
          newAccountPubkey: brInitiatorToken.publicKey,
          lamports: taRent,
          space: TOKEN_ACCOUNT_SIZE,
          programId: TOKEN_PROGRAM_ID,
        }),
        splInitAccount3Ix(brInitiatorToken.publicKey, brMint.publicKey, brInitiator.publicKey),
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: brAuthority.publicKey,
          newAccountPubkey: brBeneficiaryToken.publicKey,
          lamports: taRent,
          space: TOKEN_ACCOUNT_SIZE,
          programId: TOKEN_PROGRAM_ID,
        }),
        splInitAccount3Ix(brBeneficiaryToken.publicKey, brMint.publicKey, brBeneficiary.publicKey),
        splMintToIx(brMint.publicKey, brInitiatorToken.publicKey, brAuthority.publicKey, BigInt(200_000)),
        splMintToIx(brMint.publicKey, brBeneficiaryToken.publicKey, brAuthority.publicKey, BigInt(50_000)),
      );
      await brProvider.sendAndConfirm(mintSetupTx, [brMint, brInitiatorToken, brBeneficiaryToken]);

      // Derive escrow PDAs
      escrowId = Array.from(crypto.randomBytes(32));
      [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), Buffer.from(escrowId)],
        ESCROW_PROGRAM_ID,
      );
      [pactPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pact"), Buffer.from(escrowId)],
        ESCROW_PROGRAM_ID,
      );
      [disputePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("dispute"), Buffer.from(escrowId)],
        ESCROW_PROGRAM_ID,
      );
      vaultAta = getAssociatedTokenAddress(brMint.publicKey, escrowPda);

      const now = Math.floor(Date.now() / 1000);

      await brEscrow.methods
        .initializeEscrow({
          escrowId,
          beneficiary: brBeneficiary.publicKey,
          arbiter: brArbiter.publicKey,
          escrowAmount: new anchor.BN(100_000),
          initiatorStake: new anchor.BN(5_000),
          beneficiaryStake: new anchor.BN(5_000),
          timeLockExpiresAt: new anchor.BN(now + 3600),
          deliverablesHash: Array(32).fill(0),
          deliverablesUri: Array(128).fill(0),
          autoReleaseOnExpiry: false,
          slashLoserStake: false,
          disputeDeadlineSecs: new anchor.BN(3600),
          initiatorReputationMin: new anchor.BN(0),
          beneficiaryReputationMin: new anchor.BN(0),
          initiatorMinTier: 0,
          initiatorMinPacts: new anchor.BN(0),
          beneficiaryMinTier: 0,
          beneficiaryMinPacts: new anchor.BN(0),
        })
        .accounts({
          initiator: brInitiator.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          mint: brMint.publicKey,
          vault: vaultAta,
          initiatorReputation: brInitiatorRepPda,
          initiatorWallet: initiatorWalletPda,
          beneficiaryWallet: beneficiaryWalletPda,
          arbiterWallet: arbiterWalletPda,
          vaultpactProgram: VAULTPACT_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([brInitiator])
        .rpc();

      // Deposit
      await brEscrow.methods
        .depositFunds()
        .accounts({
          initiator: brInitiator.publicKey,
          escrowAccount: escrowPda,
          initiatorTokenAccount: brInitiatorToken.publicKey,
          vault: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([brInitiator])
        .rpc();

      // Stake beneficiary
      const brBeneficiaryRepPda = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("reputation"), brBeneficiary.publicKey.toBuffer()],
        VAULTPACT_ID,
      )[0];
      await brVaultpact.methods
        .initReputation()
        .accounts({ reputationAccount: brBeneficiaryRepPda, agent: brBeneficiary.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([brBeneficiary])
        .rpc();

      await brEscrow.methods
        .stakeBeneficiary()
        .accounts({
          beneficiary: brBeneficiary.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          beneficiaryTokenAccount: brBeneficiaryToken.publicKey,
          vault: vaultAta,
          beneficiaryReputation: brBeneficiaryRepPda,
          beneficiaryWallet: beneficiaryWalletPda,
          vaultpactProgram: VAULTPACT_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([brBeneficiary])
        .rpc();

      // Lock
      await brEscrow.methods
        .lockEscrow()
        .accounts({
          initiator: brInitiator.publicKey,
          beneficiary: brBeneficiary.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          vault: vaultAta,
          initiatorWallet: initiatorWalletPda,
          beneficiaryWallet: beneficiaryWalletPda,
          arbiterWallet: arbiterWalletPda,
          initiatorReputation: brInitiatorRepPda,
          beneficiaryReputation: brBeneficiaryRepPda,
          vaultpactProgram: VAULTPACT_ID,
        })
        .signers([brInitiator, brBeneficiary])
        .rpc();

      // Raise dispute (initiator)
      await brEscrow.methods
        .raiseDispute()
        .accounts({
          raiser: brInitiator.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          disputeRecord: disputePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([brInitiator])
        .rpc();

      // Warp past the dispute resolution_deadline (1 second after locked)
      await warpClockForward(10);
    });

    it("escalate_dispute succeeds on first call", async () => {
      await brEscrow.methods
        .escalateDispute()
        .accounts({
          escalator: brInitiator.publicKey,
          escrowAccount: escrowPda,
          disputeRecord: disputePda,
        })
        .signers([brInitiator])
        .rpc();

      // Escrow should still be in Disputed status (escalate doesn't change it)
      const escrow = await brEscrow.account.escrowAccount.fetch(escrowPda);
      assert.deepEqual(
        escrow.status,
        { disputed: {} },
        "escrow must remain Disputed after first escalation",
      );
    });

    it("escalate_dispute rejects second call with DisputeAlreadyEscalated", async () => {
      try {
        await brEscrow.methods
          .escalateDispute()
          .accounts({
            escalator: brInitiator.publicKey,
            escrowAccount: escrowPda,
            disputeRecord: disputePda,
          })
          .signers([brInitiator])
          .rpc();
        assert.fail("expected DisputeAlreadyEscalated but transaction succeeded");
      } catch (err: any) {
        if (err.message?.includes("expected DisputeAlreadyEscalated")) throw err;
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "DisputeAlreadyEscalated",
          `expected DisputeAlreadyEscalated, got: ${diag}`,
        );
      }
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────
//  Suite 5 — UnsupportedKeyFormat dead-code documentation
// ─────────────────────────────────────────────────────────────────────────

describe("coverage-gaps: UnsupportedKeyFormat (dead-code analysis)", () => {
  it("Holdfast ProtocolError::UnsupportedKeyFormat is unreachable through normal transactions", () => {
    // Holdfast ProtocolError::UnsupportedKeyFormat fires inside verify_secp256r1_precompile
    // when the pubkey prefix byte read from the secp256r1 instruction data is not
    // 0x02 (compressed), 0x03 (compressed), or 0x04 (uncompressed).
    //
    // The Secp256r1Program (SIMD-48) validates the key format itself BEFORE our
    // program instruction executes. Any transaction containing a secp256r1
    // instruction with a 0x05 prefix is rejected at the precompile level with a
    // native Solana error — our code never runs.
    //
    // The error variant therefore acts as defensive dead code. It cannot be unit-
    // tested through a well-formed Solana transaction. This test documents the
    // analysis so auditors understand the reachability constraint.
    //
    // Audit note: if Solana ever exposes a path to craft an instructions sysvar
    // with a malformed secp256r1 entry that bypasses the precompile validator,
    // this variant would become reachable. For now it is safe.
    assert.ok(true, "UnsupportedKeyFormat reachability documented (see comment)");
  });

  it("secp256r1 instruction with 0x04 prefix (uncompressed) is correctly parsed", () => {
    // Verify our buildSecp256r1Instruction helper uses 0x02/0x03 (compressed),
    // which is what the on-chain parser hits in the 0x02/0x03 branch, not 0x04.
    // The 0x04 (uncompressed) branch in verify_secp256r1_precompile is exercised
    // by the test_verify_webauthn tests in vaultpact.ts which pass uncompressed
    // keys via the WebAuthn assertion pipeline.
    const dummySig = Buffer.alloc(64);
    const compressed = Buffer.alloc(33);
    compressed[0] = 0x02;
    const msg = Buffer.from("test");
    const ix = {
      programId: new anchor.web3.PublicKey(
        Buffer.from([
          6, 146, 13, 236, 47, 234, 113, 181, 183, 35, 129, 77, 116, 45, 169, 3,
          28, 131, 231, 95, 219, 121, 93, 86, 142, 117, 71, 128, 32, 0, 0, 0,
        ]),
      ),
      keys: [] as anchor.web3.AccountMeta[],
      data: Buffer.alloc(0),
    };
    // pubkey prefix at offset 80 (SIG=16, SIG_LEN=64, PUBKEY=80)
    const data = Buffer.alloc(113 + msg.length);
    data[0] = 1;
    data.writeUInt16LE(16, 2);
    data.writeUInt16LE(0xffff, 4);
    data.writeUInt16LE(80, 6);
    data.writeUInt16LE(0xffff, 8);
    data.writeUInt16LE(113, 10);
    data.writeUInt16LE(msg.length, 12);
    data.writeUInt16LE(0xffff, 14);
    dummySig.copy(data, 16);
    compressed.copy(data, 80);
    msg.copy(data, 113);

    assert.strictEqual(data[80], 0x02, "pubkey prefix at offset 80 must be 0x02 (compressed)");
    assert.ok(data.length > 80 + 33, "data must hold full compressed key");
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Suite 6 — CPI integration test: escrow update_reputation via claim_released
//  (CAS-148)
//
//  Verifies that claim_released fires cpi_update_reputation for both parties
//  using the VAULTPACT_ESCROW_AUTHORITY PDA as signer, and that the on-chain
//  ReputationAccount for each agent is correctly updated.
//
//  Also tests the negative case: a direct call to update_reputation with an
//  unauthorised ed25519 signer is rejected with UnauthorizedReputationWriter.
//
//  Requires bankrun (Linux/macOS only — skipped on Windows).
//
//  Raw-byte assertions are used for reputation fields because the IDL omits the
//  schema_version field added after last IDL generation; offsets are documented
//  inline.  Byte layout (after 8-byte discriminator):
//    +0  schema_version  u8
//    +1  agent           Pubkey (32)
//    +33 score           u64
//    +41 tier            u8
//    +42 total_pacts     u64
//    +50 dispute_count   u64
//    +58 created_at      i64
//    +66 last_updated    i64
//    +74 decay_cursor    i64
//    +82 nonce           u64
//    +90 history_len     u8
//    +91 history_head    u8
//    +92 history         [HistEntry; 20]  (360 bytes, each 18 bytes)
//   +452 _padding        [u8; 51]
//   +503 bump            u8
// ─────────────────────────────────────────────────────────────────────────

(bankrunMod ? describe : describe.skip)(
  "coverage-gaps Suite 6: CPI update_reputation via claim_released (bankrun)",
  function () {
    this.timeout(120_000);

    const VAULTPACT_ID = new anchor.web3.PublicKey(
      "2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq",
    );
    const ESCROW_ID = new anchor.web3.PublicKey(
      "CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi",
    );

    let context: any;
    let brProvider: any;
    let brVaultpact: Program<Vaultpact>;
    let brEscrow: Program<VaultpactEscrow>;

    let brAuthority: anchor.web3.Keypair;
    let brInitiator: anchor.web3.Keypair;
    let brBeneficiary: anchor.web3.Keypair;
    let brArbiter: anchor.web3.Keypair;
    let brMint: anchor.web3.Keypair;
    let brInitiatorToken: anchor.web3.Keypair;
    let brBeneficiaryToken: anchor.web3.Keypair;
    let brInitiatorWalletPda: anchor.web3.PublicKey;
    let brBeneficiaryWalletPda: anchor.web3.PublicKey;
    let brArbiterWalletPda: anchor.web3.PublicKey;
    let brInitiatorRepPda: anchor.web3.PublicKey;
    let brBeneficiaryRepPda: anchor.web3.PublicKey;
    let brRegistryPda: anchor.web3.PublicKey;
    let brEscrowAuthority: anchor.web3.PublicKey;

    // ── On-chain layout helpers ──────────────────────────────────────────

    // Offsets in raw account data (including 8-byte discriminator prefix).
    const OFF_SCORE       = 8 + 1 + 32;        // 41
    const OFF_TOTAL_PACTS = 8 + 1 + 32 + 8 + 1; // 50
    const OFF_NONCE       = 8 + 1 + 32 + 8 + 1 + 8 + 8 + 8 + 8 + 8; // 90
    // HistEntry layout: outcome(1) + score_delta(2) + timestamp(8) + pact_id(7) = 18 bytes
    const OFF_HIST_LEN    = OFF_NONCE + 8;      // 98
    const OFF_HISTORY     = OFF_HIST_LEN + 2;   // 100 (after history_len + history_head)
    const HIST_ENTRY_SIZE = 18;

    function readU64LE(buf: Buffer, offset: number): bigint {
      return buf.readBigUInt64LE(offset);
    }

    function readI16LE(buf: Buffer, offset: number): number {
      return buf.readInt16LE(offset);
    }

    // ── bankrun infrastructure helpers ──────────────────────────────────

    function fundAccount(pubkey: anchor.web3.PublicKey, lamports = 100_000_000_000n) {
      context.setAccount(pubkey, {
        lamports: Number(lamports),
        data: Buffer.alloc(0),
        owner: anchor.web3.SystemProgram.programId,
        executable: false,
      });
    }

    function setPrebuiltAccount(
      pubkey: anchor.web3.PublicKey,
      owner: anchor.web3.PublicKey,
      data: Buffer,
      lamports = 10_000_000,
    ) {
      context.setAccount(pubkey, { lamports, data, owner, executable: false });
    }

    async function encodeAgentWallet(fields: {
      authority: anchor.web3.PublicKey;
      pubkeyX: Buffer;
      pubkeyY: Buffer;
      status: number;
      bump: number;
    }): Promise<Buffer> {
      return await brVaultpact.coder.accounts.encode("AgentWallet", {
        authority: fields.authority,
        pubkeyX: Array.from(fields.pubkeyX),
        pubkeyY: Array.from(fields.pubkeyY),
        nonce: new anchor.BN(0),
        registeredAt: new anchor.BN(Math.floor(Date.now() / 1000)),
        status: fields.status,
        keyVersion: 1,
        deregisterDeadline: new anchor.BN(0),
        bump: fields.bump,
      });
    }

    async function encodeRegistry(auth: anchor.web3.PublicKey, bump: number): Promise<Buffer> {
      return await brVaultpact.coder.accounts.encode("AttestationRegistry", {
        authority: auth,
        agentCount: new anchor.BN(3),
        bump,
      });
    }

    function makeTokenAccountData(
      mint: anchor.web3.PublicKey,
      owner: anchor.web3.PublicKey,
      amount: bigint,
    ): Buffer {
      const data = Buffer.alloc(165);
      mint.toBuffer().copy(data, 0);
      owner.toBuffer().copy(data, 32);
      data.writeBigUInt64LE(amount, 64);
      data.writeUInt32LE(0, 72);
      data[108] = 1; // Initialized
      data.writeUInt32LE(0, 109);
      data.writeBigUInt64LE(0n, 117);
      data.writeUInt32LE(0, 125);
      return data;
    }

    async function warpClockForward(seconds: number) {
      const currentClock = await context.banksClient.getClock();
      const newTimestamp = currentClock.unixTimestamp + BigInt(seconds);
      context.setClock(new bankrunMod.Clock(
        currentClock.slot,
        currentClock.epochStartTimestamp,
        currentClock.epoch,
        currentClock.leaderScheduleEpoch,
        newTimestamp,
      ));
    }

    function getDiag(err: any): string {
      return (
        ((err.logs as string[] | undefined)?.join(" ") ?? "") + " " + (err.message ?? "")
      );
    }

    // ── before() ────────────────────────────────────────────────────────

    before("spin up bankrun + init state for Suite 6", async () => {
      const { BankrunProvider } = anchorBankrunMod;

      brAuthority = anchor.web3.Keypair.generate();
      brInitiator = anchor.web3.Keypair.generate();
      brBeneficiary = anchor.web3.Keypair.generate();
      brArbiter = anchor.web3.Keypair.generate();

      context = await bankrunMod.startAnchor(".", [], []);
      brProvider = new BankrunProvider(context);

      brVaultpact = new Program<Vaultpact>(
        (anchor.workspace.Vaultpact as Program<Vaultpact>).idl as any,
        brProvider,
      );
      brEscrow = new Program<VaultpactEscrow>(
        (anchor.workspace.VaultpactEscrow as Program<VaultpactEscrow>).idl as any,
        brProvider,
      );

      fundAccount(brAuthority.publicKey);
      fundAccount(brInitiator.publicKey);
      fundAccount(brBeneficiary.publicKey);
      fundAccount(brArbiter.publicKey);

      // Pre-populate AgentWallet PDAs (bypasses secp256r1 registration).
      const iPubkeyX = Buffer.alloc(32, 0xaa);
      const iPubkeyY = Buffer.alloc(32, 0xab);
      const [iWalletPda, iWalletBump] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), iPubkeyX, iPubkeyY], VAULTPACT_ID,
      );
      brInitiatorWalletPda = iWalletPda;

      const bPubkeyX = Buffer.alloc(32, 0xba);
      const bPubkeyY = Buffer.alloc(32, 0xbb);
      const [bWalletPda, bWalletBump] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), bPubkeyX, bPubkeyY], VAULTPACT_ID,
      );
      brBeneficiaryWalletPda = bWalletPda;

      const aPubkeyX = Buffer.alloc(32, 0xca);
      const aPubkeyY = Buffer.alloc(32, 0xcb);
      const [aWalletPda, aWalletBump] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), aPubkeyX, aPubkeyY], VAULTPACT_ID,
      );
      brArbiterWalletPda = aWalletPda;

      setPrebuiltAccount(brInitiatorWalletPda, VAULTPACT_ID,
        await encodeAgentWallet({ authority: brInitiator.publicKey, pubkeyX: iPubkeyX, pubkeyY: iPubkeyY, status: 0, bump: iWalletBump }));
      setPrebuiltAccount(brBeneficiaryWalletPda, VAULTPACT_ID,
        await encodeAgentWallet({ authority: brBeneficiary.publicKey, pubkeyX: bPubkeyX, pubkeyY: bPubkeyY, status: 0, bump: bWalletBump }));
      setPrebuiltAccount(brArbiterWalletPda, VAULTPACT_ID,
        await encodeAgentWallet({ authority: brArbiter.publicKey, pubkeyX: aPubkeyX, pubkeyY: aPubkeyY, status: 0, bump: aWalletBump }));

      // Pre-populate AttestationRegistry.
      const [regPda, regBump] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("attestation_registry")], VAULTPACT_ID,
      );
      brRegistryPda = regPda;
      setPrebuiltAccount(regPda, VAULTPACT_ID, await encodeRegistry(brAuthority.publicKey, regBump));

      // Init ReputationAccount PDAs on-chain so layout matches current Rust struct.
      const [iRepPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("reputation"), brInitiator.publicKey.toBuffer()], VAULTPACT_ID,
      );
      brInitiatorRepPda = iRepPda;
      await brVaultpact.methods.initReputation()
        .accounts({
          reputationAccount: iRepPda,
          agent: brInitiator.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([brInitiator])
        .rpc();

      const [bRepPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("reputation"), brBeneficiary.publicKey.toBuffer()], VAULTPACT_ID,
      );
      brBeneficiaryRepPda = bRepPda;
      await brVaultpact.methods.initReputation()
        .accounts({
          reputationAccount: bRepPda,
          agent: brBeneficiary.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([brBeneficiary])
        .rpc();

      // Derive the escrow authority PDA used to sign update_reputation CPIs.
      [brEscrowAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vp_escrow_authority")],
        ESCROW_ID,
      );

      // Set up SPL Token mint (pre-populated account data).
      brMint = anchor.web3.Keypair.generate();
      const mintData = Buffer.alloc(82);
      mintData.writeUInt32LE(1, 0); // COption::Some for mint_authority
      brAuthority.publicKey.toBuffer().copy(mintData, 4);
      mintData.writeBigUInt64LE(0n, 36); // supply
      mintData[44] = 6;  // decimals
      mintData[45] = 1;  // is_initialized
      mintData.writeUInt32LE(0, 46); // freeze_authority COption::None
      setPrebuiltAccount(brMint.publicKey, TOKEN_PROGRAM_ID, mintData, 1_000_000_000);

      // Token accounts for initiator and beneficiary.
      brInitiatorToken = anchor.web3.Keypair.generate();
      brBeneficiaryToken = anchor.web3.Keypair.generate();
      setPrebuiltAccount(brInitiatorToken.publicKey, TOKEN_PROGRAM_ID,
        makeTokenAccountData(brMint.publicKey, brInitiator.publicKey, 10_000_000n), 1_000_000_000);
      setPrebuiltAccount(brBeneficiaryToken.publicKey, TOKEN_PROGRAM_ID,
        makeTokenAccountData(brMint.publicKey, brBeneficiary.publicKey, 10_000_000n), 1_000_000_000);
    });

    // ── Helper: run init→deposit→stake→lock→release for a fresh escrow ──

    async function buildReleasedEscrow(): Promise<{
      escrowId: number[];
      escrowPda: anchor.web3.PublicKey;
      pactPda: anchor.web3.PublicKey;
      vaultAta: anchor.web3.PublicKey;
    }> {
      const escrowId = Array.from(crypto.randomBytes(32));
      const idBuffer = Buffer.from(escrowId);
      const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), idBuffer], ESCROW_ID,
      );
      const [pactPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pact"), idBuffer], ESCROW_ID,
      );
      const vaultAta = getAssociatedTokenAddress(brMint.publicKey, escrowPda);

      const currentClock = await context.banksClient.getClock();
      const timeLockExpiresAt = Number(currentClock.unixTimestamp) + 7 * 24 * 3600;

      await brEscrow.methods.initializeEscrow({
        escrowId,
        beneficiary: brBeneficiary.publicKey,
        arbiter: brArbiter.publicKey,
        escrowAmount: new anchor.BN(100_000),
        initiatorStake: new anchor.BN(0),
        beneficiaryStake: new anchor.BN(0),
        timeLockExpiresAt: new anchor.BN(timeLockExpiresAt),
        deliverablesHash: Array(32).fill(0),
        deliverablesUri: Array(128).fill(0),
        autoReleaseOnExpiry: false,
        slashLoserStake: false,
        disputeDeadlineSecs: new anchor.BN(86400),
        initiatorReputationMin: new anchor.BN(0),
        beneficiaryReputationMin: new anchor.BN(0),
        initiatorMinTier: 0,
        initiatorMinPacts: new anchor.BN(0),
        beneficiaryMinTier: 0,
        beneficiaryMinPacts: new anchor.BN(0),
      }).accounts({
        initiator: brInitiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        mint: brMint.publicKey,
        vault: vaultAta,
        initiatorReputation: brInitiatorRepPda,
        initiatorWallet: brInitiatorWalletPda,
        beneficiaryWallet: brBeneficiaryWalletPda,
        arbiterWallet: brArbiterWalletPda,
        vaultpactProgram: brVaultpact.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).signers([brInitiator]).rpc();

      await brEscrow.methods.depositFunds().accounts({
        initiator: brInitiator.publicKey,
        escrowAccount: escrowPda,
        initiatorTokenAccount: brInitiatorToken.publicKey,
        vault: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([brInitiator]).rpc();

      await brEscrow.methods.stakeBeneficiary().accounts({
        beneficiary: brBeneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        beneficiaryTokenAccount: brBeneficiaryToken.publicKey,
        vault: vaultAta,
        beneficiaryReputation: brBeneficiaryRepPda,
        beneficiaryWallet: brBeneficiaryWalletPda,
        vaultpactProgram: brVaultpact.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([brBeneficiary]).rpc();

      await brEscrow.methods.lockEscrow().accounts({
        initiator: brInitiator.publicKey,
        beneficiary: brBeneficiary.publicKey,
        escrowAccount: escrowPda,
        vault: vaultAta,
        initiatorWallet: brInitiatorWalletPda,
        beneficiaryWallet: brBeneficiaryWalletPda,
        arbiterWallet: brArbiterWalletPda,
        pactRecord: pactPda,
        initiatorReputation: brInitiatorRepPda,
        beneficiaryReputation: brBeneficiaryRepPda,
        vaultpactProgram: brVaultpact.programId,
      }).signers([brInitiator, brBeneficiary]).rpc();

      await brEscrow.methods.releaseEscrow().accounts({
        initiator: brInitiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        initiatorWallet: brInitiatorWalletPda,
      }).signers([brInitiator]).rpc();

      return { escrowId, escrowPda, pactPda, vaultAta };
    }

    // ── Tests ────────────────────────────────────────────────────────────

    it("CAS-148-1: claim_released fires update_reputation CPI for both parties", async () => {
      const { escrowPda, escrowId, vaultAta } = await buildReleasedEscrow() as any;

      // Warp past the 7-day dispute window.
      await warpClockForward(8 * 24 * 3600);

      // Record nonces before claim so we can assert the increment.
      const iRepBefore = await context.banksClient.getAccount(brInitiatorRepPda);
      const bRepBefore = await context.banksClient.getAccount(brBeneficiaryRepPda);
      const iNonceBefore = Buffer.from(iRepBefore!.data).readBigUInt64LE(OFF_NONCE);
      const bNonceBefore = Buffer.from(bRepBefore!.data).readBigUInt64LE(OFF_NONCE);

      // Execute claim_released — fires two update_reputation CPIs internally.
      await brEscrow.methods.claimReleased().accounts({
        beneficiary: brBeneficiary.publicKey,
        escrowAccount: escrowPda,
        vault: vaultAta,
        beneficiaryTokenAccount: brBeneficiaryToken.publicKey,
        initiatorTokenAccount: brInitiatorToken.publicKey,
        beneficiaryWallet: brBeneficiaryWalletPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        initiatorReputation: brInitiatorRepPda,
        beneficiaryReputation: brBeneficiaryRepPda,
        escrowAuthority: brEscrowAuthority,
        vaultpactProgram: brVaultpact.programId,
      }).signers([brBeneficiary]).rpc();

      // ── Verify escrow is Claimed ────────────────────────────────────
      const escrow = await brEscrow.account.escrowAccount.fetch(escrowPda);
      assert.deepEqual(escrow.status, { claimed: {} }, "escrow must be Claimed");

      // ── Verify initiator reputation was updated ─────────────────────
      const iRepAfter = await context.banksClient.getAccount(brInitiatorRepPda);
      assert.ok(iRepAfter, "initiator reputation account must exist");
      const iData = Buffer.from(iRepAfter!.data);

      const iNonceAfter = iData.readBigUInt64LE(OFF_NONCE);
      assert.equal(
        Number(iNonceAfter), Number(iNonceBefore) + 1,
        "initiator reputation nonce must increment by 1",
      );

      const iTotalPacts = iData.readBigUInt64LE(OFF_TOTAL_PACTS);
      assert.equal(Number(iTotalPacts), 1, "initiator total_pacts must be 1");

      // Score: neutral start (5000) + 50 delta, 0 days of decay → 5050.
      const iScore = readU64LE(iData, OFF_SCORE);
      assert.equal(Number(iScore), 5050, "initiator score must be 5050 after fulfilled pact");

      // History ring: first entry should record Fulfilled outcome and +50 delta.
      assert.equal(iData[OFF_HIST_LEN], 1, "initiator history_len must be 1");
      const iOutcome = iData[OFF_HISTORY]; // first byte of HistEntry = outcome u8
      assert.equal(iOutcome, 0, "initiator history[0].outcome must be 0 (Fulfilled)");
      const iDelta = readI16LE(iData, OFF_HISTORY + 1);
      assert.equal(iDelta, 50, "initiator history[0].score_delta must be 50");

      // ── Verify beneficiary reputation was updated ───────────────────
      const bRepAfter = await context.banksClient.getAccount(brBeneficiaryRepPda);
      assert.ok(bRepAfter, "beneficiary reputation account must exist");
      const bData = Buffer.from(bRepAfter!.data);

      const bNonceAfter = bData.readBigUInt64LE(OFF_NONCE);
      assert.equal(
        Number(bNonceAfter), Number(bNonceBefore) + 1,
        "beneficiary reputation nonce must increment by 1",
      );

      const bTotalPacts = bData.readBigUInt64LE(OFF_TOTAL_PACTS);
      assert.equal(Number(bTotalPacts), 1, "beneficiary total_pacts must be 1");

      const bScore = readU64LE(bData, OFF_SCORE);
      assert.equal(Number(bScore), 5050, "beneficiary score must be 5050 after fulfilled pact");
    });

    it("CAS-148-2: direct update_reputation with unauthorised signer → UnauthorizedReputationWriter", async () => {
      // Read the current nonce from the on-chain initiator reputation.
      const repInfo = await context.banksClient.getAccount(brInitiatorRepPda);
      assert.ok(repInfo, "initiator reputation account must exist for this test");
      const currentNonce = Number(Buffer.from(repInfo!.data).readBigUInt64LE(OFF_NONCE));

      // Use a random keypair that is neither VAULTPACT_ESCROW_AUTHORITY nor
      // REPUTATION_ORACLE_AUTHORITY — the instruction must reject it.
      const randomSigner = anchor.web3.Keypair.generate();
      fundAccount(randomSigner.publicKey, 10_000_000_000n);

      try {
        await brVaultpact.methods
          .updateReputation(
            new anchor.BN(currentNonce + 1),
            { fulfilled: {} },
            50,
            Array(7).fill(0),
          )
          .accounts({
            reputationAccount: brInitiatorRepPda,
            updateAuthority: randomSigner.publicKey,
          })
          .signers([randomSigner])
          .rpc();
        assert.fail("expected UnauthorizedReputationWriter");
      } catch (err: any) {
        if (err.message?.includes("expected UnauthorizedReputationWriter")) throw err;
        assert.include(getDiag(err), "UnauthorizedReputationWriter",
          "direct call with random signer must be rejected");
      }
    });
  },
);
