import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
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
    root: __dirname,
    resolveAlias: {
      fs: "./src/lib/browser-node-shim.ts",
      path: "./src/lib/browser-node-shim.ts",
      crypto: "./src/lib/browser-node-shim.ts",
    },
  },
};

export default nextConfig;
