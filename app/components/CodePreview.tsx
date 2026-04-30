"use client";

import { useState } from "react";
import { Copy, CheckCircle2 } from "lucide-react";

const codeSnippet = `import { createHoldfastClient, registerAgentWallet } from '@holdfastprotocol/sdk';
import { Connection, Keypair } from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const signer = Keypair.fromSecretKey(/* ... */);

// 1. Register the agent wallet PDA (idempotent on repeat runs)
const { agentWallet } = await registerAgentWallet({ connection, signer });

// 2. Initialize the SDK client for devnet
const client = createHoldfastClient({ connection, signer, agentWallet });

// 3. Pre-flight reputation requirements before creating a pact
const counterparty = Keypair.generate().publicKey;
const isQualified = await client.reputation.meetsRequirements(counterparty, {
  minScore: 5000,
  minPacts: 3,
});

if (!isQualified) throw new Error('Counterparty does not meet requirements');`;

export default function CodePreview() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(codeSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-1000 group-hover:duration-200" />
      <div className="relative rounded-2xl bg-[#0d1117] border border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-[#161b22]">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-rose-500/80" />
            <div className="w-3 h-3 rounded-full bg-amber-500/80" />
            <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
          </div>
          <div className="text-xs text-slate-500 font-mono">
            agent_commerce.ts
          </div>
          <button
            onClick={handleCopy}
            className="text-slate-500 hover:text-white transition-colors"
            aria-label={copied ? "Copied" : "Copy code"}
          >
            {copied ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
        </div>
        <div className="p-6 overflow-x-auto text-sm font-mono leading-relaxed">
          <pre>
            <code className="text-slate-300">
              <span className="text-purple-400">import</span>{" "}
              {"{ createHoldfastClient, registerAgentWallet }"}{" "}
              <span className="text-purple-400">from</span>{" "}
              <span className="text-emerald-300">
                &apos;@holdfastprotocol/sdk&apos;
              </span>
              ;{"\n"}
              <span className="text-purple-400">import</span>{" "}
              {"{ Connection, Keypair }"} <span className="text-purple-400">from</span>{" "}
              <span className="text-emerald-300">&apos;@solana/web3.js&apos;</span>;
              {"\n\n"}
              <span className="text-slate-500">
                {"// 1. Register the agent wallet PDA (idempotent on repeat runs)"}
              </span>
              {"\n"}
              <span className="text-purple-400">const</span> connection ={" "}
              <span className="text-purple-400">new</span>{" "}
              <span className="text-amber-300">Connection</span>(
              <span className="text-emerald-300">
                &apos;https://api.devnet.solana.com&apos;
              </span>
              , <span className="text-emerald-300">&apos;confirmed&apos;</span>);
              {"\n"}
              <span className="text-purple-400">const</span> signer = Keypair.
              <span className="text-cyan-400">fromSecretKey</span>(
              <span className="text-slate-500">/* ... */</span>);{"\n"}
              <span className="text-purple-400">const</span> {"{ agentWallet }"} ={" "}
              <span className="text-purple-400">await</span>{" "}
              <span className="text-cyan-400">registerAgentWallet</span>({"{"}
              connection, signer{"}"});{"\n\n"}
              <span className="text-slate-500">
                {"// 2. Initialize the SDK client for devnet"}
              </span>
              {"\n"}
              <span className="text-purple-400">const</span> client ={" "}
              <span className="text-cyan-400">createHoldfastClient</span>({"{"}
              connection, signer, agentWallet{"}"});{"\n\n"}
              <span className="text-slate-500">
                {"// 3. Pre-flight reputation requirements before creating a pact"}
              </span>
              {"\n"}
              <span className="text-purple-400">const</span> counterparty = Keypair.
              <span className="text-cyan-400">generate</span>().publicKey;{"\n"}
              <span className="text-purple-400">const</span> isQualified ={" "}
              <span className="text-purple-400">await</span> client.reputation.
              <span className="text-cyan-400">meetsRequirements</span>(
              counterparty, {"{"}{"\n"}
              {"  "}minScore: <span className="text-amber-400">5000</span>,{"\n"}
              {"  "}minPacts: <span className="text-amber-400">3</span>,{"\n"}
              {"}"});{"\n\n"}
              <span className="text-purple-400">if</span> (!isQualified){" "}
              <span className="text-purple-400">throw new</span>{" "}
              <span className="text-amber-300">Error</span>(
              <span className="text-emerald-300">
                &apos;Counterparty does not meet requirements&apos;
              </span>
              );
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}
