import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Turbopack会沿父目录查找锁文件；显式固定到EduCanvas根目录，避免把用户目录
// /Users/tim/package-lock.json误判为本项目边界，同时保留对workspace源码包的解析。
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

const nextConfig: NextConfig = {
  // 本地自动化和多设备验收会通过127.0.0.1访问；显式允许其加载dev HMR资源，
  // 否则页面只有SSR HTML而不会完成React hydration。
  allowedDevOrigins: ['127.0.0.1'],
  // sharp 是原生模块：lib/utility.js 含静态 fallback require('@img/sharp-
  // wasm32/versions')，而 @img/sharp-wasm32 只在 wasm32 CPU 上才会被 pnpm
  // 安装，任何真实平台都没有该包。webpack 会静态解析 try/catch 内的 require
  // 并直接报 Can't resolve（Turbopack 不解析 fallback，故 Linux CI 不暴露）。
  serverExternalPackages: ['sharp', 'sherpa-onnx'],
  webpack: (config, { isServer }) => {
    // serverExternalPackages 在 pnpm workspace 下会被 Next 的 baseResolveCheck
    // 否决：base 解析从 apps/web 根目录查找 sharp，而 pnpm 不提升依赖、web
    // 根目录没有 sharp 链接，路径不一致 → Next 拒绝 externalize → webpack
    // dev（Windows 专用；Turbopack 在 Windows 格式化 Unicode 诊断会崩）仍然
    // 打包 sharp 并报上面的错。这里在 server 编译里显式排除 sharp。
    // sherpa-onnx 同理：model-gateway 的 barrel index 静态导出 sherpa 流式
    // resolver，webpack 会静态解析 loadSherpaOnnxSdk 里的 require('sherpa-
    // onnx')，而它是 gateway 进程用的 WASM 原生模块，web 包没有该依赖。该
    // require 运行时由 createRequire 相对 model-gateway 解析（懒加载，默认
    // 关闭），因此只需在编译期排除。
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : []),
        { sharp: 'commonjs sharp' },
        { 'sherpa-onnx': 'commonjs sherpa-onnx' },
      ];
    }
    return config;
  },
  turbopack: {
    root: workspaceRoot,
  },
  // 内部包直接发布TypeScript源码且不单独产出构建目录，因此交给Next.js一并转译。
  transpilePackages: [
    '@educanvas/agent-core',
    '@educanvas/agent-runtime',
    '@educanvas/asset-processing',
    '@educanvas/canvas-protocol',
    '@educanvas/db',
    '@educanvas/teaching-core',
    '@educanvas/teaching-runtime',
  ],
};

export default nextConfig;
