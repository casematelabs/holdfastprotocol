import CodeBlock from "../../components/CodeBlock";
import Callout from "../../components/Callout";
import PrevNext from "../../components/PrevNext";
import OnThisPage from "../../components/OnThisPage";

export const metadata = { title: "Vault (Custody)" };

const headings = [
  { id: "overview", text: "Overview", level: 2 },
  { id: "how-it-works", text: "How It Works", level: 2 },
  { id: "secp256r1", text: "secp256r1 on Solana", level: 2 },
  { id: "pda-derivation", text: "PDA Derivation", level: 2 },
  { id: "webauthn-binding", text: "WebAuthn Message Binding", level: 2 },
  { id: "replay-protection", text: "Replay Protection", level: 2 },
  { id: "velocity-limits", text: "Velocity Rate Limits", level: 2 },
  { id: "backup-keys", text: "Backup Keys", level: 2 },
  { id: "relayer-model", text: "The Relayer Model", level: 2 },
];

export default function VaultConcepts() {
  return (
    <div className="flex gap-10">
      <div className="max-w-4xl mx-auto px-8 py-16 lg:py-20 min-w-0 flex-1">
        <div className="text-[12px] text-slate-500 font-medium mb-8">
          Docs <span className="mx-1.5 text-slate-700">/</span>
          Core Concepts <span className="mx-1.5 text-slate-700">/</span>
          Vault
        </div>

        <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-md mb-4">
          Layer 1
        </div>

        <h1 className="text-4xl font-extrabold text-white tracking-tight mb-4">
          Vault: Hardware-Attested Custody
        </h1>
        <p className="text-lg text-slate-400 leading-relaxed mb-12 max-w-2xl">
          The Vault is the foundational layer of Holdfast. It binds an AI agent&apos;s
          financial identity to a tamper-resistant hardware enclave using secp256r1
          (P-256) cryptography. There are no seed phrases. There is no software-extractable
          private key. The hardware IS the authority.
        </p>

        {/* Overview */}
        <section>
          <h2 id="overview" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Overview
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            A Vault is a Solana Program Derived Address (PDA) that stores SOL and enforces
            a strict security policy. Every operation that moves funds or changes policy
            requires a cryptographic signature from a FIDO2 hardware security key
            (such as a YubiKey) or platform authenticator (TouchID, Windows Hello).
          </p>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The Vault enforces four layers of protection simultaneously:
          </p>
          <div className="grid sm:grid-cols-2 gap-3 my-6">
            {[
              { title: "Hardware Attestation", desc: "Every signed operation requires physical proof from a FIDO2 key." },
              { title: "Default-Deny Whitelist", desc: "Funds can only be sent to pre-approved addresses." },
              { title: "Velocity Rate Limiting", desc: "Configurable daily spend caps with burst cooldown." },
              { title: "Replay Protection", desc: "Monotonic nonce prevents transaction replay." },
            ].map((item) => (
              <div key={item.title} className="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
                <div className="text-sm font-semibold text-white mb-1">{item.title}</div>
                <p className="text-[12px] text-slate-500 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="mt-14">
          <h2 id="how-it-works" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            How It Works
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">
            Every signed vault operation follows a precise four-step flow:
          </p>
          <div className="space-y-4">
            {[
              {
                step: "1",
                title: "User taps the FIDO2 key",
                desc: "The browser triggers a WebAuthn assertion. The hardware key produces a secp256r1 (P-256) signature over a message that binds the operation type, vault address, all parameters, and a monotonic nonce.",
              },
              {
                step: "2",
                title: "Browser constructs a two-instruction transaction",
                desc: "Instruction A: a native Secp256r1Program instruction (SIMD-48) that verifies the signature on-chain. Instruction B: the actual Vault instruction (e.g., withdraw).",
              },
              {
                step: "3",
                title: "Vault program reads the precompile result",
                desc: "The program reads the preceding precompile instruction via the Instructions sysvar, extracts the verified message, and recomputes the WebAuthn binding.",
              },
              {
                step: "4",
                title: "Challenge verification",
                desc: "The program verifies that the challenge embedded in clientDataJSON matches the operation-specific intent hash it independently reconstructed from the call parameters.",
              },
            ].map((item) => (
              <div key={item.step} className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-emerald-400">{item.step}</span>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white mb-1">{item.title}</h4>
                  <p className="text-[13px] text-slate-500 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <Callout type="tip" title="Defense in depth">
            <p>
              Even if an attacker fully compromises the user&apos;s machine, they cannot authorize
              any operation on the vault without physical possession of the security key AND
              the user&apos;s PIN. This is true hardware-backed 2FA: something you have + something you know.
            </p>
          </Callout>
        </section>

        {/* secp256r1 */}
        <section className="mt-14">
          <h2 id="secp256r1" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            secp256r1 on Solana (SIMD-48)
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Solana natively supports secp256r1 signature verification through the
            SIMD-48 precompile. This is the same curve used by FIDO2/WebAuthn hardware
            security keys, Apple&apos;s Secure Enclave, Android Keystore, and Windows Hello.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The precompile verifies signatures at the runtime level before your program
            executes, meaning the cryptographic verification is effectively free in terms
            of compute units -- it happens in native code, not BPF.
          </p>
          <CodeBlock
            code={`// The precompile instruction verifies:
//   1. The secp256r1 signature (r, s) is valid
//   2. The public key matches the provided coordinates
//   3. The message hash matches the signed data
//
// Our program then validates:
//   - The verified pubkey matches the vault's stored pubkey_x/pubkey_y
//   - The verified message matches sha256(authData || sha256(clientDataJSON))
//   - The challenge in clientDataJSON matches our intent hash
//   - The origin in clientDataJSON is in our allowlist`}
            language="rust"
            filename="verification_flow.rs"
          />
        </section>

        {/* PDA Derivation */}
        <section className="mt-14">
          <h2 id="pda-derivation" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            PDA Derivation
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The vault address is deterministically derived from both coordinates of the
            secp256r1 public key. This creates a permanent, one-to-one binding between
            a hardware key and its on-chain vault.
          </p>
          <CodeBlock
            code={`// Vault PDA derivation
seeds = [b"vault", pubkey_x (32 bytes), pubkey_y (32 bytes)]

// This means:
// - Every hardware key maps to exactly one vault address
// - The vault address is deterministic and recoverable
// - No one can create a second vault for the same key
// - Both coordinates are required (prevents related-key attacks)`}
            language="rust"
            filename="pda_seeds.rs"
          />
          <Callout type="info" title="Why both coordinates?">
            <p>
              Using only the X coordinate would allow an attacker with a different key
              that shares the same X (but different Y) to claim the vault. Including
              both coordinates (L-SOL-4) ensures the vault is bound to the canonical
              full public key.
            </p>
          </Callout>
        </section>

        {/* WebAuthn Binding */}
        <section className="mt-14">
          <h2 id="webauthn-binding" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            WebAuthn Message Binding
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The message that the hardware key signs follows the WebAuthn specification exactly.
            This is critical for anti-phishing protection -- the browser enforces origin binding
            that the hardware key cryptographically commits to.
          </p>
          <CodeBlock
            code={`// What the hardware key actually signs:
message = sha256(authenticatorData || sha256(clientDataJSON))

// Where clientDataJSON contains:
{
  "type": "webauthn.get",
  "challenge": "<base64url(sha256(intent))>",
  "origin": "https://holdfastprotocol.com",
  "crossOrigin": false
}

// And the intent hash binds ALL operation parameters:
intent = hash("withdraw" || vault_address || destination || amount || nonce)`}
            language="text"
            filename="webauthn_binding.txt"
          />
          <Callout type="danger" title="Anti-phishing (C-SOL-1)">
            <p>
              The origin field is verified on-chain against a hardcoded allowlist. This is the
              entire point of WebAuthn&apos;s anti-phishing protection. A signature harvested from
              a phishing site will contain the wrong origin and be rejected by the program.
              The allowlist is immutable -- it cannot be changed without redeploying the program.
            </p>
          </Callout>
        </section>

        {/* Replay Protection */}
        <section className="mt-14">
          <h2 id="replay-protection" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Replay Protection
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Every signed operation increments a per-vault monotonic nonce. The nonce is included
            in the intent hash that the WebAuthn challenge must match. Replaying an old assertion
            fails because:
          </p>
          <ul className="space-y-2 text-sm text-slate-400 mb-4 ml-4">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
              The on-chain nonce has advanced past the value in the old assertion
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
              The expected challenge changes with the nonce
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
              The challenge embedded in the old clientDataJSON no longer matches what the program computes
            </li>
          </ul>
        </section>

        {/* Velocity Limits */}
        <section className="mt-14">
          <h2 id="velocity-limits" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Velocity Rate Limits
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Vaults enforce configurable spending limits using a tumbling-window model with
            burst cooldown. The default is 5 SOL per 24 hours.
          </p>
          <CodeBlock
            code={`// Default configuration:
velocity_limit:  5 SOL per window
velocity_window: 24 hours
burst_threshold: 50% of limit

// If a withdrawal pushes spent >= 50% of the limit:
//   -> Arms a cooldown of (window / 2)
//   -> No further withdrawals until cooldown expires
//
// This prevents the boundary attack:
//   5 SOL at 23:59 + 5 SOL at 00:01 = 10 SOL in 2 minutes
//   The 50% burst cooldown blocks the second withdrawal.

// Increasing the limit requires a 24-hour timelock (M-3).
// Decreasing the limit takes effect immediately.`}
            language="text"
            filename="velocity_model.txt"
          />
        </section>

        {/* Backup Keys */}
        <section className="mt-14">
          <h2 id="backup-keys" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Backup Keys
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Each vault supports enrolling a second FIDO2 security key as a backup. If the primary
            key is lost or damaged, the backup key can authorize all the same operations.
            Revoking a backup requires the primary key -- the backup cannot remove itself.
          </p>
        </section>

        {/* Relayer Model */}
        <section className="mt-14">
          <h2 id="relayer-model" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            The Relayer Model
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            A separate ed25519 keypair (the relayer) pays Solana transaction fees so
            agents don&apos;t need SOL for gas before their vault is funded. The relayer has
            zero authority over any vault -- compromising it only costs the attacker SOL
            transaction fees. It cannot move funds, change policy, or sign operations.
          </p>
          <Callout type="warning" title="Security boundary">
            <p>
              The relayer is a convenience mechanism, not a trust boundary. It should be
              treated as a hot wallet with limited SOL. Never use a vault&apos;s hardware key
              as the relayer.
            </p>
          </Callout>
        </section>

        <PrevNext
          prev={{ href: "/docs/concepts", title: "Core Concepts" }}
          next={{ href: "/docs/concepts/pact", title: "Pact (Escrow)" }}
        />
      </div>
      <OnThisPage headings={headings} />
    </div>
  );
}
