import EndpointCard from "../../components/EndpointCard";
import PrevNext from "../../components/PrevNext";
import OnThisPage from "../../components/OnThisPage";

export const metadata = { title: "Vault SDK" };

const headings = [
  { id: "create-credential", text: "Vault.createCredential", level: 2 },
  { id: "initialize-vault", text: "client.initializeVault", level: 2 },
  { id: "deposit", text: "client.deposit", level: 2 },
  { id: "withdraw", text: "client.withdraw", level: 2 },
  { id: "add-to-whitelist", text: "client.addToWhitelist", level: 2 },
  { id: "remove-from-whitelist", text: "client.removeFromWhitelist", level: 2 },
  { id: "set-velocity-limit", text: "client.setVelocityLimit", level: 2 },
  { id: "enroll-backup-key", text: "client.enrollBackupKey", level: 2 },
  { id: "get-vault", text: "client.getVault", level: 2 },
  { id: "get-balance", text: "client.getBalance", level: 2 },
  { id: "derive-vault-address", text: "Vault.deriveAddress", level: 2 },
  { id: "close-vault", text: "client.closeVault", level: 2 },
];

export default function VaultApiReference() {
  return (
    <div className="flex gap-10">
      <div className="max-w-4xl mx-auto px-8 py-16 lg:py-20 min-w-0 flex-1">
        <div className="text-[12px] text-slate-500 font-medium mb-8">
          Docs <span className="mx-1.5 text-slate-700">/</span>
          API Reference <span className="mx-1.5 text-slate-700">/</span>
          Vault SDK
        </div>

        <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-md mb-4">
          12 Methods
        </div>

        <h1 className="text-4xl font-extrabold text-white tracking-tight mb-4">
          Vault SDK Reference
        </h1>
        <p className="text-lg text-slate-400 leading-relaxed mb-12 max-w-2xl">
          Complete reference for hardware-attested wallet operations. Methods
          marked <span className="text-purple-400 font-semibold">sign</span> require
          a secp256r1 hardware key tap.
        </p>

        {/* createCredential */}
        <div id="create-credential" className="scroll-mt-24">
          <EndpointCard
            method="sign"
            name="Vault.createCredential"
            description="Create a new WebAuthn credential using a FIDO2 security key or platform authenticator. Triggers the browser's WebAuthn registration ceremony. Returns the secp256r1 public key coordinates for on-chain storage."
            signature="Vault.createCredential(options: CredentialOptions): Promise<WebAuthnCredential>"
            params={[
              { name: "rpId", type: "string", required: true, description: "Relying Party ID (your domain, e.g., 'holdfastprotocol.com')" },
              { name: "rpName", type: "string", required: true, description: "Human-readable relying party name" },
              { name: "userName", type: "string", required: true, description: "User identifier for the credential" },
              { name: "requirePhysicalKey", type: "boolean", description: "If true, restricts to cross-platform authenticators (YubiKey). Default: false (allows TouchID/FaceID)." },
            ]}
            returns="Promise<{ credentialId: Uint8Array, publicKey: { x: Uint8Array, y: Uint8Array }, keyLabel: string }>"
            example={`const credential = await Vault.createCredential({
  rpId: 'yourdomain.com',
  rpName: 'Agent Platform',
  userName: 'agent_alpha',
  requirePhysicalKey: true,
});

console.log('Public Key X:', Buffer.from(credential.publicKey.x).toString('hex'));
console.log('Public Key Y:', Buffer.from(credential.publicKey.y).toString('hex'));`}
            exampleFilename="create_credential.ts"
          />
        </div>

        {/* initializeVault */}
        <div id="initialize-vault" className="scroll-mt-24">
          <EndpointCard
            method="write"
            name="client.initializeVault"
            description="Deploy a new vault PDA on-chain bound to the provided secp256r1 public key coordinates. The vault address is deterministically derived from seeds [b'vault', pubkey_x, pubkey_y]. Initializes with default velocity limits (5 SOL / 24h)."
            signature="client.initializeVault(options: InitVaultOptions): Promise<VaultResult>"
            params={[
              { name: "pubkeyX", type: "Uint8Array", required: true, description: "32-byte X coordinate of the secp256r1 public key" },
              { name: "pubkeyY", type: "Uint8Array", required: true, description: "32-byte Y coordinate of the secp256r1 public key" },
            ]}
            returns="Promise<{ address: PublicKey, signature: string }>"
            example={`const vault = await client.initializeVault({
  pubkeyX: credential.publicKey.x,
  pubkeyY: credential.publicKey.y,
});

console.log('Vault PDA:', vault.address.toBase58());`}
            exampleFilename="init_vault.ts"
          />
        </div>

        {/* deposit */}
        <div id="deposit" className="scroll-mt-24">
          <EndpointCard
            method="write"
            name="client.deposit"
            description="Deposit SOL into a vault. This is a permissionless operation -- anyone can deposit to any vault address. No authentication required."
            signature="client.deposit(options: DepositOptions): Promise<TransactionResult>"
            params={[
              { name: "vault", type: "PublicKey", required: true, description: "The vault PDA address" },
              { name: "amount", type: "number", required: true, description: "Amount in lamports (1 SOL = 1,000,000,000)" },
            ]}
            returns="Promise<{ signature: string }>"
            example={`await client.deposit({
  vault: vaultAddress,
  amount: 1_000_000_000, // 1 SOL
});`}
            exampleFilename="deposit.ts"
          />
        </div>

        {/* withdraw */}
        <div id="withdraw" className="scroll-mt-24">
          <EndpointCard
            method="sign"
            name="client.withdraw"
            description="Withdraw SOL from a vault to a whitelisted destination. Requires hardware key signature. Subject to velocity rate limits and burst cooldown. A 0.25% protocol fee is auto-deducted."
            signature="client.withdraw(options: WithdrawOptions): Promise<TransactionResult>"
            params={[
              { name: "vault", type: "PublicKey", required: true, description: "The vault PDA address" },
              { name: "destination", type: "PublicKey", required: true, description: "Destination address (must be whitelisted)" },
              { name: "amount", type: "number", required: true, description: "Amount in lamports (minimum: 10,000 = 0.00001 SOL)" },
              { name: "credential", type: "WebAuthnCredential", required: true, description: "The credential used for signing" },
            ]}
            returns="Promise<{ signature: string, fee: number, netAmount: number }>"
            example={`const tx = await client.withdraw({
  vault: vaultAddress,
  destination: recipientPubkey,
  amount: 500_000_000, // 0.5 SOL
  credential: credential,
});

console.log('Net amount:', tx.netAmount / 1e9, 'SOL');
console.log('Protocol fee:', tx.fee / 1e9, 'SOL');`}
            exampleFilename="withdraw.ts"
          />
        </div>

        {/* addToWhitelist */}
        <div id="add-to-whitelist" className="scroll-mt-24">
          <EndpointCard
            method="sign"
            name="client.addToWhitelist"
            description="Add a destination address to the vault's whitelist. Withdrawals can only be made to whitelisted addresses (default-deny policy). Requires hardware key signature."
            signature="client.addToWhitelist(options: WhitelistOptions): Promise<TransactionResult>"
            params={[
              { name: "vault", type: "PublicKey", required: true, description: "The vault PDA address" },
              { name: "target", type: "PublicKey", required: true, description: "Address to whitelist" },
              { name: "credential", type: "WebAuthnCredential", required: true, description: "The credential used for signing" },
            ]}
            returns="Promise<{ signature: string }>"
          />
        </div>

        {/* removeFromWhitelist */}
        <div id="remove-from-whitelist" className="scroll-mt-24">
          <EndpointCard
            method="sign"
            name="client.removeFromWhitelist"
            description="Remove a destination from the vault's whitelist. The whitelist PDA is closed and rent is reclaimed. Requires hardware key signature."
            signature="client.removeFromWhitelist(options: WhitelistOptions): Promise<TransactionResult>"
            params={[
              { name: "vault", type: "PublicKey", required: true, description: "The vault PDA address" },
              { name: "target", type: "PublicKey", required: true, description: "Address to remove from whitelist" },
              { name: "credential", type: "WebAuthnCredential", required: true, description: "The credential used for signing" },
            ]}
            returns="Promise<{ signature: string }>"
          />
        </div>

        {/* setVelocityLimit */}
        <div id="set-velocity-limit" className="scroll-mt-24">
          <EndpointCard
            method="sign"
            name="client.setVelocityLimit"
            description="Update the vault's spending rate limit. Increases are timelocked (24h delay). Decreases take effect immediately. Requires hardware key signature."
            signature="client.setVelocityLimit(options: VelocityOptions): Promise<TransactionResult>"
            params={[
              { name: "vault", type: "PublicKey", required: true, description: "The vault PDA address" },
              { name: "limit", type: "number", required: true, description: "New limit in lamports per window" },
              { name: "window", type: "number", description: "Window duration in seconds (3,600 - 604,800). Default: 86,400 (24h)" },
              { name: "credential", type: "WebAuthnCredential", required: true, description: "The credential used for signing" },
            ]}
            returns="Promise<{ signature: string, effectiveAt: number }>"
            example={`// Increase limit — takes effect in 24 hours
const result = await client.setVelocityLimit({
  vault: vaultAddress,
  limit: 10_000_000_000, // 10 SOL
  credential: credential,
});
console.log('Effective at:', new Date(result.effectiveAt * 1000));

// Decrease limit — takes effect immediately
await client.setVelocityLimit({
  vault: vaultAddress,
  limit: 2_000_000_000, // 2 SOL
  credential: credential,
});`}
            exampleFilename="velocity.ts"
          />
        </div>

        {/* enrollBackupKey */}
        <div id="enroll-backup-key" className="scroll-mt-24">
          <EndpointCard
            method="sign"
            name="client.enrollBackupKey"
            description="Register a second FIDO2 security key as a backup. The backup key can authorize all the same operations as the primary. Only one backup key per vault. Requires primary key signature."
            signature="client.enrollBackupKey(options: BackupOptions): Promise<TransactionResult>"
            params={[
              { name: "vault", type: "PublicKey", required: true, description: "The vault PDA address" },
              { name: "backupX", type: "Uint8Array", required: true, description: "32-byte X coordinate of the backup key" },
              { name: "backupY", type: "Uint8Array", required: true, description: "32-byte Y coordinate of the backup key" },
              { name: "credential", type: "WebAuthnCredential", required: true, description: "Primary key credential for authorization" },
            ]}
            returns="Promise<{ signature: string }>"
          />
        </div>

        {/* getVault */}
        <div id="get-vault" className="scroll-mt-24">
          <EndpointCard
            method="read"
            name="client.getVault"
            description="Fetch the full on-chain state of a vault: public key coordinates, velocity config, nonce, backup key status, and pending operations."
            signature="client.getVault(address: PublicKey): Promise<VaultState>"
            params={[
              { name: "address", type: "PublicKey", required: true, description: "The vault PDA address" },
            ]}
            returns={`Promise<{
  pubkeyX: Uint8Array, pubkeyY: Uint8Array,
  velocityLimit: number, velocityWindow: number, velocitySpent: number,
  nonce: number, hasBackup: boolean, bump: number
}>`}
          />
        </div>

        {/* getBalance */}
        <div id="get-balance" className="scroll-mt-24">
          <EndpointCard
            method="read"
            name="client.getBalance"
            description="Get the vault's current SOL balance in lamports."
            signature="client.getBalance(address: PublicKey): Promise<number>"
            params={[
              { name: "address", type: "PublicKey", required: true, description: "The vault PDA address" },
            ]}
            returns="Promise<number> (lamports)"
          />
        </div>

        {/* deriveAddress */}
        <div id="derive-vault-address" className="scroll-mt-24">
          <EndpointCard
            method="read"
            name="Vault.deriveAddress"
            description="Deterministically compute the vault PDA address from secp256r1 public key coordinates. This is a local computation -- no RPC call required."
            signature="Vault.deriveAddress(pubkeyX: Uint8Array, pubkeyY: Uint8Array): PublicKey"
            params={[
              { name: "pubkeyX", type: "Uint8Array", required: true, description: "32-byte X coordinate" },
              { name: "pubkeyY", type: "Uint8Array", required: true, description: "32-byte Y coordinate" },
            ]}
            returns="PublicKey"
            example={`const vaultAddress = Vault.deriveAddress(
  credential.publicKey.x,
  credential.publicKey.y,
);
console.log(vaultAddress.toBase58());`}
            exampleFilename="derive.ts"
          />
        </div>

        {/* closeVault */}
        <div id="close-vault" className="scroll-mt-24">
          <EndpointCard
            method="sign"
            name="client.closeVault"
            description="Permanently close the vault and reclaim ALL remaining lamports. This operation is irreversible. Requires hardware key signature."
            signature="client.closeVault(options: CloseOptions): Promise<TransactionResult>"
            params={[
              { name: "vault", type: "PublicKey", required: true, description: "The vault PDA address" },
              { name: "destination", type: "PublicKey", required: true, description: "Address to receive remaining lamports" },
              { name: "credential", type: "WebAuthnCredential", required: true, description: "The credential used for signing" },
            ]}
            returns="Promise<{ signature: string }>"
          />
        </div>

        <PrevNext
          prev={{ href: "/docs/api-reference", title: "API Reference" }}
          next={{ href: "/docs/api-reference/pact", title: "Pact SDK" }}
        />
      </div>
      <OnThisPage headings={headings} />
    </div>
  );
}
