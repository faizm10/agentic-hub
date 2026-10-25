import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/ui ships TypeScript source.
  transpilePackages: ["@agentic-hub/ui"],
  reactStrictMode: true,
};

export default nextConfig;
