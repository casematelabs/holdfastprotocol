import { AlertTriangle, Info, ShieldAlert, Lightbulb } from "lucide-react";

type CalloutType = "info" | "warning" | "danger" | "tip";

const config: Record<CalloutType, { icon: React.ReactNode; border: string; bg: string; title: string; titleColor: string }> = {
  info: {
    icon: <Info className="w-4 h-4 text-blue-400" />,
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
    title: "Info",
    titleColor: "text-blue-400",
  },
  warning: {
    icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
    border: "border-amber-500/30",
    bg: "bg-amber-500/5",
    title: "Warning",
    titleColor: "text-amber-400",
  },
  danger: {
    icon: <ShieldAlert className="w-4 h-4 text-rose-400" />,
    border: "border-rose-500/30",
    bg: "bg-rose-500/5",
    title: "Danger",
    titleColor: "text-rose-400",
  },
  tip: {
    icon: <Lightbulb className="w-4 h-4 text-emerald-400" />,
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/5",
    title: "Tip",
    titleColor: "text-emerald-400",
  },
};

export default function Callout({
  type = "info",
  title,
  children,
}: {
  type?: CalloutType;
  title?: string;
  children: React.ReactNode;
}) {
  const c = config[type];
  return (
    <div className={`my-6 rounded-xl border ${c.border} ${c.bg} p-4`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex-shrink-0">{c.icon}</div>
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${c.titleColor} mb-1`}>
            {title ?? c.title}
          </p>
          <div className="text-sm text-slate-400 leading-relaxed [&>p]:mb-2 [&>p:last-child]:mb-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
