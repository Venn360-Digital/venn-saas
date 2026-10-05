import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle under .next/standalone, which is what
  // the Docker runtime stage copies instead of the whole node_modules tree.
  output: "standalone",
  serverExternalPackages: [
    '@langchain/openai',
    '@langchain/textsplitters',
    '@langchain/community',
    '@langchain/core',
    'langchain',
    // Keeps BullMQ and ioredis out of the bundler: both resolve Lua scripts and
    // native bits at runtime.
    'bullmq',
    'ioredis',
  ],
  // Empty turbopack config to silence warning
  turbopack: {},
};

export default nextConfig;
