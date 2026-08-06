import { defineConfig, globalIgnores } from 'eslint/config';
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = defineConfig([
  ...coreWebVitals,
  ...typescript,
  globalIgnores(['.next/**', 'node_modules/**', 'next-env.d.ts']),
  /* W05 静态边界：features/** 是浏览器侧 Client 组件层，禁止反向依赖 server/数据库层。
     新违规在 lint 阶段失败；现有 `@/app/actions`（Next server actions）是合法入口，不在限制内。 */
  {
    files: ['**/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'server-only',
              message: 'features/** 是 Client 组件层，禁止导入 server-only。',
            },
          ],
          patterns: [
            {
              group: ['**/server/**'],
              message:
                'features/** 禁止直接导入 server 层，数据访问走公开 API 入口。',
            },
            {
              group: ['@educanvas/db', '@educanvas/db/*'],
              message: 'features/** 禁止直接导入数据库层，走服务端入口。',
            },
            {
              group: ['**/db/schema*', '**/schema/**'],
              message: 'features/** 禁止导入数据库 schema。',
            },
          ],
        },
      ],
    },
  },
]);

export default config;
