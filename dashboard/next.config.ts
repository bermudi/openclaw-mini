import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: false,
  outputFileTracingRoot: new URL('../', import.meta.url).pathname,
  allowedDevOrigins: ['10.0.0.123', 'localhost'],
};

export default nextConfig;
