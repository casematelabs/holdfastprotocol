import CodeBlock from "../components/CodeBlock";
import Callout from "../components/Callout";
import PrevNext from "../components/PrevNext";
import OnThisPage from "../components/OnThisPage";

export const metadata = { title: "Security Model" };

const headings = [
  { id: "threat-model", text: "Threat Model", level: 2 },
  { id: "anti-phishing", text: "Anti-Phishing (C-SOL-1)", level: 2 },
  { id: "replay-protection", text: "Replay Protection", level: 2 },
  { id: "cpi-rejection", text: "CPI Rejection (M-SOL-6)", level: 2 },
  { id: "instruction-validation", text: "Instruction Index Validation (H-2)", level: 2 },
  { id: "signature-canonicity", text: "Signature Canonicity", level: 2 },
  { id: "velocity-defense", text: "Velocity Defense (M-SOL-5)", level: 2 },
  { id: "key-compromise", text: "Key Compromise Scenarios", level: 2 },
  { id: "audit-status", text: "Audit Status", level: 2 },
];

export default function SecurityPage() {
  return (
    <div className="flex gap-10">
      <div className="max-w-4xl mx-auto px-8 py-16 lg:py-20 min-w-0 flex-1">
        <div className="text-[12px] text-slate-500 font-medium mb-8">
          Docs <span className="mx-1.5 text-slate-700">/</span> Security Model
        </div>

        <h1 className="text-4xl font-extrabold text-white tracking-tight mb-4">
          Security Model
        </h1>
        <p className="text-lg text-slate-400 leading-relaxed mb-12 max-w-2xl">
          Holdfast&apos;s security model is built on the assumption that the user&apos;s machine
          is fully compromised. The only trust anchor is the hardware security key.
        </p>

        {/* Threat Model */}
        <section>
          <h2 id="threat-model" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Threat Model
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            We assume the attacker has:
          </p>
          <div className="space-y-2 mb-6">
            {[
              "Full control of the user's browser and operating system",
              "Ability to read all memory, intercept all network traffic",
              "Access to the relayer private key",
              "Knowledge of the vault address and all public parameters",
              "Ability to submit arbitrary Solana transactions",
            ].map((item) => (
              <div key={item} className="flex items-start gap-2.5 text-sm text-slate-400">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0" />
                {item}
              </div>
            ))}
          </div>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The attacker CANNOT:
          </p>
          <div className="space-y-2 mb-6">
            {[
              "Extract the private key from the FIDO2 hardware enclave",
              "Forge a secp256r1 signature without the physical key",
              "Bypass the hardware key's user verification (PIN/biometric)",
              "Modify the Solana runtime or SIMD-48 precompile behavior",
            ].map((item) => (
              <div key={item} className="flex items-start gap-2.5 text-sm text-slate-400">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                {item}
              </div>
            ))}
          </div>
          <Callout type="info" title="Security guarantee">
            <p>
              Under this threat model, the attacker cannot authorize any vault operation.
              They cannot move funds, change the whitelist, modify velocity limits, or
              enroll a backup key. The hardware key is the sole authorization factor.
            </p>
          </Callout>
        </section>

        {/* Anti-Phishing */}
        <section className="mt-14">
          <h2 id="anti-phishing" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Anti-Phishing (C-SOL-1)
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            WebAuthn embeds the page origin into <code className="text-emerald-400">clientDataJSON</code>,
            which the hardware key cryptographically signs. The program verifies this origin
            against a hardcoded allowlist.
          </p>
          <CodeBlock
            code={`// On-chain origin validation:
const ALLOWED_ORIGINS: &[&[u8]] = &[
    b"https://holdfastprotocol.com",
    b"https://www.holdfastprotocol.com",
];

// The origin list is HARDCODED, not in mutable config.
// This is deliberate: if origins were in ProtocolConfig,
// a compromised authority could redirect users to a
// phishing site by changing the allowed origin list.

// A signature from "https://evil-clone.com" will contain
// that origin in clientDataJSON. The hardware key signed
// it. But our program will reject it because "evil-clone.com"
// is not in ALLOWED_ORIGINS. The attacker gets a valid
// signature over the wrong origin — useless.`}
            language="rust"
            filename="anti_phishing.rs"
            showLineNumbers
          />
        </section>

        {/* Replay Protection */}
        <section className="mt-14">
          <h2 id="replay-protection" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Replay Protection
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Every signed operation includes a per-vault monotonic nonce in the intent hash.
            The nonce advances on every successful operation, invalidating all prior assertions.
          </p>
          <CodeBlock
            code={`// Intent hash construction (withdraw example):
intent = hash(
  "withdraw"           // operation type
  || vault_address     // 32 bytes
  || destination       // 32 bytes
  || amount            // 8 bytes (u64 LE)
  || nonce             // 8 bytes (u64 LE) ← advances each operation
)

// The challenge in clientDataJSON must equal base64url(intent).
// After the operation succeeds, nonce increments to nonce+1.
// Any assertion with the old nonce is permanently invalid.`}
            language="text"
            filename="replay_protection.txt"
          />
        </section>

        {/* CPI Rejection */}
        <section className="mt-14">
          <h2 id="cpi-rejection" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            CPI Rejection (M-SOL-6)
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The vault program verifies that it is being invoked as a top-level instruction,
            not via Cross-Program Invocation. This prevents a critical attack class:
          </p>
          <Callout type="danger" title="The CPI attack">
            <p>
              Without this check, a malicious program could craft a transaction where:
              instruction 0 is a legitimate precompile verification, instruction 1 is
              the malicious program, and instruction 1 calls our vault via CPI. Our program
              would read instruction 0 (the precompile) and believe the signature is valid --
              but the precompile verified a completely different operation than what&apos;s being executed.
            </p>
          </Callout>
          <CodeBlock
            code={`// M-SOL-6: Direct invocation enforcement
let current_ix = load_instruction_at_checked(
    current_idx as usize, &instructions_sysvar,
)?;
require!(
    current_ix.program_id == crate::ID,
    HardlineError::DirectInvocationRequired
);`}
            language="rust"
            filename="cpi_check.rs"
          />
        </section>

        {/* Instruction Validation */}
        <section className="mt-14">
          <h2 id="instruction-validation" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Instruction Index Validation (H-2)
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The program validates that all three data offsets in the precompile instruction
            (signature, public key, message) reference the same instruction (<code className="text-emerald-400">0xFFFF</code>).
            Without this, the precompile could verify a signature against data in one
            instruction while we read different data from a different instruction.
          </p>
          <CodeBlock
            code={`// H-2 fix: validate ALL three instruction indices
let sig_ix_index    = u16::from_le_bytes([data[4], data[5]]);
let pubkey_ix_index = u16::from_le_bytes([data[8], data[9]]);
let message_ix_index = u16::from_le_bytes([data[14], data[15]]);

require!(sig_ix_index    == u16::MAX, HardlineError::InvalidSignatureData);
require!(pubkey_ix_index == u16::MAX, HardlineError::InvalidSignatureData);
require!(message_ix_index == u16::MAX, HardlineError::InvalidSignatureData);`}
            language="rust"
            filename="ix_validation.rs"
            showLineNumbers
          />
        </section>

        {/* Signature Canonicity */}
        <section className="mt-14">
          <h2 id="signature-canonicity" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Signature Canonicity
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            All secp256r1 signatures are normalized to low-S form on both the client (TypeScript)
            and contract (Solidity) sides. For any ECDSA signature <code className="text-emerald-400">(r, s)</code>, if{" "}
            <code className="text-emerald-400">s &gt; n/2</code>, we replace{" "}
            <code className="text-emerald-400">s</code> with <code className="text-emerald-400">n - s</code>.
            This prevents signature malleability attacks where an attacker creates an alternative
            valid signature from an existing one.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            DER encoding is validated for canonicity (H-5): leading zero bytes are only
            accepted when the high bit of the next byte is set (negative number representation
            in ASN.1). Non-canonical leading zeros are rejected.
          </p>
        </section>

        {/* Velocity Defense */}
        <section className="mt-14">
          <h2 id="velocity-defense" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Velocity Defense (M-SOL-5)
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The burst cooldown mechanism prevents the window-boundary attack. Even if an
            attacker obtains a valid signature (e.g., through physical coercion), the velocity
            system limits the damage:
          </p>
          <div className="grid sm:grid-cols-2 gap-3 my-6">
            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
              <div className="text-sm font-semibold text-white mb-1">Without burst cooldown</div>
              <p className="text-[12px] text-slate-500">
                Attacker drains 5 SOL at 23:59, window resets at 00:00,
                drains another 5 SOL at 00:01 = 10 SOL in 2 minutes.
              </p>
            </div>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="text-sm font-semibold text-emerald-400 mb-1">With burst cooldown</div>
              <p className="text-[12px] text-slate-500">
                First 2.5 SOL triggers 12h cooldown. Even after window reset,
                no withdrawals until cooldown expires. Max damage: 2.5 SOL.
              </p>
            </div>
          </div>
        </section>

        {/* Key Compromise */}
        <section className="mt-14">
          <h2 id="key-compromise" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Key Compromise Scenarios
          </h2>
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-5">
              <h4 className="text-sm font-bold text-white mb-2">Relayer key compromised</h4>
              <p className="text-[13px] text-slate-400 leading-relaxed">
                <strong className="text-amber-400">Impact: Negligible.</strong> The attacker can waste SOL on
                transaction fees. They cannot authorize any vault operation. Rotate the relayer
                key and refund the SOL.
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-5">
              <h4 className="text-sm font-bold text-white mb-2">Machine fully compromised</h4>
              <p className="text-[13px] text-slate-400 leading-relaxed">
                <strong className="text-amber-400">Impact: None.</strong> The attacker can see the credential
                ID and public key, but cannot extract the private key from the hardware enclave.
                They cannot forge signatures. WebAuthn user verification (PIN) is handled by the
                hardware key, not the OS.
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-5">
              <h4 className="text-sm font-bold text-white mb-2">Hardware key stolen (with PIN)</h4>
              <p className="text-[13px] text-slate-400 leading-relaxed">
                <strong className="text-rose-400">Impact: Significant, but bounded.</strong> The attacker
                can authorize operations, but only to whitelisted addresses and within velocity
                limits. Default-deny whitelist means they cannot drain to their own address
                without first whitelisting it (which the owner would see). Velocity limits
                cap the damage rate.
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-5">
              <h4 className="text-sm font-bold text-white mb-2">Hardware key lost</h4>
              <p className="text-[13px] text-slate-400 leading-relaxed">
                <strong className="text-amber-400">Impact: Recoverable.</strong> If a backup key is enrolled,
                use it to operate the vault normally. If no backup exists, the inheritance
                mechanism (dead man&apos;s switch) will eventually release funds to designated
                beneficiaries after the inactivity window (minimum 90 days).
              </p>
            </div>
          </div>
        </section>

        {/* Audit Status */}
        <section className="mt-14">
          <h2 id="audit-status" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
            Audit Status
          </h2>
          <Callout type="warning" title="Pre-audit disclosure">
            <p>
              The Holdfast protocol is currently pre-formal-audit. The security measures
              documented here are the result of internal security review and threat modeling.
              A formal third-party audit is planned before mainnet launch. Use on devnet
              and testnet only until the audit is complete.
            </p>
          </Callout>
          <p className="text-sm text-slate-400 leading-relaxed mt-4">
            The codebase includes internal security labels (C-SOL-1, H-2, H-4, H-5, L-SOL-4,
            M-3, M-SOL-1, M-SOL-5, M-SOL-6) tracking specific hardening fixes. These labels
            reference the internal security review checklist and are preserved in code comments
            for audit traceability.
          </p>
        </section>

        <PrevNext
          prev={{ href: "/docs/architecture", title: "Architecture" }}
        />
      </div>
      <OnThisPage headings={headings} />
    </div>
  );
}
