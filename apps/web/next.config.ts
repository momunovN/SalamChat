import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "pg",
    "ws",
    "@neondatabase/serverless",
    "@prisma/client",
    "@prisma/adapter-neon",
  ],
};

export default nextConfig;
