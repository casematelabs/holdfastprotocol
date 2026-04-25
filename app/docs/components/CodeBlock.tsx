"use client";

import { useState } from "react";
import { Copy, CheckCircle2 } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
}

export default function CodeBlock({
  code,
  language = "typescript",
  filename,
  showLineNumbers = false,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = code.split("\n");

  return (
    <div className="relative group my-4 rounded-xl border border-slate-800 bg-[#0d1117] overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/80 bg-[#161b22]">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
            <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
            <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
          </div>
          {filename && (
            <span className="text-[11px] font-mono text-slate-500">{filename}</span>
          )}
          {!filename && language && (
            <span className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">
              {language}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code body */}
      <div className="overflow-x-auto">
        <pre className="p-4 text-[13px] leading-relaxed font-mono">
          <code>
            {lines.map((line, i) => (
              <div key={i} className="flex">
                {showLineNumbers && (
                  <span className="select-none w-8 flex-shrink-0 text-right pr-4 text-slate-600 text-[12px]">
                    {i + 1}
                  </span>
                )}
                <span className="text-slate-300 flex-1">{line}</span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
