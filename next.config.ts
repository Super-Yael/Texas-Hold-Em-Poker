import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  devIndicators: false,
  allowedDevOrigins: ["poker.20100501.xyz"],
  async headers() {
    return [
      {
        source: "/cards/svg/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, s-maxage=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
