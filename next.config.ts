import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        stream: false,
        path: false,
        os: false,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
};

export default nextConfig;
