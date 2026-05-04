"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import {
  BookOpen,
  Zap,
  Layers,
  Code2,
  Lock,
  Menu,
  X,
} from "lucide-react";

interface NavItem {
  title: string;
  href: string;
  icon?: React.ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navigation: NavGroup[] = [
  {
    label: "Getting Started",
    items: [
      { title: "Introduction", href: "/docs", icon: <BookOpen className="w-4 h-4" /> },
      { title: "Quick Start", href: "/docs/quickstart", icon: <Zap className="w-4 h-4" /> },
    ],
  },
  {
    label: "Reference",
    items: [
      { title: "Architecture", href: "/docs/architecture", icon: <Layers className="w-4 h-4" /> },
      { title: "API Reference", href: "/docs/api-reference", icon: <Code2 className="w-4 h-4" /> },
      { title: "Security Model", href: "/docs/security", icon: <Lock className="w-4 h-4" /> },
    ],
  },
];

export default function DocsSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/docs") return pathname === "/docs";
    return pathname.startsWith(href);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-slate-800/60">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
            <Lock className="w-3.5 h-3.5 text-slate-950" />
          </div>
          <span className="text-base font-bold tracking-tight text-white">
            HOLDFAST
          </span>
          <span className="text-[10px] font-medium text-slate-500 bg-slate-800/80 px-1.5 py-0.5 rounded ml-auto">
            DOCS
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {navigation.map((group) => (
          <div key={group.label}>
            <h4 className="px-2 mb-2 text-[11px] font-semibold tracking-widest uppercase text-slate-500">
              {group.label}
            </h4>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`
                        flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-all
                        ${active
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent"
                        }
                      `}
                    >
                      {item.icon && (
                        <span className={active ? "text-emerald-400" : "text-slate-500"}>
                          {item.icon}
                        </span>
                      )}
                      {!item.icon && <span className="w-4" />}
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-slate-800/60 space-y-1.5">
        <div className="flex items-center gap-2 text-[11px] text-slate-600">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Holdfast Protocol v0.1.0
        </div>
        <div className="text-[10px] text-slate-700">
          A <span className="text-slate-500">Casemate Labs</span> project
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-4 left-4 z-[60] w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
        aria-label="Toggle navigation"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 z-50 h-screen w-[272px] bg-slate-950 border-r border-slate-800/60
          transition-transform duration-300 ease-in-out
          lg:translate-x-0 lg:static lg:z-auto
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
