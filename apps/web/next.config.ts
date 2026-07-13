import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@educanvas/canvas-protocol', '@educanvas/db'],
};

export default nextConfig;
