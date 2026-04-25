"use client";

import { useEffect, useState } from "react";

interface TOCItem {
  id: string;
  text: string;
  level: number;
}

export default function OnThisPage({ headings }: { headings: TOCItem[] }) {
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );

    for (const heading of headings) {
      const el = document.getElementById(heading.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <div className="hidden xl:block w-56 flex-shrink-0">
      <div className="sticky top-24">
        <h4 className="text-[11px] font-semibold tracking-widest uppercase text-slate-500 mb-3">
          On this page
        </h4>
        <ul className="space-y-1.5 border-l border-slate-800/60">
          {headings.map((h) => (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                className={`
                  block text-[12.5px] leading-snug transition-colors
                  ${h.level === 3 ? "pl-6" : "pl-3"}
                  ${activeId === h.id
                    ? "text-emerald-400 border-l-2 border-emerald-400 -ml-px"
                    : "text-slate-500 hover:text-slate-300"
                  }
                `}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
