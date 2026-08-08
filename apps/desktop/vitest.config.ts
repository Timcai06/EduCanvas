import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true, // T1 阶段 tests/ 尚不存在，vitest run 不报错
  },
});
