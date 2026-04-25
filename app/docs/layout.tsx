import type { Metadata } from "next";
import DocsSidebar from "./components/DocsSidebar";

export const metadata: Metadata = {
  title: {
    default: "Documentation | Holdfast",
    template: "%s | Holdfast Docs",
  },
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-slate-950">
      <DocsSidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
