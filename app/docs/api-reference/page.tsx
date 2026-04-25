import { Shield, Handshake, Activity, ArrowRight } from "lucide-react";
import Link from "next/link";
import CodeBlock from "../components/CodeBlock";
import Callout from "../components/Callout";
import PrevNext from "../components/PrevNext";

export const metadata = { title: "API Reference" };

export default function ApiReferenceOverview() {
  return (
    <div className="max-w-4xl mx-auto px-8 py-16 lg:py-20">
      <div className="text-[12px] text-slate-500 font-medium mb-8">
        Docs <span className="mx-1.5 text-slate-700">/</span> API Reference
      </div>

      <h1 className="text-4xl font-extrabold text-white tracking-tight mb-4">
        API Reference
      </h1>
      <p className="text-lg text-slate-400 leading-relaxed mb-10 max-w-2xl">
        Complete SDK documentation for the Holdfast protocol. Every method, every
        parameter, every return type.
      </p>

      {/* Install */}
      <section className="mb-12">
        <h2 id="installation" className="text-xl font-bold text-white mb-4 scroll-mt-24">
          Installation
        </h2>
        <CodeBlock
          code={`npm install @holdfastprotocol/sdk @solana/web3.js`}
          language="bash"
          filename="terminal"
        />
        <CodeBlock
          code={`import { Vault, Pact, Trust, HoldfastClient } from '@holdfastprotocol/sdk';`}
          language="typescript"
          filename="import.ts"
        />
      </section>

      {/* Client init */}
      <section className="mb-12">
        <h2 id="client" className="text-xl font-bold text-white mb-4 scroll-mt-24">
          Client Initialization
        </h2>
        <CodeBlock
          code={`import { HoldfastClient } from '@holdfastprotocol/sdk';
import { Connection, Keypair } from '@solana/web3.js';

const client = new HoldfastClient({
  connection: new Connection('https://api.mainnet-beta.solana.com'),
  relayer: Keypair.fromSecretKey(/* ... */),
  programId: 'AstnmfuJJoMqNXZCX1pvZRYMZKeJK1Lk4DRfnMsFWUht', // optional, defaults to mainnet
});`}
          language="typescript"
          filename="client.ts"
          showLineNumbers
        />
        <Callout type="info">
          <p>
            The <code className="text-emerald-400">programId</code> defaults to the mainnet
            deployment. Override it when testing against devnet or a local validator.
          </p>
        </Callout>
      </section>

      {/* Method badges legend */}
      <section className="mb-12">
        <h2 id="method-types" className="text-xl font-bold text-white mb-4 scroll-mt-24">
          Method Types
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-4 flex items-start gap-3">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border bg-blue-500/15 text-blue-400 border-blue-500/30">
              read
            </span>
            <p className="text-[13px] text-slate-400">
              Read-only queries. No signature required, no transaction cost.
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-4 flex items-start gap-3">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
              write
            </span>
            <p className="text-[13px] text-slate-400">
              State-changing operations. Requires relayer fee. No hardware signature.
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-4 flex items-start gap-3">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border bg-purple-500/15 text-purple-400 border-purple-500/30">
              sign
            </span>
            <p className="text-[13px] text-slate-400">
              Requires secp256r1 hardware key signature. Triggers WebAuthn prompt.
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-4 flex items-start gap-3">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border bg-cyan-500/15 text-cyan-400 border-cyan-500/30">
              query
            </span>
            <p className="text-[13px] text-slate-400">
              Off-chain indexed data. Reads from the Trust indexer, not the chain directly.
            </p>
          </div>
        </div>
      </section>

      {/* SDK modules */}
      <section>
        <h2 id="modules" className="text-xl font-bold text-white mb-6 scroll-mt-24">
          SDK Modules
        </h2>
        <div className="space-y-4">
          {[
            {
              href: "/docs/api-reference/vault",
              icon: <Shield className="w-5 h-5 text-emerald-400" />,
              title: "Vault SDK",
              desc: "Wallet attestation, deposits, withdrawals, whitelist management, velocity configuration, backup key enrollment.",
              methods: 12,
              color: "group-hover:border-emerald-500/30",
            },
            {
              href: "/docs/api-reference/pact",
              icon: <Handshake className="w-5 h-5 text-cyan-400" />,
              title: "Pact SDK",
              desc: "Escrow creation, proof submission, dispute arbitration, payment channels, cross-chain settlement.",
              methods: 9,
              color: "group-hover:border-cyan-500/30",
            },
            {
              href: "/docs/api-reference/trust",
              icon: <Activity className="w-5 h-5 text-purple-400" />,
              title: "Trust SDK",
              desc: "Score queries, solvency verification, history retrieval, reputation monitoring.",
              methods: 6,
              color: "group-hover:border-purple-500/30",
            },
          ].map((mod) => (
            <Link
              key={mod.href}
              href={mod.href}
              className={`group flex items-center justify-between p-5 rounded-xl border border-slate-800 hover:bg-slate-900/60 transition-all ${mod.color}`}
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-slate-800/50 flex items-center justify-center">
                  {mod.icon}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white group-hover:text-emerald-400 transition-colors">
                    {mod.title}
                  </h3>
                  <p className="text-[12px] text-slate-500 mt-0.5 max-w-md">{mod.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-slate-600 font-mono">{mod.methods} methods</span>
                <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-emerald-400 transition-colors" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <PrevNext
        prev={{ href: "/docs/concepts/trust", title: "Trust (Reputation)" }}
        next={{ href: "/docs/api-reference/vault", title: "Vault SDK" }}
      />
    </div>
  );
}
