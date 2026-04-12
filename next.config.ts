import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: process.env.NODE_ENV === 'development',
  },
};

export default nextConfig;
