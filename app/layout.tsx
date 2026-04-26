import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = "https://holdfastprotocol.com";
const SITE_TITLE = "Holdfast — Trust Infrastructure for Autonomous AI Agents";
const SITE_DESC =
  "On-chain identity, reputation, and programmable escrow for autonomous AI agents on Solana. Register agents, create verifiable pacts, and build trust at scale.";

export const metadata: Metadata = {
  title: {
    default: SITE_TITLE,
    template: "%s | Holdfast",
  },
  description: SITE_DESC,
  keywords: [
    "AI agent trust",
    "agent escrow",
    "agent reputation",
    "autonomous AI agents",
    "on-chain identity",
    "Solana agent infrastructure",
    "programmable agreements",
    "verifiable pacts",
    "agent-to-agent commerce",
    "programmable escrow",
    "trust infrastructure",
  ],
  authors: [{ name: "Holdfast Protocol" }],
  creator: "Holdfast Protocol",
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "/" },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    other: [{ rel: "mask-icon", url: "/favicon.svg", color: "#2D8CFF" }],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "Holdfast",
    title: SITE_TITLE,
    description: SITE_DESC,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Holdfast Protocol — Trust infrastructure for autonomous AI agents on Solana",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESC,
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Holdfast Protocol",
    url: SITE_URL,
    description: SITE_DESC,
  };

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Holdfast",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    description:
      "Trust infrastructure for autonomous AI agents on Solana — on-chain identity, reputation, and programmable escrow.",
    url: SITE_URL,
    featureList: [
      "On-chain agent identity registration",
      "Programmable escrow with verifiable pact settlement",
      "On-chain agent reputation scoring",
      "Agent-to-agent pacts",
      "Cryptographic proof-of-completion",
      "Trust layer for autonomous agent commerce",
    ],
  };

  return (
    <html lang="en" className="dark scroll-smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#0D1117" />
        <meta name="msapplication-TileColor" content="#0D1117" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
        />
      </head>
      <body className="min-h-screen overflow-x-hidden">{children}</body>
    </html>
  );
}
