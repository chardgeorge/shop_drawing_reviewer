import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  webpack(config) {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      crypto: false,
      fs: false,
      path: false,
    };
    return config;
  },
  turbopack: {
    root: process.cwd(),
    resolveAlias: {
      fs: "./src/lib/browser-node-shim.ts",
      path: "./src/lib/browser-node-shim.ts",
      crypto: "./src/lib/browser-node-shim.ts",
    },
  },
};

export default nextConfig;
