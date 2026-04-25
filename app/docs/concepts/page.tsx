import { Shield, Handshake, Activity, ArrowRight } from "lucide-react";
import Link from "next/link";
import PrevNext from "../components/PrevNext";

export const metadata = { title: "Core Concepts" };

export default function ConceptsOverview() {
  return (
    <div className="max-w-4xl mx-auto px-8 py-16 lg:py-20">
      <div className="text-[12px] text-slate-500 font-medium mb-8">
        Docs <span className="mx-1.5 text-slate-700">/</span> Core Concepts
      </div>

      <h1 className="text-4xl font-extrabold text-white tracking-tight mb-4">
        Core Concepts
      </h1>
      <p className="text-lg text-slate-400 leading-relaxed mb-12 max-w-2xl">
        Holdfast is a three-layer protocol stack. Each layer is independent and composable --
        you can use Vault custody without Pact escrow, or query Trust scores without holding a vault.
        Together, they form a complete trust infrastructure.
      </p>

      <div className="space-y-6">
        {/* Vault */}
        <Link
          href="/docs/concepts/vault"
          className="group block rounded-2xl border border-slate-800 hover:border-emerald-500/30 bg-slate-900/30 hover:bg-slate-900/50 p-8 transition-all"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Shield className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white group-hover:text-emerald-400 transition-colors">
                  Layer 1: Vault
                </h2>
                <span className="text-xs text-slate-500">Hardware-Attested Custody</span>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-600 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all" />
          </div>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            The foundation of the protocol. Vault extends secp256r1/FIDO2 hardware attestation
            to autonomous agent wallets on Solana. Private keys never leave the hardware enclave.
            Every financial operation requires a physical cryptographic proof.
          </p>
          <div className="flex flex-wrap gap-2">
            {["secp256r1", "FIDO2/WebAuthn", "SIMD-48 Precompile", "PDA Derivation", "Velocity Limits", "Default-Deny Whitelist"].map((tag) => (
              <span key={tag} className="text-[11px] bg-slate-800/80 text-slate-400 px-2 py-1 rounded">
                {tag}
              </span>
            ))}
          </div>
        </Link>

        {/* Pact */}
        <Link
          href="/docs/concepts/pact"
          className="group block rounded-2xl border border-slate-800 hover:border-cyan-500/30 bg-slate-900/30 hover:bg-slate-900/50 p-8 transition-all"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                <Handshake className="w-6 h-6 text-cyan-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white group-hover:text-cyan-400 transition-colors">
                  Layer 2: Pact
                </h2>
                <span className="text-xs text-slate-500">Programmable Escrow & Settlement</span>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-600 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all" />
          </div>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            Smart contract escrow built for API and agent interactions. Funds lock via API call
            and release upon cryptographic proof of task completion. Supports micro-transactions
            down to fractions of a cent and includes automated dispute arbitration.
          </p>
          <div className="flex flex-wrap gap-2">
            {["API-First Escrow", "Proof-of-Completion", "Micro-Transactions", "Dispute Arbitration", "Cross-Chain"].map((tag) => (
              <span key={tag} className="text-[11px] bg-slate-800/80 text-slate-400 px-2 py-1 rounded">
                {tag}
              </span>
            ))}
          </div>
        </Link>

        {/* Trust */}
        <Link
          href="/docs/concepts/trust"
          className="group block rounded-2xl border border-slate-800 hover:border-purple-500/30 bg-slate-900/30 hover:bg-slate-900/50 p-8 transition-all"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Activity className="w-6 h-6 text-purple-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white group-hover:text-purple-400 transition-colors">
                  Layer 3: Trust
                </h2>
                <span className="text-xs text-slate-500">Agent Reputation & Credit</span>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-600 group-hover:text-purple-400 group-hover:translate-x-1 transition-all" />
          </div>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            A publicly queryable, on-chain credit score for autonomous wallets. Tracks
            transaction history, uptime, escrow success rate, and dispute outcomes. Enables
            agents to verify solvency and reliability before entering contracts.
          </p>
          <div className="flex flex-wrap gap-2">
            {["On-Chain Credit Score", "Solvency Proofs", "Escrow History", "Dispute Tracking", "Real-Time Indexing"].map((tag) => (
              <span key={tag} className="text-[11px] bg-slate-800/80 text-slate-400 px-2 py-1 rounded">
                {tag}
              </span>
            ))}
          </div>
        </Link>
      </div>

      <PrevNext
        prev={{ href: "/docs/quickstart", title: "Quick Start" }}
        next={{ href: "/docs/concepts/vault", title: "Vault (Custody)" }}
      />
    </div>
  );
}
