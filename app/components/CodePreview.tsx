"use client";

import { useState } from "react";
import { Copy, CheckCircle2 } from "lucide-react";

const codeSnippet = `import { Vault, Pact, Trust } from '@holdfastprotocol/sdk';

// 1. Initialize hardware-attested agent wallet
const agentVault = await Vault.attest({
  curve: 'secp256r1',
  enclave: true
});

// 2. Verify counterparty agent solvency & reputation
const targetScore = await Trust.queryScore('agent_b.sol');
if (targetScore.rating < 850) throw new Error('Unreliable Agent');

// 3. Create programmable escrow for task execution
const escrow = await Pact.create({
  funder: agentVault.address,
  executor: 'agent_b.sol',
  amount: 5000,
  token: 'USDC',
  releaseCondition: 'cryptographic_proof_provided'
});

await escrow.execute();`;

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
              {"{ Vault, Pact, Trust }"}{" "}
              <span className="text-purple-400">from</span>{" "}
              <span className="text-emerald-300">
                &apos;@holdfastprotocol/sdk&apos;
              </span>
              ;{"\n\n"}
              <span className="text-slate-500">
                {"// 1. Initialize hardware-attested agent wallet"}
              </span>
              {"\n"}
              <span className="text-purple-400">const</span> agentVault ={" "}
              <span className="text-purple-400">await</span> Vault.
              <span className="text-cyan-400">attest</span>({"{"}{"\n"}
              {"  "}curve:{" "}
              <span className="text-emerald-300">&apos;secp256r1&apos;</span>,
              {"\n"}
              {"  "}enclave: <span className="text-amber-400">true</span>
              {"\n"}
              {"}"});{"\n\n"}
              <span className="text-slate-500">
                {"// 2. Verify counterparty agent solvency & reputation"}
              </span>
              {"\n"}
              <span className="text-purple-400">const</span> targetScore ={" "}
              <span className="text-purple-400">await</span> Trust.
              <span className="text-cyan-400">queryScore</span>(
              <span className="text-emerald-300">
                &apos;agent_b.sol&apos;
              </span>
              );{"\n"}
              <span className="text-purple-400">if</span> (targetScore.rating{" "}
              {"<"} <span className="text-amber-400">850</span>){" "}
              <span className="text-purple-400">throw new</span>{" "}
              <span className="text-amber-300">Error</span>(
              <span className="text-emerald-300">
                &apos;Unreliable Agent&apos;
              </span>
              );{"\n\n"}
              <span className="text-slate-500">
                {"// 3. Create programmable escrow for task execution"}
              </span>
              {"\n"}
              <span className="text-purple-400">const</span> escrow ={" "}
              <span className="text-purple-400">await</span> Pact.
              <span className="text-cyan-400">create</span>({"{"}{"\n"}
              {"  "}funder: agentVault.address,{"\n"}
              {"  "}executor:{" "}
              <span className="text-emerald-300">
                &apos;agent_b.sol&apos;
              </span>
              ,{"\n"}
              {"  "}amount: <span className="text-amber-400">5000</span>,
              {"\n"}
              {"  "}token:{" "}
              <span className="text-emerald-300">&apos;USDC&apos;</span>,{"\n"}
              {"  "}releaseCondition:{" "}
              <span className="text-emerald-300">
                &apos;cryptographic_proof_provided&apos;
              </span>
              {"\n"}
              {"}"});{"\n\n"}
              <span className="text-purple-400">await</span> escrow.
              <span className="text-cyan-400">execute</span>();
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}
