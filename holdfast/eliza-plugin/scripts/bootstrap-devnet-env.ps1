param(
  [string]$EnvFile = ".env.devnet.integration",
  [string]$RpcUrl = "https://api.devnet.solana.com"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $EnvFile)) {
  if (Test-Path -LiteralPath ".env.devnet.integration.example") {
    Copy-Item -LiteralPath ".env.devnet.integration.example" -Destination $EnvFile -Force
  } else {
    Write-Error "Missing $EnvFile and .env.devnet.integration.example"
  }
}

$nodeScript = @'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import {
  Keypair,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { registerAgentWallet } from "@holdfastprotocol/sdk";

const rpcUrl = process.argv[2];
const keypairPath = path.join(os.homedir(), ".config", "solana", "devnet.json");
if (!fs.existsSync(keypairPath)) {
  throw new Error(`Missing keypair: ${keypairPath}`);
}
const raw = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
const signer = Keypair.fromSecretKey(Uint8Array.from(raw));
const connection = new Connection(rpcUrl, "confirmed");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MINT_SIZE = 82;
const DEFAULT_AMOUNT_BASE_UNITS = "1000000";
let agentWallet = "";
let registerError = "";
try {
  const registration = await registerAgentWallet({ connection, signer });
  agentWallet = registration.agentWallet.toBase58();
} catch (err) {
  registerError = err instanceof Error ? err.message : String(err);
  try {
    const holdfastProgramId = new PublicKey("D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg");
    const wallets = await connection.getProgramAccounts(holdfastProgramId, {
      filters: [
        { dataSize: 132 },
        { memcmp: { offset: 8, bytes: signer.publicKey.toBase58() } },
      ],
    });
    const active = wallets
      .map((w) => {
        const d = w.account.data;
        const status = d.readUInt8(120);
        const registeredAt = Number(d.readBigInt64LE(112));
        return { wallet: w.pubkey.toBase58(), status, registeredAt };
      })
      .filter((w) => w.status === 0)
      .sort((a, b) => b.registeredAt - a.registeredAt);
    if (active.length > 0) {
      agentWallet = active[0].wallet;
      registerError = registerError + " | fallback=used-existing-active-agent-wallet";
    }
  } catch (fallbackErr) {
    const extra = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    registerError = registerError + " | fallback_error=" + extra;
  }
}

let mint = "";
let amountBaseUnits = "";
let mintError = "";
try {
  const mintKp = Keypair.generate();
  const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);

  const initMintData = Buffer.alloc(67);
  initMintData[0] = 20; // InitializeMint2
  initMintData[1] = 6;  // decimals
  signer.publicKey.toBuffer().copy(initMintData, 2); // mint authority

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: signer.publicKey,
      newAccountPubkey: mintKp.publicKey,
      space: MINT_SIZE,
      lamports: mintRent,
      programId: TOKEN_PROGRAM_ID,
    }),
    new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [{ pubkey: mintKp.publicKey, isSigner: false, isWritable: true }],
      data: initMintData,
    }),
  );
  await sendAndConfirmTransaction(connection, createMintTx, [signer, mintKp], { commitment: "confirmed" });

  const [ata] = PublicKey.findProgramAddressSync(
    [signer.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintKp.publicKey.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const createAtaTx = new Transaction().add(
    new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: signer.publicKey, isSigner: true, isWritable: true }, // payer
        { pubkey: ata, isSigner: false, isWritable: true }, // ata
        { pubkey: signer.publicKey, isSigner: false, isWritable: false }, // owner
        { pubkey: mintKp.publicKey, isSigner: false, isWritable: false }, // mint
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: Buffer.alloc(0),
    }),
  );
  await sendAndConfirmTransaction(connection, createAtaTx, [signer], { commitment: "confirmed" });

  const mintToData = Buffer.alloc(9);
  mintToData[0] = 7; // MintTo
  mintToData.writeBigUInt64LE(BigInt(DEFAULT_AMOUNT_BASE_UNITS), 1);
  const mintToTx = new Transaction().add(
    new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: mintKp.publicKey, isSigner: false, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: signer.publicKey, isSigner: true, isWritable: false },
      ],
      data: mintToData,
    }),
  );
  await sendAndConfirmTransaction(connection, mintToTx, [signer], { commitment: "confirmed" });

  mint = mintKp.publicKey.toBase58();
  amountBaseUnits = DEFAULT_AMOUNT_BASE_UNITS;
} catch (err) {
  mintError = err instanceof Error ? err.message : String(err);
}

const out = {
  privateKeyBase58: bs58.encode(signer.secretKey),
  signerPubkey: signer.publicKey.toBase58(),
  agentWallet,
  registerError,
  mint,
  amountBaseUnits,
  mintError,
};
process.stdout.write(JSON.stringify(out));
'@

$json = $nodeScript | node --input-type=module - $RpcUrl
$data = $json | ConvertFrom-Json

$map = [ordered]@{
  HF_DEVNET_SIGNER_PRIVATE_KEY_BASE58 = $data.privateKeyBase58
  HF_DEVNET_COUNTERPARTY = $data.signerPubkey
  HF_DEVNET_RPC_URL = $RpcUrl
}

if (-not [string]::IsNullOrWhiteSpace($data.agentWallet)) {
  $map["HF_DEVNET_AGENT_WALLET"] = $data.agentWallet
}
if (-not [string]::IsNullOrWhiteSpace($data.mint)) {
  $map["HF_DEVNET_MINT"] = $data.mint
}
if (-not [string]::IsNullOrWhiteSpace($data.amountBaseUnits)) {
  $map["HF_DEVNET_AMOUNT_BASE_UNITS"] = $data.amountBaseUnits
}

$lines = Get-Content -LiteralPath $EnvFile
$keys = @{}
for ($i = 0; $i -lt $lines.Count; $i += 1) {
  if ($lines[$i] -match "^([A-Z0-9_]+)=(.*)$") {
    $keys[$matches[1]] = $i
  }
}

foreach ($k in $map.Keys) {
  $entry = "$k=$($map[$k])"
  if ($keys.ContainsKey($k)) {
    $lines[$keys[$k]] = $entry
  } else {
    $lines += $entry
  }
}

Set-Content -LiteralPath $EnvFile -Value $lines -NoNewline:$false

Write-Output "Updated $EnvFile with available signer defaults."
if (-not [string]::IsNullOrWhiteSpace($data.registerError)) {
  Write-Warning ("Could not auto-register/fetch HF_DEVNET_AGENT_WALLET: " + $data.registerError)
}
if (-not [string]::IsNullOrWhiteSpace($data.mintError)) {
  Write-Warning ("Could not auto-create/fund HF_DEVNET_MINT: " + $data.mintError)
}
Write-Output "Still required: HF_DEVNET_AGENT_WALLET (if not set), HF_DEVNET_MINT (if not set), HF_DEVNET_AMOUNT_BASE_UNITS (if not set)"
