import CodeBlock from "./CodeBlock";

type MethodBadge = "read" | "write" | "sign" | "query";

const badgeStyles: Record<MethodBadge, string> = {
  read: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  write: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  sign: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  query: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
};

interface Param {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}

interface EndpointCardProps {
  method: MethodBadge;
  name: string;
  description: string;
  signature: string;
  params?: Param[];
  returns?: string;
  example?: string;
  exampleFilename?: string;
}

export default function EndpointCard({
  method,
  name,
  description,
  signature,
  params,
  returns,
  example,
  exampleFilename,
}: EndpointCardProps) {
  return (
    <div className="my-8 rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800/60 flex items-center gap-3">
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border ${badgeStyles[method]}`}
        >
          {method}
        </span>
        <code className="text-base font-mono font-semibold text-white">{name}</code>
      </div>

      <div className="px-6 py-5 space-y-5">
        {/* Description */}
        <p className="text-sm text-slate-400 leading-relaxed">{description}</p>

        {/* Signature */}
        <div>
          <h5 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
            Signature
          </h5>
          <div className="font-mono text-[13px] text-emerald-300 bg-slate-950 rounded-lg px-4 py-3 border border-slate-800/60 overflow-x-auto">
            {signature}
          </div>
        </div>

        {/* Parameters */}
        {params && params.length > 0 && (
          <div>
            <h5 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-3">
              Parameters
            </h5>
            <div className="border border-slate-800/60 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800/60 bg-slate-950/50">
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Name
                    </th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Type
                    </th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {params.map((p) => (
                    <tr key={p.name} className="border-b border-slate-800/30 last:border-0">
                      <td className="px-4 py-2.5 font-mono text-[13px]">
                        <span className="text-white">{p.name}</span>
                        {p.required && (
                          <span className="ml-1.5 text-[9px] font-bold uppercase text-rose-400">
                            required
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <code className="text-[12px] text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">
                          {p.type}
                        </code>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400 text-[13px]">{p.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Returns */}
        {returns && (
          <div>
            <h5 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
              Returns
            </h5>
            <div className="font-mono text-[13px] text-cyan-300 bg-slate-950 rounded-lg px-4 py-3 border border-slate-800/60">
              {returns}
            </div>
          </div>
        )}

        {/* Example */}
        {example && (
          <div>
            <h5 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
              Example
            </h5>
            <CodeBlock code={example} filename={exampleFilename} />
          </div>
        )}
      </div>
    </div>
  );
}
