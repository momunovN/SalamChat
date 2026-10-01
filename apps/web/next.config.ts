import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "pg",
    "web-push",
    "ws",
    "@neondatabase/serverless",
    "@prisma/client",
    "@prisma/adapter-neon",
  ],
};

export default nextConfig;
