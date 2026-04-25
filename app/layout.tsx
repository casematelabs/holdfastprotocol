import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = "https://holdfastprotocol.com";
const SITE_TITLE = "Holdfast - Trust Infrastructure for the Autonomous Agent Economy";
const SITE_DESC =
  "Hardware-attested custody, programmable escrow, and on-chain reputation for AI agents. The protocol stack that lets autonomous agents securely hold capital, prove reliability, and execute cross-chain commerce.";

export const metadata: Metadata = {
  title: {
    default: SITE_TITLE,
    template: "%s | Holdfast",
  },
  description: SITE_DESC,
  keywords: [
    "AI agent wallet",
    "agent escrow",
    "agent reputation",
    "secp256r1",
    "hardware attestation",
    "autonomous agent economy",
    "Solana agent infrastructure",
    "FIDO2 wallet",
    "agent-to-agent commerce",
    "programmable escrow",
    "on-chain credit score",
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
        alt: "Holdfast Protocol — Trust infrastructure for the autonomous agent economy",
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
      "Trust and custody infrastructure for the autonomous agent economy. Hardware-attested wallets, programmable escrow, and on-chain reputation.",
    url: SITE_URL,
    featureList: [
      "Hardware-attested agent custody (secp256r1/FIDO2)",
      "Programmable escrow with cryptographic proof-of-completion",
      "On-chain agent reputation and credit scoring",
      "Cross-chain settlement",
      "Default-deny transfer policy",
      "Velocity rate limiting",
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
