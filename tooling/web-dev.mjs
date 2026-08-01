#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';
import { resolveWebDevCommand } from './web-dev-command.mjs';

const invocation = resolveWebDevCommand();
const child = spawn(invocation.command, invocation.args, {
  env: process.env,
  shell: invocation.shell,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}

child.once('error', (error) => {
  process.stderr.write(`[web] Next.js 启动失败: ${error.message}\n`);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  process.exitCode =
    typeof code === 'number'
      ? code
      : signal === 'SIGINT'
        ? 130
        : signal === 'SIGTERM'
          ? 143
          : 1;
});
