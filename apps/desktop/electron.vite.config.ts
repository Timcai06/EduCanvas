import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/main' },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload' },
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    build: {
      outDir: 'out/renderer',
      // sprite-sheet.png 小于 4KB，默认会被内联成 data URI，
      // 而 index.html 的 CSP img-src 'self' 会拦截 data: —— 强制输出为文件
      assetsInlineLimit: 0,
    },
  },
});
