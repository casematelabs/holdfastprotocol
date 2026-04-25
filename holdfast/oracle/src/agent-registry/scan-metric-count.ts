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

const slot = BigInt(await conn.getSlot("confirmed"));
const { blockhash } = await conn.getLatestBlockhash();

for (const mc of [1, 2, 3, 4, 5, 0]) {
  const buf = Buffer.alloc(96);
  let off = 0;
  PUBLISH_INTO_ATOM_DISC.copy(buf, off); off += 8;
  buf.writeUInt16LE(7900, off); off += 2;
  buf.writeUInt16LE(8400, off); off += 2;
  buf.writeUInt8(mc, off++);
  buf.writeUInt8(0,  off++);
  buf.writeUInt8(5,  off++);  // sequenceDomain=5
  buf.writeUInt8(0,  off++);
  buf.writeBigUInt64LE(256n, off); off += 8;
  buf.writeBigUInt64LE(256n, off); off += 8;
  buf.writeBigUInt64LE(slot, off); off += 8;
  buf.writeBigUInt64LE(100n, off); off += 8;

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
  const tx = new Transaction();
  tx.add(ix);
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = blockhash;

  const sim = await conn.simulateTransaction(tx, [kp]);
  const errLine = (sim.value.logs ?? []).find(l => l.includes("Error Code:") || l.includes("success"));
  const domainLine = (sim.value.logs ?? []).find(l => l.includes("Instruction: PublishLegitScore"));
  console.log(
    `metricCount=${mc} -> ` +
    (sim.value.err
      ? (errLine ?? JSON.stringify(sim.value.err))
      : "OK (would succeed)"),
  );
}
