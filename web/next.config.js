import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: false,
  outputFileTracingRoot: path.resolve(process.cwd(), '..')
};

export default nextConfig;
