import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Q05：核心包 coverage 门禁。阈值先由真实基线回填（Q-质量观测成本.md Q05），
  // 只防回归，不追求数字。生成代码与纯类型不进分母。
  coverage: {
    provider: 'v8',
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    reporter: ['text', 'json-summary'],
    reportsDirectory: 'coverage',
    // 基线（2026-08-06 实测）：S 78.43 / B 74.70 / F 86.57 / L 80.51。
    // 门槛 = 基线防回归；只升不降，逐步提高在 Q07 报告收口。
    thresholds: {
      statements: 78,
      branches: 74,
      functions: 86,
      lines: 80,
    },
  },
});
