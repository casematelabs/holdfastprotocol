import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const PUBLISH_INTO_ATOM_DISC = Buffer.from("6b4e9567c6aec0c9", "hex");
const conn  = new Connection("https://api.devnet.solana.com", "confirmed");
const kp    = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(homedir()+"/.config/solana/devnet.json","utf8")) as number[]));
const bridge = new PublicKey("5dDk9suKgyS9QqbgRf3Fet6v3sa37VsACsVaJFBgZg92");
const atom   = new PublicKey("AToMufS4QD6hEXvcvBDg9m1AHeCLpmZQsyfYa5h9MwAF");
const bcfg   = new PublicKey("GFk2wGMVakcS3AwM6P8orW33zcY1n2xBjtjJEcbR49zn");
const snap   = new PublicKey("CoqRXe2K5X52SCHfzFpbNwS1bhFZ2KyyQBnvcyxZP1d5");
const stats  = new PublicKey("KMqMvMkw2S6rKQMBKbQYvGFFigYwQp4aCQWJzDVCScg");

const metricCount = parseInt(process.env["MC"] ?? "1", 10);
const statusCode  = parseInt(process.env["SC"] ?? "0", 10);
const seqDomain   = parseInt(process.env["SD"] ?? "5", 10);
const seq = BigInt(process.env["SEQ"] ?? "256");
const slot = BigInt(await conn.getSlot("confirmed"));

const buf = Buffer.alloc(96);
let off = 0;
PUBLISH_INTO_ATOM_DISC.copy(buf, off); off += 8;
buf.writeUInt16LE(7900, off); off += 2;
buf.writeUInt16LE(8400, off); off += 2;
buf.writeUInt8(metricCount, off++);
buf.writeUInt8(statusCode, off++);
buf.writeUInt8(seqDomain, off++);
buf.writeUInt8(0, off++);
buf.writeBigUInt64LE(seq, off); off += 8;
buf.writeBigUInt64LE(seq, off); off += 8;
buf.writeBigUInt64LE(slot, off); off += 8;
buf.writeBigUInt64LE(100n, off); off += 8;

console.log(`Probe: metricCount=${metricCount} statusCode=${statusCode} seqDomain=${seqDomain} seq=${seq} slot=${slot}`);
console.log("args hex:", buf.slice(8).toString("hex"));

const ix = new TransactionInstruction({
  programId: bridge,
  keys: [
    { pubkey: bcfg,  isSigner: false, isWritable: false },
    { pubkey: snap,  isSigner: false, isWritable: true  },
    { pubkey: stats, isSigner: false, isWritable: true  },
    { pubkey: atom,  isSigner: false, isWritable: false },
  ],
  data: buf,
});
const tx = new Transaction().add(ix);

try {
  const sig = await conn.sendTransaction(tx, [kp], { skipPreflight: false });
  await conn.confirmTransaction(sig, "confirmed");
  console.log("SUCCESS sig=", sig);
} catch (err: unknown) {
  const se = err as { transactionLogs?: string[] };
  const logs = se.transactionLogs ?? [];
  const errLine = logs.find(l => l.includes("Error Code:"));
  console.log("FAIL:", errLine ?? String(err));
}
