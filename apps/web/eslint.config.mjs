import { defineConfig, globalIgnores } from 'eslint/config';
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = defineConfig([
  ...coreWebVitals,
  ...typescript,
  globalIgnores(['.next/**', 'node_modules/**', 'next-env.d.ts']),
]);

export default config;
