import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    root: process.cwd(),
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "syntrake.com",
          },
        ],
        destination: "https://www.syntrake.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
