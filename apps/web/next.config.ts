import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Turbopack会沿父目录查找锁文件；显式固定到EduCanvas根目录，避免把用户目录
// /Users/tim/package-lock.json误判为本项目边界，同时保留对workspace源码包的解析。
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

const nextConfig: NextConfig = {
  // 本地自动化和多设备验收会通过127.0.0.1访问；显式允许其加载dev HMR资源，
  // 否则页面只有SSR HTML而不会完成React hydration。
  allowedDevOrigins: ['127.0.0.1'],
  turbopack: {
    root: workspaceRoot,
  },
  // 内部包直接发布TypeScript源码且不单独产出构建目录，因此交给Next.js一并转译。
  transpilePackages: [
    '@educanvas/agent-core',
    '@educanvas/agent-runtime',
    '@educanvas/canvas-protocol',
    '@educanvas/db',
    '@educanvas/teaching-core',
    '@educanvas/teaching-runtime',
  ],
};

export default nextConfig;
