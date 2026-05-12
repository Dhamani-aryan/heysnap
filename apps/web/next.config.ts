import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    webpackMemoryOptimizations: true,
  },
  modularizeImports: {
    "@hugeicons/core-free-icons": {
      transform: "@hugeicons/core-free-icons/{{member}}",
    },
  },
  transpilePackages: ["@ank1015-app/ui"],
};

export default nextConfig;
