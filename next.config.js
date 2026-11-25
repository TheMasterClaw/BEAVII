/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Security headers (audit F-08). The dApp asks users to sign transactions, so it must never be framed.
  // A full script CSP still needs testing against every Reown/WalletConnect origin before it can be enforced.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },

  // Base-only app: cross-chain and Flow pages were removed
  async redirects() {
    const legacy = ['/dashboard/flow-etf', '/dashboard/flow', '/dashboard/bridge', '/dashboard/swap', '/dashboard/auto-agent', '/dashboard/abi-test']
      .map((source) => ({ source, destination: '/dashboard/stocks', permanent: false }));
    // Mock pages removed in the journey cleanup: Portfolio replaces analytics and transactions
    const removed = [
      { source: '/dashboard/analytics', destination: '/dashboard' },
      { source: '/dashboard/transactions', destination: '/dashboard' },
      { source: '/dashboard/agent-report', destination: '/dashboard/agent' },
    ].map((r) => ({ ...r, permanent: false }));
    return [...legacy, ...removed];
  },
  
  // Image optimization configuration
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 30,
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