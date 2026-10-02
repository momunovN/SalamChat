import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "pg",
    "web-push",
    "ws",
    "@neondatabase/serverless",
  ],
};

export default nextConfig;
