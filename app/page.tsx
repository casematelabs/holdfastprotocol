import {
  Shield,
  Terminal,
  Activity,
  Handshake,
  ChevronRight,
  Code,
  Lock,
} from "lucide-react";
import Link from "next/link";
import CodePreview from "./components/CodePreview";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans selection:bg-emerald-500/30">
      {/* Navigation */}
      <nav className="fixed w-full border-b border-slate-800/50 bg-slate-950/80 backdrop-blur-md z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
              <Lock className="w-4 h-4 text-slate-950" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">
              HOLDFAST
            </span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium">
            <a
              href="#protocol"
              className="hover:text-emerald-400 transition-colors"
            >
              Protocol
            </a>
            <a
              href="#developers"
              className="hover:text-emerald-400 transition-colors"
            >
              Developers
            </a>
            <Link
              href="/docs"
              className="hover:text-emerald-400 transition-colors"
            >
              Documentation
            </Link>
            <Link
              href="/status"
              className="hover:text-emerald-400 transition-colors"
            >
              Network Status
            </Link>
          </div>
          <Link
            href="/onboarding"
            className="bg-slate-100 hover:bg-white text-slate-900 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-[0_0_15px_rgba(52,211,153,0.15)] hover:shadow-[0_0_25px_rgba(52,211,153,0.3)]"
          >
            Start Building
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6 relative overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-semibold tracking-wide uppercase mb-8">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Solana Devnet Live (Pre-Audit)
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold text-white tracking-tight leading-[1.1] mb-6">
            The Trust Infrastructure for the <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400 animate-gradient-x">
              Autonomous Agent Economy
            </span>
          </h1>

          <p className="text-lg md:text-xl text-slate-400 max-w-3xl mx-auto mb-10 leading-relaxed">
            Holdfast is trust infrastructure for autonomous AI agents on Solana.
            On-chain identity, reputation, and programmable escrow — everything
            agents need to form verifiable pacts and build trust at scale.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/onboarding"
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold flex items-center justify-center gap-2 transition-colors"
            >
              Get Started <ChevronRight className="w-4 h-4" />
            </Link>
            <Link
              href="/docs/quickstart"
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-white font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Terminal className="w-4 h-4" /> Quick Start
            </Link>
          </div>
        </div>
      </section>

      {/* Protocol Layers Section */}
      <section
        id="protocol"
        className="py-24 px-6 bg-slate-900/50 border-y border-slate-800/50"
      >
        <div className="max-w-7xl mx-auto">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold text-white mb-4">
              The Protocol Stack
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto">
              Three modular layers built on battle-tested cryptographic
              primitives, designed to close the zero-trust gap in agent-to-agent
              transactions.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Layer 1 */}
            <div className="bg-slate-950 border border-slate-800 p-8 rounded-2xl hover:border-emerald-500/30 transition-all group">
              <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Shield className="w-6 h-6 text-emerald-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                Layer 1: Vault{" "}
                <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">
                  Custody
                </span>
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed mb-4">
                Hardware-attested agent wallets. Extends secp256r1/FIDO2
                verification to autonomous agents, ensuring private keys
                executing financial decisions are cryptographically bound.
              </p>
              <ul className="space-y-2 text-sm text-slate-500">
                <li className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-emerald-500" />
                  Removes software wallet vulnerability
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-emerald-500" />
                  Hardware enclave signing
                </li>
              </ul>
            </div>

            {/* Layer 2 */}
            <div className="bg-slate-950 border border-slate-800 p-8 rounded-2xl hover:border-cyan-500/30 transition-all group">
              <div className="w-12 h-12 rounded-lg bg-cyan-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Handshake className="w-6 h-6 text-cyan-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                Layer 2: Pact{" "}
                <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">
                  Escrow
                </span>
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed mb-4">
                Programmable escrow for agent interactions. Funds are locked via
                API call and released upon cryptographic proof of task
                completion.
              </p>
              <ul className="space-y-2 text-sm text-slate-500">
                <li className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-cyan-500" />
                  x402-style microtransactions (planned)
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-cyan-500" />
                  Automated dispute arbitration
                </li>
              </ul>
            </div>

            {/* Layer 3 */}
            <div className="bg-slate-950 border border-slate-800 p-8 rounded-2xl hover:border-purple-500/30 transition-all group">
              <div className="w-12 h-12 rounded-lg bg-purple-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Activity className="w-6 h-6 text-purple-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                Layer 3: Trust{" "}
                <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">
                  Reputation
                </span>
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed mb-4">
                A publicly queryable, on-chain credit score for autonomous
                wallets. Rate the solvency and reliability of other agents
                before entering contracts.
              </p>
              <ul className="space-y-2 text-sm text-slate-500">
                <li className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-purple-500" />
                  Transaction history indexing
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-purple-500" />
                  Real-time solvency tracking
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Developer Section */}
      <section id="developers" className="py-24 px-6">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 text-emerald-400 font-semibold mb-4">
              <Code className="w-5 h-5" /> Built for Agent Developers
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
              Three lines of code to secure your agent&apos;s capital.
            </h2>
            <p className="text-slate-400 text-lg mb-8 leading-relaxed">
              We abstract away the complexities of cross-chain routing, smart
              contract deployment, and cryptographic attestation. Give your AI
              agent enterprise-grade financial rails with a single API.
            </p>

            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center flex-shrink-0">
                  <span className="text-slate-400 font-mono text-sm">01</span>
                </div>
                <div>
                  <h4 className="text-white font-semibold mb-1">
                    Import the SDK
                  </h4>
                  <p className="text-sm text-slate-500">
                    TypeScript SDK available now (Node.js 18+).
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center flex-shrink-0">
                  <span className="text-slate-400 font-mono text-sm">02</span>
                </div>
                <div>
                  <h4 className="text-white font-semibold mb-1">
                    Attest the Wallet
                  </h4>
                  <p className="text-sm text-slate-500">
                    Generate a hardware-bound secp256r1 keypair.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center flex-shrink-0">
                  <span className="text-slate-400 font-mono text-sm">03</span>
                </div>
                <div>
                  <h4 className="text-white font-semibold mb-1">
                    Deploy Capital
                  </h4>
                  <p className="text-sm text-slate-500">
                    Interact with other agents via Trust & Pact.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <CodePreview />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/50 bg-slate-950 py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 opacity-50">
            <Lock className="w-5 h-5 text-emerald-500" />
            <span className="font-bold tracking-tight text-white">
              HOLDFAST
            </span>
          </div>
          <div className="text-sm text-slate-500 text-center">
            <div>
              &copy; {new Date().getFullYear()} Holdfast Protocol. Built for the
              Autonomous Economy.
            </div>
            <div className="mt-1 text-slate-600">
              A <span className="text-slate-400">Casemate Labs</span> project
            </div>
          </div>
          <div className="flex gap-6 text-sm text-slate-500">
            <a
              href="#"
              className="hover:text-emerald-400 transition-colors"
            >
              Twitter
            </a>
            <a
              href="#"
              className="hover:text-emerald-400 transition-colors"
            >
              GitHub
            </a>
            <a
              href="#"
              className="hover:text-emerald-400 transition-colors"
            >
              Discord
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
