import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: false,
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  eslint: {
    // We run eslint separately in CI; don't fail builds on lint findings
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
