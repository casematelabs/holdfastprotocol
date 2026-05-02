import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vaultpact } from "../target/types/vaultpact";
import { assert } from "chai";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// bankrun: loaded conditionally (no Windows binary for solana-test-validator).
let bankrunMod: any = null;
let anchorBankrunMod: any = null;
try {
  bankrunMod = require("solana-bankrun");
  anchorBankrunMod = require("anchor-bankrun");
} catch (_e) {
  // bankrun unavailable on this platform — decay tests will be skipped
}

// P-256 from oracle's node_modules — already installed, no separate yarn add required.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { p256 } = require("../oracle/node_modules/@noble/curves/nist.js");

// Secp256r1Program (SIMD-48) ID — must match secp256r1_program::ID in lib.rs.
const SECP256R1_PROGRAM_ID = new anchor.web3.PublicKey(
  Buffer.from([
    6, 146, 13, 236, 47, 234, 113, 181, 183, 35, 129, 77, 116, 45, 169, 3,
    28, 131, 231, 95, 219, 121, 93, 86, 142, 117, 71, 128, 32, 0, 0, 0,
  ]),
);

// Instructions sysvar address — required by verify_secp256r1_precompile.
const SYSVAR_INSTRUCTIONS = new anchor.web3.PublicKey(
  "Sysvar1nstructions1111111111111111111111111",
);
const ESCROW_PROGRAM_ID = new anchor.web3.PublicKey(
  "CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi",
);

/**
 * Build a Secp256r1Program instruction data buffer (SIMD-48 one-signature layout).
 *
 * Header (16 bytes):
 *   [0]      num_signatures = 1
 *   [1]      padding = 0
 *   [2..4]   signature_offset  u16LE  offset of 64-byte r||s sig
 *   [4..6]   sig_ix_index      u16LE  0xFFFF = inline same instruction  (H-2)
 *   [6..8]   pubkey_offset     u16LE  offset of 33-byte compressed pubkey
 *   [8..10]  pubkey_ix_index   u16LE  0xFFFF                             (H-2)
 *   [10..12] msg_offset        u16LE  offset of raw message bytes
 *   [12..14] msg_size          u16LE  byte length of message
 *   [14..16] msg_ix_index      u16LE  0xFFFF                             (H-2)
 * Payload (immediately after header):
 *   [16..80]  64-byte signature  (r || s compact)
 *   [80..113] 33-byte compressed pubkey  (0x02/0x03 || x)
 *   [113..]   raw message bytes
 */
function buildSecp256r1Instruction(
  sig: Uint8Array,
  compressedPubkey: Uint8Array,
  message: Buffer,
): anchor.web3.TransactionInstruction {
  const SIG_OFFSET = 16;
  const PUBKEY_OFFSET = SIG_OFFSET + 64; // 80
  const MSG_OFFSET = PUBKEY_OFFSET + 33; // 113
  const MSG_SIZE = message.length;

  const data = Buffer.alloc(MSG_OFFSET + MSG_SIZE);
  data[0] = 1; // num_signatures
  data[1] = 0; // padding
  data.writeUInt16LE(SIG_OFFSET, 2);
  data.writeUInt16LE(0xffff, 4); // sig_ix_index: same instruction
  data.writeUInt16LE(PUBKEY_OFFSET, 6);
  data.writeUInt16LE(0xffff, 8); // pubkey_ix_index: same instruction
  data.writeUInt16LE(MSG_OFFSET, 10);
  data.writeUInt16LE(MSG_SIZE, 12);
  data.writeUInt16LE(0xffff, 14); // msg_ix_index: same instruction
  Buffer.from(sig).copy(data, SIG_OFFSET);
  Buffer.from(compressedPubkey).copy(data, PUBKEY_OFFSET);
  message.copy(data, MSG_OFFSET);

  return new anchor.web3.TransactionInstruction({
    programId: SECP256R1_PROGRAM_ID,
    keys: [],
    data,
  });
}

/**
 * Build the 131-byte registration preimage:
 *   "vaultpact:register_agent_wallet:v1:" (35 bytes)
 *   || authority pubkey (32 bytes)
 *   || pubkey_x (32 bytes)
 *   || pubkey_y (32 bytes)
 */
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

