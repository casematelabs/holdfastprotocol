import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PrevNextProps {
  prev?: { href: string; title: string };
  next?: { href: string; title: string };
}

export default function PrevNext({ prev, next }: PrevNextProps) {
  return (
    <div className="mt-16 pt-8 border-t border-slate-800/60 grid grid-cols-2 gap-4">
      {prev ? (
        <Link
          href={prev.href}
          className="group flex items-center gap-3 px-5 py-4 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-900/30 hover:bg-slate-900/60 transition-all"
        >
          <ChevronLeft className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-0.5">
              Previous
            </div>
            <div className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">
              {prev.title}
            </div>
          </div>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link
          href={next.href}
          className="group flex items-center justify-end gap-3 px-5 py-4 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-900/30 hover:bg-slate-900/60 transition-all text-right"
        >
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-0.5">
              Next
            </div>
            <div className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">
              {next.title}
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
        </Link>
      ) : (
        <div />
      )}
    </div>
  );
}
