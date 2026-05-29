import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev server binds to 0.0.0.0; allow loopback origins to hit /_next/*.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  experimental: {
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
