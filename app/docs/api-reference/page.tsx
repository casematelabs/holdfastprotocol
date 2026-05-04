import CodeBlock from "../components/CodeBlock";
import Callout from "../components/Callout";
import PrevNext from "../components/PrevNext";

export const metadata = { title: "API Reference" };

export default function ApiReference() {
  return (
    <div className="max-w-4xl mx-auto px-8 py-16 lg:py-20">
      <div className="text-[12px] text-slate-500 font-medium mb-8">
        Docs <span className="mx-1.5 text-slate-700">/</span> API Reference
      </div>

      <h1 className="text-4xl font-extrabold text-white tracking-tight mb-4">
        API Reference
      </h1>
      <p className="text-lg text-slate-400 leading-relaxed mb-10 max-w-2xl">
        Holdfast ships a single TypeScript SDK,{" "}
        <code className="text-emerald-400">@holdfastprotocol/sdk</code>, exposing
        three modules: <code className="text-emerald-400">registration</code>,{" "}
        <code className="text-emerald-400">reputation</code>, and{" "}
        <code className="text-emerald-400">escrow</code>. The full method-by-method
        reference lives in the SDK's own README on the canonical public mirror.
      </p>

      <Callout type="warning" title="Devnet only — pre-audit">
        <p>
          The on-chain programs have not yet undergone a third-party security audit.
          Pin to the <code>@devnet</code> dist-tag and do not use against mainnet.
        </p>
      </Callout>

      {/* Install */}
      <section className="mt-12">
        <h2 id="install" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
          Install
        </h2>
        <CodeBlock
          code={`npm install @holdfastprotocol/sdk@devnet @solana/web3.js`}
          language="bash"
          filename="terminal"
        />
        <CodeBlock
          code={`import {
  createHoldfastClient,
  registerAgentWallet,
  VerifTier,
  EscrowStatus,
} from "@holdfastprotocol/sdk";`}
          language="typescript"
          filename="import.ts"
        />
      </section>

      {/* The three surfaces */}
      <section className="mt-12">
        <h2 id="surfaces" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
          The three surfaces
        </h2>
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
            <div className="text-sm font-semibold text-emerald-400 mb-1">
              registration
            </div>
            <p className="text-sm text-slate-400 leading-relaxed mb-2">
              <code>registerAgentWallet()</code>,{" "}
              <code>deriveAgentWalletPda()</code>. One-time agent identity
              registration via the SIMD-48 secp256r1 precompile pairing.
              Idempotent — re-running with the same P-256 key resolves to the
              same <code>AgentWallet</code> PDA without sending a transaction.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
            <div className="text-sm font-semibold text-emerald-400 mb-1">
              client.reputation
            </div>
            <p className="text-sm text-slate-400 leading-relaxed mb-2">
              <code>get(pubkey)</code>, <code>meetsRequirements(pubkey, reqs)</code>,{" "}
              <code>getHistory(pubkey, opts?)</code>. Direct{" "}
              <code>ReputationAccount</code> PDA reads (no indexer in the
              trust path) plus paginated history pulled from the off-chain
              indexer for dashboard use.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-5">
            <div className="text-sm font-semibold text-emerald-400 mb-1">
              client.escrow
            </div>
            <p className="text-sm text-slate-400 leading-relaxed mb-2">
              <code>createPact()</code>, <code>depositEscrow()</code>,{" "}
              <code>stakeBeneficiary()</code>, <code>lockEscrow()</code>,{" "}
              <code>releasePact()</code>, <code>claimReleased()</code>,{" "}
              <code>openDispute()</code>, <code>getPact()</code>,{" "}
              <code>listPacts()</code>, <code>getEscrowEvents()</code>.
              The full pact lifecycle, including the canonical task /
              milestone / timed release conditions and on-chain dispute path.
            </p>
          </div>
        </div>
      </section>

      {/* Canonical reference links */}
      <section className="mt-12">
        <h2 id="canonical-references" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
          Canonical references
        </h2>
        <p className="text-sm text-slate-400 leading-relaxed mb-4">
          Maintaining a method-by-method reference in two places is a drift trap.
          The canonical reference is in the public SDK repo and ships with every
          npm release. These links point to source-of-truth.
        </p>
        <div className="space-y-3">
          {[
            {
              title: "SDK README",
              href: "https://github.com/casematelabs/holdfastprotocol-sdk#readme",
              desc: "Complete method signatures, parameters, return types, and code examples for every public symbol. Versioned with the package.",
            },
            {
              title: "Quickstart (in the SDK repo)",
              href: "https://github.com/casematelabs/holdfastprotocol-sdk/blob/master/docs/quickstart.md",
              desc: "Zero to first confirmed devnet pact in under 15 minutes — install, register, create, claim, end-to-end.",
            },
            {
              title: "Troubleshooting reference",
              href: "https://github.com/casematelabs/holdfastprotocol-sdk/blob/master/docs/troubleshooting.md",
              desc: "Anchor error code table for both programs, SDK exception class reference, common failure scenarios with recovery paths.",
            },
            {
              title: "Runnable quickstart script",
              href: "https://github.com/casematelabs/holdfastprotocol-sdk/blob/master/examples/quickstart.ts",
              desc: "Copy-paste end-to-end devnet script. Same flow the README walks through, runnable as-is with your devnet keypair.",
            },
            {
              title: "npm package",
              href: "https://www.npmjs.com/package/@holdfastprotocol/sdk",
              desc: "Package page on npm. Install via the @devnet dist-tag.",
            },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group block p-5 rounded-xl border border-slate-800 hover:border-emerald-500/30 hover:bg-slate-900/40 transition-all"
            >
              <div className="text-sm font-semibold text-white group-hover:text-emerald-400 transition-colors mb-1">
                {link.title} <span className="text-slate-600">↗</span>
              </div>
              <p className="text-[13px] text-slate-500 leading-relaxed">{link.desc}</p>
            </a>
          ))}
        </div>
      </section>

      {/* Why we don't ship a separate reference here */}
      <section className="mt-12">
        <h2 id="single-source" className="text-2xl font-bold text-white mb-4 scroll-mt-24">
          Why a single source
        </h2>
        <p className="text-sm text-slate-400 leading-relaxed mb-4">
          The previous version of this page split the API into three sub-pages
          ("Vault SDK", "Pact SDK", "Trust SDK") that duplicated the SDK README.
          Both versions had drifted apart. This page is a portal now: the SDK
          README on the public mirror is the single source of truth, and ships
          alongside the code that implements it.
        </p>
      </section>

      <PrevNext
        prev={{ href: "/docs/architecture", title: "Architecture" }}
        next={{ href: "/docs/security", title: "Security Model" }}
      />
    </div>
  );
}
