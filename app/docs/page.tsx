import { Shield, Handshake, Activity, ArrowRight, Zap } from "lucide-react";
import Link from "next/link";
import Callout from "./components/Callout";
import PrevNext from "./components/PrevNext";

export const metadata = { title: "Introduction" };

export default function DocsIntroduction() {
  return (
    <div className="max-w-4xl mx-auto px-8 py-16 lg:py-20">
      {/* Breadcrumb */}
      <div className="text-[12px] text-slate-500 font-medium mb-8">
        Docs <span className="mx-1.5 text-slate-700">/</span> Introduction
      </div>

      {/* Title */}
      <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight mb-4">
        Holdfast Documentation
      </h1>
      <p className="text-lg text-slate-400 leading-relaxed mb-10 max-w-2xl">
        Trust infrastructure for autonomous AI agents on Solana. On-chain
        identity, reputation, and programmable escrow — everything agents need
        to form verifiable pacts and build trust at scale.
      </p>

      <Callout type="tip" title="New to Holdfast?">
        <p>
          Start with the <a href="/docs/quickstart" className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">Quick Start guide</a> to
          deploy a hardware-attested agent wallet in under 5 minutes.
        </p>
      </Callout>

      {/* What is Holdfast */}
      <section className="mt-14">
        <h2 id="what-is-holdfast" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
          What is Holdfast?
        </h2>
        <p className="text-slate-400 leading-relaxed mb-4">
          As AI agents evolve from read-only assistants into autonomous economic actors holding
          real capital, the infrastructure to support them is missing. Agent developers are
          forced to build custom, highly vulnerable software wallets. Agents have no standard way
          to establish trust, route payments, or enter into reliable contracts with one another.
        </p>
        <p className="text-slate-400 leading-relaxed mb-4">
          Holdfast solves this. Built on top of battle-tested secp256r1/FIDO2 cryptographic
          primitives, the protocol delivers a three-layer stack that any agent framework can
          plug into:
        </p>
      </section>

      {/* Architecture Diagram (CSS) */}
      <section className="my-12">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-8">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-8 text-center">
            Protocol Architecture
          </h3>
          <div className="space-y-3">
            {/* Layer 3 */}
            <div className="relative rounded-xl border border-purple-500/30 bg-purple-500/5 p-5">
              <div className="flex items-center gap-3 mb-2">
                <Activity className="w-5 h-5 text-purple-400" />
                <h4 className="text-sm font-bold text-purple-400">Layer 3: Trust</h4>
                <span className="text-[10px] bg-purple-500/15 text-purple-400 px-2 py-0.5 rounded-full ml-auto">
                  Reputation & Credit
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                On-chain credit scores, solvency proofs, transaction history indexing.
                Query any agent&apos;s reliability before entering a contract.
              </p>
            </div>
            {/* Layer 2 */}
            <div className="relative rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-5">
              <div className="flex items-center gap-3 mb-2">
                <Handshake className="w-5 h-5 text-cyan-400" />
                <h4 className="text-sm font-bold text-cyan-400">Layer 2: Pact</h4>
                <span className="text-[10px] bg-cyan-500/15 text-cyan-400 px-2 py-0.5 rounded-full ml-auto">
                  Escrow & Settlement
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Programmable escrow with cryptographic proof-of-completion.
                Micro-transactions, automated dispute arbitration, cross-chain routing.
              </p>
            </div>
            {/* Layer 1 */}
            <div className="relative rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
              <div className="flex items-center gap-3 mb-2">
                <Shield className="w-5 h-5 text-emerald-400" />
                <h4 className="text-sm font-bold text-emerald-400">Layer 1: Vault</h4>
                <span className="text-[10px] bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full ml-auto">
                  Hardware-Attested Custody
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                secp256r1/FIDO2 hardware-bound wallets. Private keys live in tamper-resistant
                enclaves. No seed phrases, no software key extraction.
              </p>
            </div>
            {/* Foundation */}
            <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-4 text-center">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
                Solana Runtime + SIMD-48 secp256r1 Precompile
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Three Problems */}
      <section className="mt-14">
        <h2 id="the-problem" className="text-2xl font-bold text-white mb-6 scroll-mt-24">
          The Problem
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
            <div className="text-sm font-bold text-white mb-2">Custody Vulnerability</div>
            <p className="text-[13px] text-slate-500 leading-relaxed">
              Autonomous agents hold five-to-six figures in capital using vulnerable,
              software-only private keys. A single compromised server drains everything.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
            <div className="text-sm font-bold text-white mb-2">Zero-Trust Gap</div>
            <p className="text-[13px] text-slate-500 leading-relaxed">
              Agents cannot pass traditional KYC. Without decentralized reputation,
              an agent cannot verify the solvency of another agent before transacting.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
            <div className="text-sm font-bold text-white mb-2">Settlement Gap</div>
            <p className="text-[13px] text-slate-500 leading-relaxed">
              There is no standard framework for agent-to-agent escrow.
              No programmable contract enforces delivery-versus-payment.
            </p>
          </div>
        </div>
      </section>

      {/* Quick links */}
      <section className="mt-14">
        <h2 id="explore" className="text-2xl font-bold text-white mb-6 scroll-mt-24">
          Explore the Docs
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            {
              href: "/docs/quickstart",
              icon: <Zap className="w-5 h-5 text-amber-400" />,
              title: "Quick Start",
              desc: "Deploy a hardware-attested agent wallet in under 5 minutes.",
              accent: "group-hover:border-amber-500/30",
            },
            {
              href: "/docs/concepts/vault",
              icon: <Shield className="w-5 h-5 text-emerald-400" />,
              title: "Vault Concepts",
              desc: "Understand secp256r1 attestation, PDA derivation, and the relayer model.",
              accent: "group-hover:border-emerald-500/30",
            },
            {
              href: "/docs/api-reference",
              icon: <ArrowRight className="w-5 h-5 text-cyan-400" />,
              title: "API Reference",
              desc: "Full SDK method signatures, parameters, and code examples.",
              accent: "group-hover:border-cyan-500/30",
            },
            {
              href: "/docs/security",
              icon: <Shield className="w-5 h-5 text-purple-400" />,
              title: "Security Model",
              desc: "Threat model, anti-phishing, replay protection, and audit status.",
              accent: "group-hover:border-purple-500/30",
            },
          ].map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className={`group flex gap-4 p-5 rounded-xl border border-slate-800 hover:bg-slate-900/60 transition-all ${card.accent}`}
            >
              <div className="mt-0.5 flex-shrink-0">{card.icon}</div>
              <div>
                <div className="text-sm font-semibold text-white mb-1 group-hover:text-emerald-400 transition-colors">
                  {card.title}
                </div>
                <p className="text-[13px] text-slate-500 leading-relaxed">{card.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <PrevNext next={{ href: "/docs/quickstart", title: "Quick Start" }} />
    </div>
  );
}
