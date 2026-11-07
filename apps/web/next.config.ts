import type { NextConfig } from 'next';

/**
 * The browser never calls the NestJS API directly — Next.js rewrites proxy
 * `/api/v1/*` and `/api/health` to it (same-origin, no CORS). `API_INTERNAL_URL`
 * is the in-container api hostname (see docker-compose.yml); it defaults to the
 * dev port.
 */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${API_INTERNAL_URL}/api/v1/:path*` },
      { source: '/api/health', destination: `${API_INTERNAL_URL}/api/health` },
    ];
  },
};

export default nextConfig;
