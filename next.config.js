const path = require('node:path');

const NETWORK = process.env.NEXT_PUBLIC_NETWORK ?? 'base-sepolia';
if (!['base', 'base-sepolia'].includes(NETWORK)) {
  throw new Error(`NEXT_PUBLIC_NETWORK must be "base" or "base-sepolia", got "${NETWORK}"`);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // This app lives in its own folder; don't let a lockfile higher up the tree become the workspace root
  outputFileTracingRoot: path.join(__dirname),

  // Removed pages (cross-chain, Flow, simulated agent/verification screens) point at the live stocks page
  async redirects() {
    return [
      '/dashboard/flow-etf',
      '/dashboard/flow',
      '/dashboard/bridge',
      '/dashboard/swap',
      '/dashboard/auto-agent',
      '/dashboard/abi-test',
      '/dashboard/agent',
      '/dashboard/agent-report',
      '/verify',
      '/verify-twitter',
    ].map((source) => ({ source, destination: '/dashboard/stocks', permanent: false }));
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },

  // Type errors and lint errors fail the build
  eslint: { ignoreDuringBuilds: false, dirs: ['src'] },
  typescript: { ignoreBuildErrors: false },

  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    return config;
  },
};

module.exports = nextConfig;
