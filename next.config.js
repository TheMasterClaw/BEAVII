/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Base-only app: cross-chain and Flow pages were removed
  async redirects() {
    return ['/dashboard/flow-etf', '/dashboard/flow', '/dashboard/bridge', '/dashboard/swap', '/dashboard/auto-agent', '/dashboard/abi-test']
      .map((source) => ({ source, destination: '/dashboard/stocks', permanent: false }));
  },
  
  // Image optimization configuration
  images: {
    unoptimized: false,
    domains: [],
    remotePatterns: [],
  },
  
  // Completely disable ESLint and TypeScript checking
  eslint: {
    ignoreDuringBuilds: true,
    dirs: [],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  
  // Handle ES modules and resolve import issues
  webpack: (config, { isServer }) => {
    // Handle ES modules
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };

    // Handle bs58 and other problematic modules
    config.module.rules.push({
      test: /\.m?js$/,
      resolve: {
        fullySpecified: false,
      },
    });

    return config;
  },
};

module.exports = nextConfig; 