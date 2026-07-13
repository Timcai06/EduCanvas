import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 两个内部包直接发布 TypeScript 源码且不单独产出构建目录，因此交给 Next.js 一并转译。
  transpilePackages: ['@educanvas/canvas-protocol', '@educanvas/db'],
};

export default nextConfig;