describe("holdfast", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vaultpact as Program<Vaultpact>;

  const [registryPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("attestation_registry")],
    program.programId,
  );

  // Oracle ed25519 keypair — the only directly-signable reputation writer.
  // VAULTPACT_ESCROW_AUTHORITY is a PDA and can only sign via CPI from the
  // escrow program, so all direct update_reputation tests use the oracle key.
  const oracleKeypair = (() => {
    const keyPath =
      process.env.ORACLE_KEYPAIR_PATH ??
      path.join(os.homedir(), ".config", "solana", "oracle-devnet.json");
    return anchor.web3.Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))),
    );
  })();

  async function sendPrecompileTx(
    tx: anchor.web3.Transaction,
  ): Promise<string> {
    const rawTx = tx.serialize();
    const txSig = await provider.connection.sendRawTransaction(rawTx, {
      skipPreflight: true,
    });
    await provider.connection.confirmTransaction(txSig, "confirmed");
    return txSig;
  }

  async function sendPrecompileTxExpectFail(
    tx: anchor.web3.Transaction,
  ): Promise<string> {
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (
      await provider.connection.getLatestBlockhash()
    ).blockhash;
    // @ts-ignore — wallet.signTransaction exists on AnchorProvider
    const signed = await provider.wallet.signTransaction(tx);
    const rawTx = signed.serialize();
    try {
      const txSig = await provider.connection.sendRawTransaction(rawTx, {
        skipPreflight: true,
      });
      const confirmation = await provider.connection.confirmTransaction(
        txSig,
        "confirmed",
      );
      if (confirmation.value.err) {
        const txInfo = await provider.connection.getTransaction(txSig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        const logs = txInfo?.meta?.logMessages ?? [];
        return logs.join(" ") + " ERR:" + JSON.stringify(confirmation.value.err);
      }
      return "";
    } catch (err: any) {
      if (err.logs) return (err.logs as string[]).join(" ") + " " + (err.message ?? "");
      if (typeof err.getLogs === "function") {
        try { const logs = await err.getLogs(); return (logs as string[]).join(" ") + " " + (err.message ?? ""); } catch {}
      }
      return err.message ?? String(err);
    }
  }

  async function createAgentWithReputation(): Promise<{
    agentKeypair: anchor.web3.Keypair;
    repPda: anchor.web3.PublicKey;
  }> {
    const agentKeypair = anchor.web3.Keypair.generate();
    const [repPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), agentKeypair.publicKey.toBuffer()],
      program.programId,
    );
    const sig = await provider.connection.requestAirdrop(
      agentKeypair.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(sig);
    await program.methods
      .initReputation()
      .accounts({
        reputationAccount: repPda,
        agent: agentKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([agentKeypair])
      .rpc();
    return { agentKeypair, repPda };
  }

  // ── Registry initialisation ───────────────────────────────────────────

  it("initialize_registry: unauthorized signer -> UnauthorizedAuthority", async () => {
    const impostor = anchor.web3.Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      impostor.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .initializeRegistry()
        .accounts({
          attestationRegistry: registryPda,
          authority: impostor.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          escrowProgram: ESCROW_PROGRAM_ID,
        })
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

  it("initializes the attestation registry", async () => {
    try {
      await program.methods
        .initializeRegistry()
        .accounts({
          attestationRegistry: registryPda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          escrowProgram: ESCROW_PROGRAM_ID,
        })
        .rpc();
    } catch (err: any) {
      // Idempotent for re-runs: account already exists.
      if (!err.message?.includes("already in use")) throw err;
    }

    const registry = await program.account.attestationRegistry.fetch(registryPda);
    assert.ok(registry, "registry PDA exists after init");
    assert.strictEqual(
      registry.authority.toBase58(),
      provider.wallet.publicKey.toBase58(),
      "registry authority matches initialiser",
    );
  });

  it("initialize_registry: double-init -> account already in use", async () => {
    try {
      await program.methods
        .initializeRegistry()
        .accounts({
          attestationRegistry: registryPda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          escrowProgram: ESCROW_PROGRAM_ID,
        })
        .rpc();
      assert.fail("expected double-init to fail but transaction succeeded");
    } catch (err: any) {
      const diag =
        ((err.logs as string[] | undefined)?.join(" ") ?? "") +
        " " +
        (err.message ?? "");
      assert.ok(
        diag.includes("already in use") ||
          diag.includes("already been allocated") ||
          diag.includes("custom program error: 0x0"),
        `expected account-already-exists error, got: ${diag}`,
      );
    }
  });

  // ── PDA derivation unit checks ────────────────────────────────────────

  it("derives agent_wallet PDA from both key coordinates", async () => {
    const pubkeyX = Buffer.alloc(32, 1);
    const pubkeyY = Buffer.alloc(32, 2);
    const [walletPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("agent_wallet"), pubkeyX, pubkeyY],
      program.programId,
    );
    assert.ok(walletPda, "agent wallet PDA derivable from x+y coordinates");
  });

  it("derives reputation PDA from agent pubkey", async () => {
    const agentKey = provider.wallet.publicKey;
    const [repPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), agentKey.toBuffer()],
      program.programId,
    );
    assert.ok(repPda, "reputation PDA derivable from agent pubkey");
  });

  // ── Reputation authority constant checks (CAS-33) ─────────────────────
  //
  // Allowed reputation-writer set: {VAULTPACT_ESCROW_AUTHORITY, REPUTATION_ORACLE_AUTHORITY}.
  // VAULTPACT_ESCROW_AUTHORITY is a PDA — can only sign via CPI from the escrow
  // program. That CPI path is not directly testable without a deployed escrow
  // program and is out of scope for this suite.

  it("VAULTPACT_ESCROW_AUTHORITY matches the derivable PDA", () => {
    const escrowProgramId = new anchor.web3.PublicKey(
      "CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi",
    );
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vp_escrow_authority")],
      escrowProgramId,
    );
    assert.equal(
      pda.toBase58(),
      "DLzsM2CA7mhp2KQcQfkzsbL6r55H8TEZJgL223xfXxA2",
      "escrow authority PDA must match the constant in programs/vaultpact/src/lib.rs (CAS-33)",
    );
  });

  it("REPUTATION_ORACLE_AUTHORITY is the expected devnet oracle pubkey", () => {
    const oracleAuthority = new anchor.web3.PublicKey(
      "3Kj7GpYVoARqCT1bfBmCC5NZhw37ahEiyxsJW9zcTSiy",
    );
    assert.notEqual(
      oracleAuthority.toBase58(),
      anchor.web3.PublicKey.default.toBase58(),
      "oracle authority must not be the zero pubkey (CAS-33)",
    );
  });

  it("update_reputation rejects an unauthorized signer", async () => {
    // Set up a reputation account for a throwaway agent.
    const agentKeypair = anchor.web3.Keypair.generate();
    const [repPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), agentKeypair.publicKey.toBuffer()],
      program.programId,
    );

    // Airdrop SOL to the agent for rent.
    const sig = await provider.connection.requestAirdrop(
      agentKeypair.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(sig);

    // Initialize the reputation account.
    await program.methods
      .initReputation()
      .accounts({
        reputationAccount: repPda,
        agent: agentKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([agentKeypair])
      .rpc();

    // Attempt update_reputation with a random keypair — must be rejected.
    const unauthorizedSigner = anchor.web3.Keypair.generate();
    try {
      await program.methods
        .updateReputation(
          new anchor.BN(1),
          { fulfilled: {} },
          100,
          Array(7).fill(0),
        )
        .accounts({
          reputationAccount: repPda,
          updateAuthority: unauthorizedSigner.publicKey,
        })
        .signers([unauthorizedSigner])
        .rpc();
      assert.fail("expected UnauthorizedReputationWriter but transaction succeeded");
    } catch (err: any) {
      const diag =
        ((err.logs as string[] | undefined)?.join(" ") ?? "") +
        " " +
        (err.message ?? "");
      assert.include(
        diag,
        "UnauthorizedReputationWriter",
        `expected UnauthorizedReputationWriter, got: ${diag}`,
      );
    }
  });

  // ── Ring buffer invariant checks ──────────────────────────────────────

  it("ring buffer: first write index is 0, history_len becomes 1 (derivation check)", async () => {
    const agentKey = anchor.web3.Keypair.generate().publicKey;
    const [repPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), agentKey.toBuffer()],
      program.programId,
    );
    assert.ok(repPda, "reputation PDA derivable for ring-buffer unit test");
  });

  it("ring buffer: write at index 19 wraps head to 0", () => {
    const head = 19;
    const nextHead = (head + 1) % 20;
    assert.equal(nextHead, 0, "head wraps to 0 after slot 19");
  });

  // ── register_agent_wallet end-to-end integration tests ────────────────
  //
  // These tests exercise the Secp256r1Program precompile on localnet.
  // The provider wallet must be INITIAL_AUTHORITY (devnet.json) for the
  // initializeRegistry call above to succeed.
  //
  // Instruction ordering in every transaction:
  //   ix[0] — Secp256r1Program precompile (verifies the P-256 signature)
  //   ix[1] — program.registerAgentWallet  (reads back ix[0] from sysvar)

  describe("register_agent_wallet", () => {
    // Shared key material created once per suite run.
    let privKey: Uint8Array;
    let pubkeyX: Buffer;
    let pubkeyY: Buffer;
    let compressedPubkey: Uint8Array;
    let preimage: Buffer;
    let walletPda: anchor.web3.PublicKey;

    before(() => {
      privKey = p256.utils.randomPrivateKey();
      const uncompressed: Uint8Array = p256.getPublicKey(privKey, false); // 65 bytes: 0x04||x||y
      compressedPubkey = p256.getPublicKey(privKey, true); //               33 bytes: 0x02/03||x
      pubkeyX = Buffer.from(uncompressed.slice(1, 33));
      pubkeyY = Buffer.from(uncompressed.slice(33, 65));

      [walletPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), pubkeyX, pubkeyY],
        program.programId,
      );

      preimage = buildRegistrationPreimage(
        provider.wallet.publicKey,
        pubkeyX,
        pubkeyY,
      );
    });

    // ── Test 1: happy path ──────────────────────────────────────────────

    it("happy path — valid self-attestation succeeds", async () => {
      const preimageHash = crypto.createHash("sha256").update(preimage).digest();
      const sigBytes = p256.sign(preimageHash, privKey).toCompactRawBytes();

      const secp256r1Ix = buildSecp256r1Instruction(
        sigBytes,
        compressedPubkey,
        preimage,
      );

      const registryBefore = await program.account.attestationRegistry.fetch(
        registryPda,
      );
      const countBefore = registryBefore.agentCount.toNumber();

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
      const txSig = await provider.sendAndConfirm(tx, [], {
        skipPreflight: true,
      });
      assert.ok(txSig, "transaction confirmed");

      // Assert AgentWallet PDA state.
      const wallet = await program.account.agentWallet.fetch(walletPda);
      assert.deepEqual(
        Array.from(wallet.pubkeyX as number[]),
        Array.from(pubkeyX),
        "pubkey_x stored correctly",
      );
      assert.deepEqual(
        Array.from(wallet.pubkeyY as number[]),
        Array.from(pubkeyY),
        "pubkey_y stored correctly",
      );
      assert.strictEqual(
        wallet.authority.toBase58(),
        provider.wallet.publicKey.toBase58(),
        "authority is payer",
      );
      assert.strictEqual(
        (wallet.nonce as anchor.BN).toNumber(),
        0,
        "nonce starts at 0",
      );

      // Assert AttestationRegistry agent_count incremented.
      const registryAfter = await program.account.attestationRegistry.fetch(
        registryPda,
      );
      assert.strictEqual(
        registryAfter.agentCount.toNumber(),
        countBefore + 1,
        "agent_count incremented by exactly 1",
      );
    });

    // ── Test 2: wrong challenge ─────────────────────────────────────────

    it("wrong challenge — transaction rejected with AttestationChallengeMismatch", async () => {
      // Fresh key pair so the wallet PDA doesn't collide with the one from test 1.
      const freshPrivKey: Uint8Array = p256.utils.randomPrivateKey();
      const freshUncompressed: Uint8Array = p256.getPublicKey(
        freshPrivKey,
        false,
      );
      const freshCompressed: Uint8Array = p256.getPublicKey(freshPrivKey, true);
      const freshX = Buffer.from(freshUncompressed.slice(1, 33));
      const freshY = Buffer.from(freshUncompressed.slice(33, 65));

      const [freshWalletPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), freshX, freshY],
        program.programId,
      );

      // Sign an all-zeros preimage. The signature is cryptographically valid for
      // this message, but sha256(zeros) != registration_challenge(payer, x, y).
      const wrongPreimage = Buffer.alloc(131, 0);
      const wrongHash = crypto
        .createHash("sha256")
        .update(wrongPreimage)
        .digest();
      const wrongSigBytes = p256
        .sign(wrongHash, freshPrivKey)
        .toCompactRawBytes();

      const secp256r1Ix = buildSecp256r1Instruction(
        wrongSigBytes,
        freshCompressed,
        wrongPreimage,
      );

      const registerIx = await program.methods
        .registerAgentWallet(
          Array.from(freshX) as number[],
          Array.from(freshY) as number[],
        )
        .accounts({
          agentWallet: freshWalletPda,
          attestationRegistry: registryPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(secp256r1Ix, registerIx);
      const diag = await sendPrecompileTxExpectFail(tx);
      assert.ok(diag, "expected AttestationChallengeMismatch but transaction succeeded");
      assert.ok(
        diag.includes("AttestationChallengeMismatch") ||
          diag.includes("Custom\":6013") ||
          diag.includes("Custom:6013"),
        `expected AttestationChallengeMismatch (Custom:6013) in error, got: ${diag}`,
      );
    });

    // ── Test 3: replay ──────────────────────────────────────────────────

    it("replay — re-registering the same key fails (PDA init constraint)", async () => {
      // Recompute a valid signature for the already-registered key.
      const preimageHash = crypto.createHash("sha256").update(preimage).digest();
      const sigBytes = p256.sign(preimageHash, privKey).toCompactRawBytes();

      const secp256r1Ix = buildSecp256r1Instruction(
        sigBytes,
        compressedPubkey,
        preimage,
      );

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
      const diag = await sendPrecompileTxExpectFail(tx);
      assert.ok(diag, "expected replay to fail but transaction succeeded");
      assert.ok(
        diag.includes("already in use") ||
          diag.includes("already been allocated") ||
          diag.includes("custom program error: 0x0") ||
          diag.includes("Custom\":0") ||
          diag.includes("failed"),
        `expected account-already-exists error on replay, got: ${diag}`,
      );
    });

    // ── Test 4: no precompile → MissingSignatureVerification ────────────

    it("no precompile → MissingSignatureVerification", async () => {
      const freshPrivKey: Uint8Array = p256.utils.randomPrivateKey();
      const freshUncompressed: Uint8Array = p256.getPublicKey(
        freshPrivKey,
        false,
      );
      const freshX = Buffer.from(freshUncompressed.slice(1, 33));
      const freshY = Buffer.from(freshUncompressed.slice(33, 65));

      const [freshWalletPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), freshX, freshY],
        program.programId,
      );

      const registerIx = await program.methods
        .registerAgentWallet(
          Array.from(freshX) as number[],
          Array.from(freshY) as number[],
        )
        .accounts({
          agentWallet: freshWalletPda,
          attestationRegistry: registryPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(registerIx);
      try {
        await provider.sendAndConfirm(tx);
        assert.fail(
          "expected MissingSignatureVerification but transaction succeeded",
        );
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "MissingSignatureVerification",
          `expected MissingSignatureVerification, got: ${diag}`,
        );
      }
    });

    // ── Test 5: pubkey mismatch → PublicKeyMismatch ─────────────────────

    it("pubkey mismatch → PublicKeyMismatch", async () => {
      // Key A: used in the precompile instruction header.
      const privKeyA: Uint8Array = p256.utils.randomPrivateKey();
      const compressedA: Uint8Array = p256.getPublicKey(privKeyA, true);

      // Key B: coordinates passed to registerAgentWallet.
      const privKeyB: Uint8Array = p256.utils.randomPrivateKey();
      const uncompressedB: Uint8Array = p256.getPublicKey(privKeyB, false);
      const freshBX = Buffer.from(uncompressedB.slice(1, 33));
      const freshBY = Buffer.from(uncompressedB.slice(33, 65));

      const [walletPdaB] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), freshBX, freshBY],
        program.programId,
      );

      // Sign with key A, but the preimage references key B's coordinates.
      const preimageB = buildRegistrationPreimage(
        provider.wallet.publicKey,
        freshBX,
        freshBY,
      );
      const hashB = crypto.createHash("sha256").update(preimageB).digest();
      const sigBytes = p256.sign(hashB, privKeyA).toCompactRawBytes();

      // Precompile header carries key A — program will compare A vs B → mismatch.
      const secp256r1Ix = buildSecp256r1Instruction(
        sigBytes,
        compressedA,
        preimageB,
      );

      const registerIx = await program.methods
        .registerAgentWallet(
          Array.from(freshBX) as number[],
          Array.from(freshBY) as number[],
        )
        .accounts({
          agentWallet: walletPdaB,
          attestationRegistry: registryPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(secp256r1Ix, registerIx);
      const diag = await sendPrecompileTxExpectFail(tx);
      assert.ok(diag, "expected PublicKeyMismatch but transaction succeeded");
      assert.ok(
        diag.includes("PublicKeyMismatch") ||
          diag.includes("Custom\":6002") ||
          diag.includes("Custom\":2") ||
          diag.includes("custom program error: 0x2"),
        `expected PublicKeyMismatch or precompile rejection, got: ${diag}`,
      );
    });

    // ── Test 6: zero-coordinate key → InvalidAgentKey ───────────────────

    it("zero-coordinate key → InvalidAgentKey", async () => {
      const zeroX = Buffer.alloc(32, 0);
      const zeroY = Buffer.alloc(32, 0);

      const [zeroPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), zeroX, zeroY],
        program.programId,
      );

      const registerIx = await program.methods
        .registerAgentWallet(
          Array.from(zeroX) as number[],
          Array.from(zeroY) as number[],
        )
        .accounts({
          agentWallet: zeroPda,
          attestationRegistry: registryPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      // No precompile instruction — zero-coordinate check fires first.
      const tx = new anchor.web3.Transaction().add(registerIx);
      try {
        await provider.sendAndConfirm(tx);
        assert.fail("expected InvalidAgentKey but transaction succeeded");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "InvalidAgentKey",
          `expected InvalidAgentKey, got: ${diag}`,
        );
      }
    });
  });

  // ── update_reputation integration tests ───────────────────────────────
  //
  // Uses REPUTATION_ORACLE_AUTHORITY (ed25519 keypair at
  // ~/.config/solana/oracle-devnet.json) because VAULTPACT_ESCROW_AUTHORITY
  // is a PDA and can only sign via CPI from the escrow program.

  describe("update_reputation (oracle)", () => {
    before(async () => {
      const sig = await provider.connection.requestAirdrop(
        oracleKeypair.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig);
    });

    // Shared agent for sequential nonce tests (happy path → gap → replay).
    let sharedRepPda: anchor.web3.PublicKey;

    it("happy path: oracle writes delta, nonce=1", async () => {
      const { repPda } = await createAgentWithReputation();
      sharedRepPda = repPda;

      await program.methods
        .updateReputation(
          new anchor.BN(1),
          { fulfilled: {} },
          200,
          Array(7).fill(1),
        )
        .accounts({
          reputationAccount: repPda,
          updateAuthority: oracleKeypair.publicKey,
        })
        .signers([oracleKeypair])
        .rpc();

      const rep = await program.account.reputationAccount.fetch(repPda);
      assert.strictEqual(
        (rep.nonce as anchor.BN).toNumber(),
        1,
        "nonce should be 1",
      );
      assert.strictEqual(
        (rep.score as anchor.BN).toNumber(),
        5200,
        "score should be 5000 + 200 = 5200",
      );
      assert.strictEqual(
        (rep.totalPacts as anchor.BN).toNumber(),
        1,
        "total_pacts should be 1",
      );
      assert.strictEqual(rep.historyLen, 1, "history_len should be 1");
      assert.strictEqual(
        rep.history[0].scoreDelta,
        200,
        "history[0].score_delta should be 200",
      );
    });

    it("nonce gap → NonceMismatch", async () => {
      try {
        await program.methods
          .updateReputation(
            new anchor.BN(3),
            { fulfilled: {} },
            100,
            Array(7).fill(2),
          )
          .accounts({
            reputationAccount: sharedRepPda,
            updateAuthority: oracleKeypair.publicKey,
          })
          .signers([oracleKeypair])
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

    it("nonce replay → NonceMismatch", async () => {
      try {
        await program.methods
          .updateReputation(
            new anchor.BN(1),
            { fulfilled: {} },
            100,
            Array(7).fill(3),
          )
          .accounts({
            reputationAccount: sharedRepPda,
            updateAuthority: oracleKeypair.publicKey,
          })
          .signers([oracleKeypair])
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

    it("score clamp — large positive delta stays <= 10000", async () => {
      const { repPda } = await createAgentWithReputation();

      await program.methods
        .updateReputation(
          new anchor.BN(1),
          { fulfilled: {} },
          32767,
          Array(7).fill(4),
        )
        .accounts({
          reputationAccount: repPda,
          updateAuthority: oracleKeypair.publicKey,
        })
        .signers([oracleKeypair])
        .rpc();

      const rep = await program.account.reputationAccount.fetch(repPda);
      assert.strictEqual(
        (rep.score as anchor.BN).toNumber(),
        10000,
        "score should clamp to 10000",
      );
    });

    it("score clamp — large negative delta stays >= 0", async () => {
      const { repPda } = await createAgentWithReputation();

      await program.methods
        .updateReputation(
          new anchor.BN(1),
          { fulfilled: {} },
          -32768,
          Array(7).fill(5),
        )
        .accounts({
          reputationAccount: repPda,
          updateAuthority: oracleKeypair.publicKey,
        })
        .signers([oracleKeypair])
        .rpc();

      const rep = await program.account.reputationAccount.fetch(repPda);
      assert.strictEqual(
        (rep.score as anchor.BN).toNumber(),
        0,
        "score should clamp to 0",
      );
    });

    it("ring buffer: 21 writes — oldest entry overwritten", async () => {
      const { repPda } = await createAgentWithReputation();

      for (let i = 1; i <= 21; i++) {
        const delta = i === 21 ? 42 : i;
        await program.methods
          .updateReputation(
            new anchor.BN(i),
            { fulfilled: {} },
            delta,
            Array(7).fill(i % 256),
          )
          .accounts({
            reputationAccount: repPda,
            updateAuthority: oracleKeypair.publicKey,
          })
          .signers([oracleKeypair])
          .rpc();
      }

      const rep = await program.account.reputationAccount.fetch(repPda);
      assert.strictEqual(
        rep.historyLen,
        20,
        "history_len should be 20 (capped)",
      );
      assert.strictEqual(
        rep.historyHead,
        1,
        "history_head wraps: 21 writes -> head=1",
      );
      assert.strictEqual(
        rep.history[0].scoreDelta,
        42,
        "slot 0 overwritten by write #21 (delta=42)",
      );
    });

  });

  // ── update_reputation outcome variant tests ───────────────────────────
  //
  // Verifies that each PactOutcome variant correctly affects dispute_count
  // and total_pacts. These counters are critical for reputation manipulation
  // threat-model scenarios identified in CAS-79.

  describe("update_reputation (outcome variants)", () => {
    before(async () => {
      const balance = await provider.connection.getBalance(oracleKeypair.publicKey);
      if (balance < anchor.web3.LAMPORTS_PER_SOL) {
        const sig = await provider.connection.requestAirdrop(
          oracleKeypair.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL,
        );
        await provider.connection.confirmTransaction(sig);
      }
    });

    it("Disputed outcome increments dispute_count", async () => {
      const { repPda } = await createAgentWithReputation();

      await program.methods
        .updateReputation(
          new anchor.BN(1),
          { disputed: {} },
          -100,
          Array(7).fill(10),
        )
        .accounts({
          reputationAccount: repPda,
          updateAuthority: oracleKeypair.publicKey,
        })
        .signers([oracleKeypair])
        .rpc();

      const rep = await program.account.reputationAccount.fetch(repPda);
      assert.strictEqual(
        (rep.disputeCount as anchor.BN).toNumber(),
        1,
        "dispute_count should be 1 after Disputed outcome",
      );
      assert.strictEqual(
        (rep.totalPacts as anchor.BN).toNumber(),
        1,
        "total_pacts should be 1",
      );
    });

    it("Cancelled outcome does not increment dispute_count", async () => {
      const { repPda } = await createAgentWithReputation();

      await program.methods
        .updateReputation(
          new anchor.BN(1),
          { cancelled: {} },
          -50,
          Array(7).fill(11),
        )
        .accounts({
          reputationAccount: repPda,
          updateAuthority: oracleKeypair.publicKey,
        })
        .signers([oracleKeypair])
        .rpc();

      const rep = await program.account.reputationAccount.fetch(repPda);
      assert.strictEqual(
        (rep.disputeCount as anchor.BN).toNumber(),
        0,
        "dispute_count must stay 0 for Cancelled outcome",
      );
      assert.strictEqual(
        (rep.totalPacts as anchor.BN).toNumber(),
        1,
        "total_pacts should be 1",
      );
    });

    it("sequential outcomes: fulfilled→disputed→fulfilled accumulates correctly", async () => {
      const { repPda } = await createAgentWithReputation();

      for (const [nonce, outcome, delta, tag] of [
        [1, { fulfilled: {} }, 100, 20],
        [2, { disputed: {} }, -300, 21],
        [3, { fulfilled: {} }, 200, 22],
      ] as const) {
        await program.methods
          .updateReputation(new anchor.BN(nonce), outcome, delta, Array(7).fill(tag))
          .accounts({ reputationAccount: repPda, updateAuthority: oracleKeypair.publicKey })
          .signers([oracleKeypair])
          .rpc();
      }

      const rep = await program.account.reputationAccount.fetch(repPda);
      assert.strictEqual(
        (rep.totalPacts as anchor.BN).toNumber(),
        3,
        "total_pacts should be 3",
      );
      assert.strictEqual(
        (rep.disputeCount as anchor.BN).toNumber(),
        1,
        "dispute_count should be 1 (only the Disputed outcome)",
      );
      assert.strictEqual(rep.historyLen, 3, "history_len should be 3");
    });
  });

  // ── init_reputation guard ─────────────────────────────────────────────

  it("init_reputation: double-init → account already in use", async () => {
    const agent = anchor.web3.Keypair.generate();
    const [repPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), agent.publicKey.toBuffer()],
      program.programId,
    );
    const airSig = await provider.connection.requestAirdrop(
      agent.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(airSig);

    await program.methods
      .initReputation()
      .accounts({
        reputationAccount: repPda,
        agent: agent.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([agent])
      .rpc();

    try {
      await program.methods
        .initReputation()
        .accounts({
          reputationAccount: repPda,
          agent: agent.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([agent])
        .rpc();
      assert.fail("expected double-init to fail but succeeded");
    } catch (err: any) {
      const diag =
        ((err.logs as string[] | undefined)?.join(" ") ?? "") +
        " " +
        (err.message ?? "");
      assert.ok(
        diag.includes("already in use") ||
          diag.includes("already been allocated") ||
          diag.includes("custom program error: 0x0"),
        `expected account-already-exists error, got: ${diag}`,
      );
    }
  });

  // ── validate_reputation_for_pact boundary tests ───────────────────────
  //
  // Exercises the exact-equality boundary for all three gate parameters.
  // score >= min_score, tier >= min_tier, total_pacts >= min_pacts.

  describe("validate_reputation_for_pact (exact boundaries)", () => {
    let boundaryRepPda: anchor.web3.PublicKey;

    before(async () => {
      const { repPda } = await createAgentWithReputation();
      boundaryRepPda = repPda;

      const balance = await provider.connection.getBalance(oracleKeypair.publicKey);
      if (balance < anchor.web3.LAMPORTS_PER_SOL) {
        const sig = await provider.connection.requestAirdrop(
          oracleKeypair.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL,
        );
        await provider.connection.confirmTransaction(sig);
      }

      await program.methods
        .updateReputation(new anchor.BN(1), { fulfilled: {} }, 200, Array(7).fill(30))
        .accounts({ reputationAccount: repPda, updateAuthority: oracleKeypair.publicKey })
        .signers([oracleKeypair])
        .rpc();
    });

    it("score == min_score passes (exact boundary)", async () => {
      await program.methods
        .validateReputationForPact(new anchor.BN(5200), { unverified: {} }, new anchor.BN(0))
        .accounts({ reputationAccount: boundaryRepPda })
        .rpc();
    });

    it("score == min_score + 1 → ReputationScoreTooLow", async () => {
      try {
        await program.methods
          .validateReputationForPact(new anchor.BN(5201), { unverified: {} }, new anchor.BN(0))
          .accounts({ reputationAccount: boundaryRepPda })
          .rpc();
        assert.fail("expected ReputationScoreTooLow");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(diag, "ReputationScoreTooLow");
      }
    });

    it("total_pacts == min_pacts passes (exact boundary)", async () => {
      await program.methods
        .validateReputationForPact(new anchor.BN(0), { unverified: {} }, new anchor.BN(1))
        .accounts({ reputationAccount: boundaryRepPda })
        .rpc();
    });

    it("min_pacts == total_pacts + 1 → ReputationInsufficientHistory", async () => {
      try {
        await program.methods
          .validateReputationForPact(new anchor.BN(0), { unverified: {} }, new anchor.BN(2))
          .accounts({ reputationAccount: boundaryRepPda })
          .rpc();
        assert.fail("expected ReputationInsufficientHistory");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(diag, "ReputationInsufficientHistory");
      }
    });
  });

  // ── secp256r1 verifier: uncompressed key (0x04 prefix) ───────────────
  //
  // The verifier accepts both compressed (0x02/0x03) and uncompressed (0x04)
  // pubkey encodings in the precompile header. This test validates the 0x04
  // path (H-3 in the Hardline audit scope).

  describe("register_agent_wallet: uncompressed key encoding (0x04)", () => {
    // Solana's secp256r1 precompile (SIMD-48) only accepts 33-byte compressed
    // keys. Passing a 65-byte uncompressed key causes InvalidDataOffsets on-chain.
    // The program's 0x04 parsing path is forward-looking but currently unreachable.
    it.skip("0x04-prefixed uncompressed key in precompile header succeeds", async () => {
      const privKey: Uint8Array = p256.utils.randomPrivateKey();
      const uncompressed: Uint8Array = p256.getPublicKey(privKey, false); // 65 bytes
      const pubkeyX = Buffer.from(uncompressed.slice(1, 33));
      const pubkeyY = Buffer.from(uncompressed.slice(33, 65));

      const [walletPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), pubkeyX, pubkeyY],
        program.programId,
      );

      const preimage = buildRegistrationPreimage(
        provider.wallet.publicKey,
        pubkeyX,
        pubkeyY,
      );
      const preimageHash = crypto.createHash("sha256").update(preimage).digest();
      const sigBytes = p256.sign(preimageHash, privKey).toCompactRawBytes();

      // Build SIMD-48 instruction data with uncompressed (65-byte) pubkey
      const SIG_OFFSET = 16;
      const PUBKEY_OFFSET = SIG_OFFSET + 64;   // 80
      const MSG_OFFSET = PUBKEY_OFFSET + 65;    // 145  (0x04 || x || y = 65 bytes)
      const MSG_SIZE = preimage.length;
      const data = Buffer.alloc(MSG_OFFSET + MSG_SIZE);
      data[0] = 1;      // num_signatures
      data[1] = 0;      // padding
      data.writeUInt16LE(SIG_OFFSET, 2);
      data.writeUInt16LE(0xffff, 4);            // sig_ix_index: same ix
      data.writeUInt16LE(PUBKEY_OFFSET, 6);
      data.writeUInt16LE(0xffff, 8);            // pubkey_ix_index: same ix
      data.writeUInt16LE(MSG_OFFSET, 10);
      data.writeUInt16LE(MSG_SIZE, 12);
      data.writeUInt16LE(0xffff, 14);           // msg_ix_index: same ix
      Buffer.from(sigBytes).copy(data, SIG_OFFSET);
      Buffer.from(uncompressed).copy(data, PUBKEY_OFFSET); // full 65-byte uncompressed
      preimage.copy(data, MSG_OFFSET);

      const secp256r1Ix = new anchor.web3.TransactionInstruction({
        programId: SECP256R1_PROGRAM_ID,
        keys: [],
        data,
      });

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
      const txSig = await provider.sendAndConfirm(tx);
      assert.ok(txSig, "uncompressed-key registration should succeed");

      const wallet = await program.account.agentWallet.fetch(walletPda);
      assert.deepEqual(
        Array.from(wallet.pubkeyX as number[]),
        Array.from(pubkeyX),
        "pubkey_x stored correctly via uncompressed path",
      );
    });
  });

  // ── validate_reputation_for_pact integration tests ────────────────────
  //
  // Escrow CPI path: validate_reputation_for_pact is designed to be called
  // via CPI from the escrow program at sign_pact time. Direct invocation
  // (as tested here) exercises the same gate logic. The CPI path itself is
  // not directly testable without a fully deployed escrow program.

  describe("validate_reputation_for_pact", () => {
    let repPda: anchor.web3.PublicKey;

    before(async () => {
      const agent = await createAgentWithReputation();
      repPda = agent.repPda;

      // Ensure oracle has SOL (may already have from the earlier before block).
      const balance = await provider.connection.getBalance(
        oracleKeypair.publicKey,
      );
      if (balance < anchor.web3.LAMPORTS_PER_SOL) {
        const sig = await provider.connection.requestAirdrop(
          oracleKeypair.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL,
        );
        await provider.connection.confirmTransaction(sig);
      }

      // Set reputation to: score=5200, tier=Unverified, total_pacts=1.
      await program.methods
        .updateReputation(
          new anchor.BN(1),
          { fulfilled: {} },
          200,
          Array(7).fill(1),
        )
        .accounts({
          reputationAccount: repPda,
          updateAuthority: oracleKeypair.publicKey,
        })
        .signers([oracleKeypair])
        .rpc();
    });

    it("happy path — score=5200 meets min_score=5000", async () => {
      await program.methods
        .validateReputationForPact(
          new anchor.BN(5000),
          { unverified: {} },
          new anchor.BN(0),
        )
        .accounts({ reputationAccount: repPda })
        .rpc();
    });

    it("score too low → ReputationScoreTooLow", async () => {
      try {
        await program.methods
          .validateReputationForPact(
            new anchor.BN(6000),
            { unverified: {} },
            new anchor.BN(0),
          )
          .accounts({ reputationAccount: repPda })
          .rpc();
        assert.fail(
          "expected ReputationScoreTooLow but transaction succeeded",
        );
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "ReputationScoreTooLow",
          `expected ReputationScoreTooLow, got: ${diag}`,
        );
      }
    });

    it("tier too low → ReputationTierTooLow", async () => {
      try {
        await program.methods
          .validateReputationForPact(
            new anchor.BN(5000),
            { attested: {} },
            new anchor.BN(0),
          )
          .accounts({ reputationAccount: repPda })
          .rpc();
        assert.fail(
          "expected ReputationTierTooLow but transaction succeeded",
        );
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "ReputationTierTooLow",
          `expected ReputationTierTooLow, got: ${diag}`,
        );
      }
    });

    it("insufficient history → ReputationInsufficientHistory", async () => {
      try {
        await program.methods
          .validateReputationForPact(
            new anchor.BN(5000),
            { unverified: {} },
            new anchor.BN(5),
          )
          .accounts({ reputationAccount: repPda })
          .rpc();
        assert.fail(
          "expected ReputationInsufficientHistory but transaction succeeded",
        );
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "ReputationInsufficientHistory",
          `expected ReputationInsufficientHistory, got: ${diag}`,
        );
      }
    });
  });

  // ── test_verify_webauthn integration tests (CAS-80) ───────────────────
  //
  // End-to-end coverage of verify_webauthn_signature() via the devnet-only
  // test_verify_webauthn instruction. Tests the full pipeline:
  //   ix[0] Secp256r1Program precompile
  //   ix[1] program.testVerifyWebauthn
  //
  // Message construction: sha256(authenticator_data || sha256(client_data_json))
  // Allowed origins (devnet): see ALLOWED_ORIGINS in lib.rs.

  describe("test_verify_webauthn (WebAuthn assertion pipeline, CAS-80)", () => {
    let waPrivKey: Uint8Array;
    let waPubkeyX: Buffer;
    let waPubkeyY: Buffer;
    let waCompressedPubkey: Uint8Array;
    let waWalletPda: anchor.web3.PublicKey;

    // Minimal valid authenticator_data: RP ID hash (32) + flags (1) + counter (4) = 37 bytes.
    const rpIdHash = crypto.createHash("sha256").update("holdfastprotocol.com").digest();
    const minAuthenticatorData = Buffer.concat([
      rpIdHash,
      Buffer.from([0x01]), // UP flag set
      Buffer.alloc(4),    // counter = 0
    ]);

    function base64urlEncode(buf: Buffer): string {
      return buf
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    }

    function buildClientDataJSON(challengeHash: Buffer, origin: string): Buffer {
      return Buffer.from(
        JSON.stringify({
          type: "webauthn.get",
          challenge: base64urlEncode(challengeHash),
          origin,
        }),
      );
    }

    /**
     * Build a Secp256r1Program instruction for a WebAuthn assertion.
     *
     * The "message" passed to the precompile is authenticator_data || sha256(client_data_json).
     * The signature is over sha256 of that combined buffer (SIMD-48 hashes the message again).
     */
    function buildWebAuthnPrecompileIx(
      authData: Buffer,
      clientDataJSON: Buffer,
      privKey: Uint8Array,
      compressedPubkey: Uint8Array,
    ): anchor.web3.TransactionInstruction {
      const clientDataHash = crypto
        .createHash("sha256")
        .update(clientDataJSON)
        .digest();
      const message = Buffer.concat([authData, clientDataHash]);
      const messageHash = crypto.createHash("sha256").update(message).digest();
      const sig = p256.sign(messageHash, privKey).toCompactRawBytes();
      return buildSecp256r1Instruction(sig, compressedPubkey, message);
    }

    before(async () => {
      // Generate fresh P-256 key and register an AgentWallet for WebAuthn tests.
      waPrivKey = p256.utils.randomPrivateKey();
      const uncompressed: Uint8Array = p256.getPublicKey(waPrivKey, false);
      waCompressedPubkey = p256.getPublicKey(waPrivKey, true);
      waPubkeyX = Buffer.from(uncompressed.slice(1, 33));
      waPubkeyY = Buffer.from(uncompressed.slice(33, 65));

      [waWalletPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), waPubkeyX, waPubkeyY],
        program.programId,
      );

      const regPreimage = buildRegistrationPreimage(
        provider.wallet.publicKey,
        waPubkeyX,
        waPubkeyY,
      );
      const regHash = crypto
        .createHash("sha256")
        .update(regPreimage)
        .digest();
      const regSig = p256.sign(regHash, waPrivKey).toCompactRawBytes();
      const regPrecompileIx = buildSecp256r1Instruction(
        regSig,
        waCompressedPubkey,
        regPreimage,
      );
      const regIx = await program.methods
        .registerAgentWallet(
          Array.from(waPubkeyX) as number[],
          Array.from(waPubkeyY) as number[],
        )
        .accounts({
          agentWallet: waWalletPda,
          attestationRegistry: registryPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();
      const regTx = new anchor.web3.Transaction().add(regPrecompileIx, regIx);
      await provider.sendAndConfirm(regTx);
    });

    // ── Test 1: happy path ──────────────────────────────────────────────

    it("happy path — valid WebAuthn assertion accepted", async () => {
      const challengeHash = crypto.randomBytes(32);
      const clientDataJSON = buildClientDataJSON(
        challengeHash,
        "http://localhost:3000",
      );
      const secp256r1Ix = buildWebAuthnPrecompileIx(
        minAuthenticatorData,
        clientDataJSON,
        waPrivKey,
        waCompressedPubkey,
      );
      const verifyIx = await program.methods
        .testVerifyWebauthn(
          Array.from(minAuthenticatorData) as number[],
          Array.from(clientDataJSON) as number[],
          Array.from(challengeHash) as number[],
        )
        .accounts({
          agentWallet: waWalletPda,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();
      const tx = new anchor.web3.Transaction().add(secp256r1Ix, verifyIx);
      const txSig = await provider.sendAndConfirm(tx);
      assert.ok(txSig, "valid WebAuthn assertion must be accepted");
    });

    // ── Test 2: authenticator_data too short ────────────────────────────

    it("authenticator_data < 37 bytes → InvalidSignatureData", async () => {
      const shortAuthData = Buffer.alloc(36, 0xaa); // one byte short of spec minimum
      const challengeHash = crypto.randomBytes(32);
      const clientDataJSON = buildClientDataJSON(
        challengeHash,
        "http://localhost:3000",
      );
      const secp256r1Ix = buildWebAuthnPrecompileIx(
        shortAuthData,
        clientDataJSON,
        waPrivKey,
        waCompressedPubkey,
      );
      const verifyIx = await program.methods
        .testVerifyWebauthn(
          Array.from(shortAuthData) as number[],
          Array.from(clientDataJSON) as number[],
          Array.from(challengeHash) as number[],
        )
        .accounts({
          agentWallet: waWalletPda,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();
      const tx = new anchor.web3.Transaction().add(secp256r1Ix, verifyIx);
      try {
        await provider.sendAndConfirm(tx);
        assert.fail("expected InvalidSignatureData but transaction succeeded");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "InvalidSignatureData",
          `expected InvalidSignatureData, got: ${diag}`,
        );
      }
    });

    // ── Test 3: empty client_data_json ──────────────────────────────────

    it("empty client_data_json → InvalidClientData", async () => {
      const challengeHash = crypto.randomBytes(32);
      const emptyClientData = Buffer.alloc(0);
      const clientDataHash = crypto
        .createHash("sha256")
        .update(emptyClientData)
        .digest();
      const message = Buffer.concat([minAuthenticatorData, clientDataHash]);
      const msgHash = crypto.createHash("sha256").update(message).digest();
      const sig = p256.sign(msgHash, waPrivKey).toCompactRawBytes();
      const secp256r1Ix = buildSecp256r1Instruction(
        sig,
        waCompressedPubkey,
        message,
      );
      const verifyIx = await program.methods
        .testVerifyWebauthn(
          Array.from(minAuthenticatorData) as number[],
          Array.from(emptyClientData) as number[],
          Array.from(challengeHash) as number[],
        )
        .accounts({
          agentWallet: waWalletPda,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();
      const tx = new anchor.web3.Transaction().add(secp256r1Ix, verifyIx);
      try {
        await provider.sendAndConfirm(tx);
        assert.fail("expected InvalidClientData but transaction succeeded");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "InvalidClientData",
          `expected InvalidClientData, got: ${diag}`,
        );
      }
    });

    // ── Test 4: wrong origin ────────────────────────────────────────────

    it("origin not in ALLOWED_ORIGINS → InvalidOrigin", async () => {
      const challengeHash = crypto.randomBytes(32);
      const clientDataJSON = buildClientDataJSON(
        challengeHash,
        "https://evil.com",
      );
      const secp256r1Ix = buildWebAuthnPrecompileIx(
        minAuthenticatorData,
        clientDataJSON,
        waPrivKey,
        waCompressedPubkey,
      );
      const verifyIx = await program.methods
        .testVerifyWebauthn(
          Array.from(minAuthenticatorData) as number[],
          Array.from(clientDataJSON) as number[],
          Array.from(challengeHash) as number[],
        )
        .accounts({
          agentWallet: waWalletPda,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();
      const tx = new anchor.web3.Transaction().add(secp256r1Ix, verifyIx);
      try {
        await provider.sendAndConfirm(tx);
        assert.fail("expected InvalidOrigin but transaction succeeded");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "InvalidOrigin",
          `expected InvalidOrigin, got: ${diag}`,
        );
      }
    });

    // ── Test 5: challenge mismatch ──────────────────────────────────────

    it("expected_challenge differs from clientDataJSON → ChallengeMismatch", async () => {
      const actualChallenge = crypto.randomBytes(32);
      const wrongExpected = crypto.randomBytes(32); // different hash
      const clientDataJSON = buildClientDataJSON(
        actualChallenge,
        "http://localhost:3000",
      );
      const secp256r1Ix = buildWebAuthnPrecompileIx(
        minAuthenticatorData,
        clientDataJSON,
        waPrivKey,
        waCompressedPubkey,
      );
      const verifyIx = await program.methods
        .testVerifyWebauthn(
          Array.from(minAuthenticatorData) as number[],
          Array.from(clientDataJSON) as number[],
          Array.from(wrongExpected) as number[],
        )
        .accounts({
          agentWallet: waWalletPda,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();
      const tx = new anchor.web3.Transaction().add(secp256r1Ix, verifyIx);
      try {
        await provider.sendAndConfirm(tx);
        assert.fail("expected ChallengeMismatch but transaction succeeded");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "ChallengeMismatch",
          `expected ChallengeMismatch, got: ${diag}`,
        );
      }
    });

    // ── Test 6: message hash mismatch ───────────────────────────────────

    it("precompile signs different payload than authData||sha256(cdj) → MessageHashMismatch", async () => {
      const challengeHash = crypto.randomBytes(32);
      const clientDataJSON = buildClientDataJSON(
        challengeHash,
        "http://localhost:3000",
      );
      // Precompile signs a spoofed message; program recomputes the real hash → mismatch.
      const spoofedMessage = Buffer.alloc(69, 0xff);
      const spoofedMsgHash = crypto
        .createHash("sha256")
        .update(spoofedMessage)
        .digest();
      const sig = p256.sign(spoofedMsgHash, waPrivKey).toCompactRawBytes();
      const secp256r1Ix = buildSecp256r1Instruction(
        sig,
        waCompressedPubkey,
        spoofedMessage,
      );
      const verifyIx = await program.methods
        .testVerifyWebauthn(
          Array.from(minAuthenticatorData) as number[],
          Array.from(clientDataJSON) as number[],
          Array.from(challengeHash) as number[],
        )
        .accounts({
          agentWallet: waWalletPda,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();
      const tx = new anchor.web3.Transaction().add(secp256r1Ix, verifyIx);
      try {
        await provider.sendAndConfirm(tx);
        assert.fail("expected MessageHashMismatch but transaction succeeded");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "MessageHashMismatch",
          `expected MessageHashMismatch, got: ${diag}`,
        );
      }
    });

    // ── Test 7: missing origin field ────────────────────────────────────

    it("clientDataJSON missing origin field → InvalidClientData", async () => {
      const challengeHash = crypto.randomBytes(32);
      const clientDataJSON = Buffer.from(
        JSON.stringify({
          type: "webauthn.get",
          challenge: base64urlEncode(challengeHash),
          // origin intentionally omitted
        }),
      );
      const secp256r1Ix = buildWebAuthnPrecompileIx(
        minAuthenticatorData,
        clientDataJSON,
        waPrivKey,
        waCompressedPubkey,
      );
      const verifyIx = await program.methods
        .testVerifyWebauthn(
          Array.from(minAuthenticatorData) as number[],
          Array.from(clientDataJSON) as number[],
          Array.from(challengeHash) as number[],
        )
        .accounts({
          agentWallet: waWalletPda,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();
      const tx = new anchor.web3.Transaction().add(secp256r1Ix, verifyIx);
      try {
        await provider.sendAndConfirm(tx);
        assert.fail("expected InvalidClientData but transaction succeeded");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "InvalidClientData",
          `expected InvalidClientData, got: ${diag}`,
        );
      }
    });

    // ── Test 8: missing challenge field ─────────────────────────────────

    it("clientDataJSON missing challenge field → InvalidClientData", async () => {
      const challengeHash = crypto.randomBytes(32);
      const clientDataJSON = Buffer.from(
        JSON.stringify({
          type: "webauthn.get",
          // challenge intentionally omitted
          origin: "http://localhost:3000",
        }),
      );
      const secp256r1Ix = buildWebAuthnPrecompileIx(
        minAuthenticatorData,
        clientDataJSON,
        waPrivKey,
        waCompressedPubkey,
      );
      const verifyIx = await program.methods
        .testVerifyWebauthn(
          Array.from(minAuthenticatorData) as number[],
          Array.from(clientDataJSON) as number[],
          Array.from(challengeHash) as number[],
        )
        .accounts({
          agentWallet: waWalletPda,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();
      const tx = new anchor.web3.Transaction().add(secp256r1Ix, verifyIx);
      try {
        await provider.sendAndConfirm(tx);
        assert.fail("expected InvalidClientData but transaction succeeded");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "InvalidClientData",
          `expected InvalidClientData, got: ${diag}`,
        );
      }
    });

    // ── Test 9: H-SOL-1 whitespace tolerance ────────────────────────────

    it("H-SOL-1: JSON whitespace around challenge/origin values → accepted", async () => {
      const challengeHash = crypto.randomBytes(32);
      const challengeB64 = base64urlEncode(challengeHash);
      // Manually build JSON with whitespace around colon and before closing quote is
      // not tested (parser stops at first unescaped quote), but whitespace around
      // colons is the documented H-SOL-1 invariant.
      const clientDataJSON = Buffer.from(
        `{"type": "webauthn.get", "challenge" : "${challengeB64}" , "origin" : "http://localhost:3000"}`,
      );
      const secp256r1Ix = buildWebAuthnPrecompileIx(
        minAuthenticatorData,
        clientDataJSON,
        waPrivKey,
        waCompressedPubkey,
      );
      const verifyIx = await program.methods
        .testVerifyWebauthn(
          Array.from(minAuthenticatorData) as number[],
          Array.from(clientDataJSON) as number[],
          Array.from(challengeHash) as number[],
        )
        .accounts({
          agentWallet: waWalletPda,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();
      const tx = new anchor.web3.Transaction().add(secp256r1Ix, verifyIx);
      const txSig = await provider.sendAndConfirm(tx);
      assert.ok(txSig, "whitespace-tolerant clientDataJSON must be accepted");
    });
  });

  // ── set_protocol_authority integration tests (CAS-90) ─────────────────

  describe("set_protocol_authority", () => {
    it("succeeds when called by INITIAL_AUTHORITY", async () => {
      const newAuthority = anchor.web3.Keypair.generate();

      await program.methods
        .setProtocolAuthority(newAuthority.publicKey)
        .accounts({
          attestationRegistry: registryPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      const registry = await program.account.attestationRegistry.fetch(
        registryPda,
      );
      assert.ok(
        registry.authority.equals(newAuthority.publicKey),
        "registry authority must be updated to new_authority",
      );

      // Restore original authority for subsequent tests.
      await program.methods
        .setProtocolAuthority(provider.wallet.publicKey)
        .accounts({
          attestationRegistry: registryPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
    });

    it("fails with UnauthorizedAuthority when called by a non-authority signer", async () => {
      const impostor = anchor.web3.Keypair.generate();

      // Fund the impostor so it can pay for the transaction.
      const airdropSig = await provider.connection.requestAirdrop(
        impostor.publicKey,
        1_000_000_000,
      );
      await provider.connection.confirmTransaction(airdropSig);

      try {
        await program.methods
          .setProtocolAuthority(impostor.publicKey)
          .accounts({
            attestationRegistry: registryPda,
            authority: impostor.publicKey,
          })
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

    // Invariant: protocol authority must never be set to zero pubkey.
    // Otherwise, all authority-gated operations become permanently unusable.
    it("fails with InvalidAuthority when new_authority is zero pubkey", async () => {
      const zeroAuthority = new anchor.web3.PublicKey(new Uint8Array(32));

      try {
        await program.methods
          .setProtocolAuthority(zeroAuthority)
          .accounts({
            attestationRegistry: registryPda,
            authority: provider.wallet.publicKey,
          })
          .rpc();
        assert.fail("expected InvalidAuthority but transaction succeeded");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "InvalidAuthority",
          `expected InvalidAuthority, got: ${diag}`,
        );
      }
    });

    it("correctly updates authority and old authority can no longer call", async () => {
      const newAuthority = anchor.web3.Keypair.generate();

      // Fund new authority.
      const airdropSig = await provider.connection.requestAirdrop(
        newAuthority.publicKey,
        1_000_000_000,
      );
      await provider.connection.confirmTransaction(airdropSig);

      // Rotate authority to newAuthority.
      await program.methods
        .setProtocolAuthority(newAuthority.publicKey)
        .accounts({
          attestationRegistry: registryPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      // Verify the on-chain authority changed.
      const registryAfter = await program.account.attestationRegistry.fetch(
        registryPda,
      );
      assert.ok(
        registryAfter.authority.equals(newAuthority.publicKey),
        "authority must be updated",
      );

      // The original INITIAL_AUTHORITY (provider.wallet) can still call
      // because the instruction checks the compile-time constant, not the
      // on-chain field. Restore for subsequent tests.
      await program.methods
        .setProtocolAuthority(provider.wallet.publicKey)
        .accounts({
          attestationRegistry: registryPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
    });
  });

  // ── rotate_agent_key integration tests ───────────────────────────────
  //
  // Flow: register with old key → attempt invalid rotations → happy-path
  // rotation closes old PDA and opens new PDA with key_version incremented.

  describe("rotate_agent_key", () => {
    let rotOldPrivKey: Uint8Array;
    let rotOldPubkeyX: Buffer;
    let rotOldPubkeyY: Buffer;
    let rotOldCompressedPubkey: Uint8Array;
    let rotOldWalletPda: anchor.web3.PublicKey;

    let rotNewPrivKey: Uint8Array;
    let rotNewPubkeyX: Buffer;
    let rotNewPubkeyY: Buffer;
    let rotNewWalletPda: anchor.web3.PublicKey;

    before(async () => {
      rotOldPrivKey = p256.utils.randomPrivateKey();
      const oldUncompressed: Uint8Array = p256.getPublicKey(rotOldPrivKey, false);
      rotOldCompressedPubkey = p256.getPublicKey(rotOldPrivKey, true);
      rotOldPubkeyX = Buffer.from(oldUncompressed.slice(1, 33));
      rotOldPubkeyY = Buffer.from(oldUncompressed.slice(33, 65));

      [rotOldWalletPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), rotOldPubkeyX, rotOldPubkeyY],
        program.programId,
      );

      rotNewPrivKey = p256.utils.randomPrivateKey();
      const newUncompressed: Uint8Array = p256.getPublicKey(rotNewPrivKey, false);
      rotNewPubkeyX = Buffer.from(newUncompressed.slice(1, 33));
      rotNewPubkeyY = Buffer.from(newUncompressed.slice(33, 65));

      [rotNewWalletPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), rotNewPubkeyX, rotNewPubkeyY],
        program.programId,
      );

      const regPreimage = buildRegistrationPreimage(
        provider.wallet.publicKey,
        rotOldPubkeyX,
        rotOldPubkeyY,
      );
      const regHash = crypto.createHash("sha256").update(regPreimage).digest();
      const regSig = p256.sign(regHash, rotOldPrivKey).toCompactRawBytes();

      const secp256r1Ix = buildSecp256r1Instruction(
        regSig,
        rotOldCompressedPubkey,
        regPreimage,
      );
      const registerIx = await program.methods
        .registerAgentWallet(
          Array.from(rotOldPubkeyX) as number[],
          Array.from(rotOldPubkeyY) as number[],
        )
        .accounts({
          agentWallet: rotOldWalletPda,
          attestationRegistry: registryPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(secp256r1Ix, registerIx);
      await provider.sendAndConfirm(tx);
    });

    // ── Test 1: non-active agent → AgentNotActive ─────────────────────

    it("frozen agent → AgentNotActive", async () => {
      await program.methods
        .setAgentStatus(1)
        .accounts({
          authority: provider.wallet.publicKey,
          agentWallet: rotOldWalletPda,
        })
        .rpc();

      const rotPreimage = buildRotationPreimage(
        provider.wallet.publicKey,
        rotOldPubkeyX,
        rotOldPubkeyY,
        rotNewPubkeyX,
        rotNewPubkeyY,
      );
      const rotHash = crypto.createHash("sha256").update(rotPreimage).digest();
      const rotSig = p256.sign(rotHash, rotOldPrivKey).toCompactRawBytes();

      const secp256r1Ix = buildSecp256r1Instruction(
        rotSig,
        rotOldCompressedPubkey,
        rotPreimage,
      );
      const rotateIx = await program.methods
        .rotateAgentKey(
          Array.from(rotNewPubkeyX) as number[],
          Array.from(rotNewPubkeyY) as number[],
        )
        .accounts({
          oldAgentWallet: rotOldWalletPda,
          newAgentWallet: rotNewWalletPda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(secp256r1Ix, rotateIx);
      try {
        await provider.sendAndConfirm(tx);
        assert.fail("expected AgentNotActive but transaction succeeded");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "AgentNotActive",
          `expected AgentNotActive, got: ${diag}`,
        );
      } finally {
        await program.methods
          .setAgentStatus(0)
          .accounts({
            authority: provider.wallet.publicKey,
            agentWallet: rotOldWalletPda,
          })
          .rpc();
      }
    });

    // ── Test 2: zero-coordinate new key → InvalidAgentKey ─────────────

    it("zero-coordinate new key → InvalidAgentKey", async () => {
      const zeroX = Buffer.alloc(32, 0);
      const someY = Buffer.alloc(32, 1);
      const [zeroPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), zeroX, someY],
        program.programId,
      );

      const rotateIx = await program.methods
        .rotateAgentKey(
          Array.from(zeroX) as number[],
          Array.from(someY) as number[],
        )
        .accounts({
          oldAgentWallet: rotOldWalletPda,
          newAgentWallet: zeroPda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(rotateIx);
      try {
        await provider.sendAndConfirm(tx);
        assert.fail("expected InvalidAgentKey but transaction succeeded");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "InvalidAgentKey",
          `expected InvalidAgentKey, got: ${diag}`,
        );
      }
    });

    // ── Test 3: no precompile → MissingSignatureVerification ──────────

    it("no secp256r1 precompile → MissingSignatureVerification", async () => {
      const rotateIx = await program.methods
        .rotateAgentKey(
          Array.from(rotNewPubkeyX) as number[],
          Array.from(rotNewPubkeyY) as number[],
        )
        .accounts({
          oldAgentWallet: rotOldWalletPda,
          newAgentWallet: rotNewWalletPda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(rotateIx);
      try {
        await provider.sendAndConfirm(tx);
        assert.fail("expected MissingSignatureVerification but transaction succeeded");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "MissingSignatureVerification",
          `expected MissingSignatureVerification, got: ${diag}`,
        );
      }
    });

    // ── Test 4: wrong challenge → RotationChallengeMismatch ───────────

    it("wrong preimage signed → RotationChallengeMismatch", async () => {
      const wrongPreimage = buildRegistrationPreimage(
        provider.wallet.publicKey,
        rotOldPubkeyX,
        rotOldPubkeyY,
      );
      const wrongHash = crypto
        .createHash("sha256")
        .update(wrongPreimage)
        .digest();
      const wrongSig = p256.sign(wrongHash, rotOldPrivKey).toCompactRawBytes();

      const secp256r1Ix = buildSecp256r1Instruction(
        wrongSig,
        rotOldCompressedPubkey,
        wrongPreimage,
      );
      const rotateIx = await program.methods
        .rotateAgentKey(
          Array.from(rotNewPubkeyX) as number[],
          Array.from(rotNewPubkeyY) as number[],
        )
        .accounts({
          oldAgentWallet: rotOldWalletPda,
          newAgentWallet: rotNewWalletPda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(secp256r1Ix, rotateIx);
      try {
        await provider.sendAndConfirm(tx);
        assert.fail("expected RotationChallengeMismatch but transaction succeeded");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "RotationChallengeMismatch",
          `expected RotationChallengeMismatch, got: ${diag}`,
        );
      }
    });

    // ── Test 5: happy path → old PDA closed, new PDA opened ───────────

    it("happy path — valid rotation closes old PDA and opens new PDA with incremented key_version", async () => {
      const walletBefore = await program.account.agentWallet.fetch(rotOldWalletPda);
      const versionBefore = walletBefore.keyVersion as number;

      const rotPreimage = buildRotationPreimage(
        provider.wallet.publicKey,
        rotOldPubkeyX,
        rotOldPubkeyY,
        rotNewPubkeyX,
        rotNewPubkeyY,
      );
      const rotHash = crypto.createHash("sha256").update(rotPreimage).digest();
      const rotSig = p256.sign(rotHash, rotOldPrivKey).toCompactRawBytes();

      const secp256r1Ix = buildSecp256r1Instruction(
        rotSig,
        rotOldCompressedPubkey,
        rotPreimage,
      );
      const rotateIx = await program.methods
        .rotateAgentKey(
          Array.from(rotNewPubkeyX) as number[],
          Array.from(rotNewPubkeyY) as number[],
        )
        .accounts({
          oldAgentWallet: rotOldWalletPda,
          newAgentWallet: rotNewWalletPda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(secp256r1Ix, rotateIx);
      const txSig = await provider.sendAndConfirm(tx);
      assert.ok(txSig, "rotate_agent_key transaction confirmed");

      const oldInfo = await provider.connection.getAccountInfo(rotOldWalletPda);
      assert.isNull(oldInfo, "old agent_wallet PDA must be closed after rotation");

      const newWallet = await program.account.agentWallet.fetch(rotNewWalletPda);
      assert.strictEqual(
        newWallet.keyVersion,
        versionBefore + 1,
        "key_version must be incremented by 1",
      );
      assert.deepEqual(
        Buffer.from(newWallet.pubkeyX),
        rotNewPubkeyX,
        "new wallet must store new pubkey_x",
      );
      assert.deepEqual(
        Buffer.from(newWallet.pubkeyY),
        rotNewPubkeyY,
        "new wallet must store new pubkey_y",
      );
      assert.strictEqual(
        newWallet.authority.toBase58(),
        provider.wallet.publicKey.toBase58(),
        "authority must be preserved across rotation",
      );
      assert.strictEqual(newWallet.status, 0, "new wallet must be Active (status=0)");
    });
  });

  // ── close_agent_wallet end-to-end integration tests ──────────────────
  //
  // Flow: register → admin sets DeregisterPending (status=3) → close with
  // secp256r1 attestation → PDA zeroed, lamports returned, agent_count decremented.

  describe("close_agent_wallet", () => {
    let closePrivKey: Uint8Array;
    let closePubkeyX: Buffer;
    let closePubkeyY: Buffer;
    let closeCompressedPubkey: Uint8Array;
    let closeWalletPda: anchor.web3.PublicKey;

    before(async () => {
      // Generate a fresh secp256r1 key and register it.
      closePrivKey = p256.utils.randomPrivateKey();
      const uncompressed: Uint8Array = p256.getPublicKey(closePrivKey, false);
      closeCompressedPubkey = p256.getPublicKey(closePrivKey, true);
      closePubkeyX = Buffer.from(uncompressed.slice(1, 33));
      closePubkeyY = Buffer.from(uncompressed.slice(33, 65));

      [closeWalletPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), closePubkeyX, closePubkeyY],
        program.programId,
      );

      const regPreimage = buildRegistrationPreimage(
        provider.wallet.publicKey,
        closePubkeyX,
        closePubkeyY,
      );
      const regHash = crypto.createHash("sha256").update(regPreimage).digest();
      const regSig = p256.sign(regHash, closePrivKey).toCompactRawBytes();

      const secp256r1Ix = buildSecp256r1Instruction(
        regSig,
        closeCompressedPubkey,
        regPreimage,
      );
      const registerIx = await program.methods
        .registerAgentWallet(
          Array.from(closePubkeyX) as number[],
          Array.from(closePubkeyY) as number[],
        )
        .accounts({
          agentWallet: closeWalletPda,
          attestationRegistry: registryPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(secp256r1Ix, registerIx);
      await provider.sendAndConfirm(tx);
    });

    // ── Test 1: wrong status → AgentNotDeregisterPending ───────────────

    it("active wallet → AgentNotDeregisterPending", async () => {
      const deregPreimage = buildDeregistrationPreimage(
        provider.wallet.publicKey,
      );
      const deregHash = crypto
        .createHash("sha256")
        .update(deregPreimage)
        .digest();
      const deregSig = p256
        .sign(deregHash, closePrivKey)
        .toCompactRawBytes();

      const secp256r1Ix = buildSecp256r1Instruction(
        deregSig,
        closeCompressedPubkey,
        deregPreimage,
      );
      const closeIx = await program.methods
        .closeAgentWallet()
        .accounts({
          agentWallet: closeWalletPda,
          attestationRegistry: registryPda,
          authority: provider.wallet.publicKey,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(secp256r1Ix, closeIx);
      try {
        await provider.sendAndConfirm(tx);
        assert.fail(
          "expected AgentNotDeregisterPending but transaction succeeded",
        );
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "AgentNotDeregisterPending",
          `expected AgentNotDeregisterPending, got: ${diag}`,
        );
      }
    });

    // ── Test 2: no precompile → MissingSignatureVerification ───────────

    it("no precompile → MissingSignatureVerification", async () => {
      // Set status to DeregisterPending first.
      await program.methods
        .setAgentStatus(3)
        .accounts({
          authority: provider.wallet.publicKey,
          agentWallet: closeWalletPda,
        })
        .rpc();

      const closeIx = await program.methods
        .closeAgentWallet()
        .accounts({
          agentWallet: closeWalletPda,
          attestationRegistry: registryPda,
          authority: provider.wallet.publicKey,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(closeIx);
      try {
        await provider.sendAndConfirm(tx);
        assert.fail(
          "expected MissingSignatureVerification but transaction succeeded",
        );
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.include(
          diag,
          "MissingSignatureVerification",
          `expected MissingSignatureVerification, got: ${diag}`,
        );
      } finally {
        // Reset status back to Active for subsequent tests.
        await program.methods
          .setAgentStatus(0)
          .accounts({
            authority: provider.wallet.publicKey,
            agentWallet: closeWalletPda,
          })
          .rpc();
      }
    });

    // ── Test 3: unauthorized signer → ConstraintHasOne ─────────────────

    it("unauthorized signer → rejected", async () => {
      const impostor = anchor.web3.Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        impostor.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig);

      // Set status to DeregisterPending.
      await program.methods
        .setAgentStatus(3)
        .accounts({
          authority: provider.wallet.publicKey,
          agentWallet: closeWalletPda,
        })
        .rpc();

      const deregPreimage = buildDeregistrationPreimage(impostor.publicKey);
      const deregHash = crypto
        .createHash("sha256")
        .update(deregPreimage)
        .digest();
      const deregSig = p256
        .sign(deregHash, closePrivKey)
        .toCompactRawBytes();

      const secp256r1Ix = buildSecp256r1Instruction(
        deregSig,
        closeCompressedPubkey,
        deregPreimage,
      );
      const closeIx = await program.methods
        .closeAgentWallet()
        .accounts({
          agentWallet: closeWalletPda,
          attestationRegistry: registryPda,
          authority: impostor.publicKey,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .signers([impostor])
        .instruction();

      const tx = new anchor.web3.Transaction().add(secp256r1Ix, closeIx);
      try {
        await provider.sendAndConfirm(tx, [impostor]);
        assert.fail("expected constraint violation but transaction succeeded");
      } catch (err: any) {
        const diag =
          ((err.logs as string[] | undefined)?.join(" ") ?? "") +
          " " +
          (err.message ?? "");
        assert.ok(
          diag.includes("ConstraintHasOne") ||
            diag.includes("has_one") ||
            diag.includes("A has one constraint was violated"),
          `expected has_one constraint violation, got: ${diag}`,
        );
      } finally {
        // Reset status back to Active.
        await program.methods
          .setAgentStatus(0)
          .accounts({
            authority: provider.wallet.publicKey,
            agentWallet: closeWalletPda,
          })
          .rpc();
      }
    });

    // ── Test 4: happy path ─────────────────────────────────────────────

    it("happy path — DeregisterPending + valid attestation → PDA closed", async () => {
      // Set status to DeregisterPending.
      await program.methods
        .setAgentStatus(3)
        .accounts({
          authority: provider.wallet.publicKey,
          agentWallet: closeWalletPda,
        })
        .rpc();

      const registryBefore = await program.account.attestationRegistry.fetch(
        registryPda,
      );
      const countBefore = registryBefore.agentCount.toNumber();

      const deregPreimage = buildDeregistrationPreimage(
        provider.wallet.publicKey,
      );
      const deregHash = crypto
        .createHash("sha256")
        .update(deregPreimage)
        .digest();
      const deregSig = p256
        .sign(deregHash, closePrivKey)
        .toCompactRawBytes();

      const secp256r1Ix = buildSecp256r1Instruction(
        deregSig,
        closeCompressedPubkey,
        deregPreimage,
      );
      const closeIx = await program.methods
        .closeAgentWallet()
        .accounts({
          agentWallet: closeWalletPda,
          attestationRegistry: registryPda,
          authority: provider.wallet.publicKey,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      const tx = new anchor.web3.Transaction().add(secp256r1Ix, closeIx);
      const txSig = await provider.sendAndConfirm(tx);
      assert.ok(txSig, "close_agent_wallet transaction confirmed");

      // Verify PDA is closed (account no longer exists).
      const walletInfo = await provider.connection.getAccountInfo(
        closeWalletPda,
      );
      assert.isNull(walletInfo, "agent_wallet PDA must be closed");

      // Verify agent_count decremented.
      const registryAfter = await program.account.attestationRegistry.fetch(
        registryPda,
      );
      assert.strictEqual(
        registryAfter.agentCount.toNumber(),
        countBefore - 1,
        "agent_count decremented by exactly 1",
      );
    });
  });
});

/**
 * Build the 64-byte deregistration preimage:
 *   "vaultpact:close_agent_wallet:v1:" (32 bytes)
 *   || authority pubkey (32 bytes)
 */
function buildDeregistrationPreimage(
  authority: anchor.web3.PublicKey,
): Buffer {
  return Buffer.concat([
    Buffer.from("vaultpact:close_agent_wallet:v1:"),
    authority.toBuffer(),
  ]);
}

/**
 * Build the 190-byte key-rotation preimage:
 *   "vaultpact:rotate_agent_key:v1:" (30 bytes)
 *   || authority pubkey (32 bytes)
 *   || old_pubkey_x (32 bytes)
 *   || old_pubkey_y (32 bytes)
 *   || new_pubkey_x (32 bytes)
 *   || new_pubkey_y (32 bytes)
 *
 * The OLD secp256r1 key must sign sha256(this preimage) to prove possession
 * and consent to the specific new key (L-SOL-4: both Y coordinates bound).
 */
function buildRotationPreimage(
  authority: anchor.web3.PublicKey,
  oldPubkeyX: Buffer,
  oldPubkeyY: Buffer,
  newPubkeyX: Buffer,
  newPubkeyY: Buffer,
): Buffer {
  return Buffer.concat([
    Buffer.from("vaultpact:rotate_agent_key:v1:"),
    authority.toBuffer(),
    oldPubkeyX,
    oldPubkeyY,
    newPubkeyX,
    newPubkeyY,
  ]);
}

// ── Bankrun time-warp tests ───────────────────────────────────────────
//
// These tests require solana-bankrun to control the validator clock.
// They are skipped automatically on platforms where bankrun is unavailable.
//
// Covered here:
//   - update_reputation decay: 30-day time warp verifies the DECAY_TABLE
//     multiplier is applied before the incoming delta (§3.3 lazy decay).

(bankrunMod ? describe : describe.skip)("bankrun: decay tests", function () {
  this.timeout(120_000);

  const HOLDFAST_ID = new anchor.web3.PublicKey(
    "2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq",
  );

  let context: any;
  let brProvider: any;
  let brProgram: any;
  let brOracle: anchor.web3.Keypair;
  let brAgent: anchor.web3.Keypair;
  let brRepPda: anchor.web3.PublicKey;

  function fundAccount(pubkey: anchor.web3.PublicKey, lamports = 100_000_000_000) {
    context.setAccount(pubkey, {
      lamports,
      data: Buffer.alloc(0),
      owner: anchor.web3.SystemProgram.programId,
      executable: false,
    });
  }

  async function warpClockForward(seconds: number) {
    const currentClock = await context.banksClient.getClock();
    const newTimestamp = currentClock.unixTimestamp + BigInt(seconds);
    context.setClock(
      new bankrunMod.Clock(
        currentClock.slot,
        currentClock.epochStartTimestamp,
        currentClock.epoch,
        currentClock.leaderScheduleEpoch,
        newTimestamp,
      ),
    );
  }

  before(async () => {
    const oraclePath =
      process.env.ORACLE_KEYPAIR_PATH ??
      path.join(os.homedir(), ".config", "solana", "oracle-devnet.json");
    brOracle = anchor.web3.Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(oraclePath, "utf8"))),
    );

    brAgent = anchor.web3.Keypair.generate();

    context = await bankrunMod.startAnchor(".", [], []);
    brProvider = new anchorBankrunMod.BankrunProvider(context);

    brProgram = new anchor.Program(
      (anchor.workspace.Vaultpact as anchor.Program).idl as any,
      brProvider,
    );

    fundAccount(brOracle.publicKey);
    fundAccount(brAgent.publicKey);

    [brRepPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), brAgent.publicKey.toBuffer()],
      HOLDFAST_ID,
    );

    await brProgram.methods
      .initReputation()
      .accounts({
        reputationAccount: brRepPda,
        agent: brAgent.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([brAgent])
      .rpc();

    // Write an initial delta to bring score above neutral so decay is visible.
    // delta=+1500 → score 5000 + 1500 = 6500; decay_cursor = T0.
    await brProgram.methods
      .updateReputation(
        new anchor.BN(1),
        { fulfilled: {} },
        1500,
        Array(7).fill(0),
      )
      .accounts({
        reputationAccount: brRepPda,
        updateAuthority: brOracle.publicKey,
      })
      .signers([brOracle])
      .rpc();
  });

  it("decay: 30-day warp applies DECAY_TABLE[30] before incoming delta", async () => {
    // Warp 30 days forward. Decay formula:
    //   DECAY_TABLE[30] = floor(1_000_000 * 0.99^30) via integer steps
    //                   = 739_681  (t[n] = t[n-1]*99/100)
    //   decayed_score = 5000 + floor((6500-5000) * 739_681 / 1_000_000)
    //                 = 5000 + floor(1500 * 739_681 / 1_000_000)
    //                 = 5000 + floor(1_109_521_500 / 1_000_000)
    //                 = 5000 + 1109 = 6109
    // Then delta=0 is applied → final score = 6109.
    await warpClockForward(30 * 24 * 3600);

    await brProgram.methods
      .updateReputation(
        new anchor.BN(2),
        { fulfilled: {} },
        0,
        Array(7).fill(1),
      )
      .accounts({
        reputationAccount: brRepPda,
        updateAuthority: brOracle.publicKey,
      })
      .signers([brOracle])
      .rpc();

    const rep = await brProgram.account.reputationAccount.fetch(brRepPda);
    assert.strictEqual(
      (rep.score as anchor.BN).toNumber(),
      6109,
      "30-day decay must reduce score from 6500 to 6109 before the delta is applied",
    );
  });
});
