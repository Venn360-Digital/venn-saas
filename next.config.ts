import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: [
    '@langchain/openai',
    '@langchain/textsplitters',
    '@langchain/community',
    '@langchain/core',
    'langchain',
  ],
  // Empty turbopack config to silence warning
  turbopack: {},
};

export default nextConfig;
