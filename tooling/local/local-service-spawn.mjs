/**
 * 服务子进程管理 — spawn / 输出管道 / JSONL 写入 / readiness 事件检测。
 *
 * 每个服务独立 spawn（web/gateway/worker），stdout/stderr 分别接 line
 * splitter → 协议解析 → combined + 按服务 JSONL →（verbose）pretty 输出 →
 * readiness/fatal 事件回调。spawn error、exit、signal 全部进入统一日志。
 */

import { spawn } from 'node:child_process';
import { closeSync, openSync, writeSync } from 'node:fs';
import path from 'node:path';
import { createLineSplitter, parseProcessLine } from './local-process-pipe.mjs';
import { renderRecord } from './local-pretty.mjs';
import { EVENTS } from './log-protocol.mjs';

/** 每个服务保留给失败摘要用的最近记录数。 */
const RECENT_LIMIT = 200;

export class ServiceProcess {
  constructor({ name, command, args, env, runDirectory, verbose, color }) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.env = env;
    this.verbose = verbose;
    this.color = color;
    this.ready = false;
    this.failed = false;
    this.fatalError = null;
    this.recent = [];
    this.startedAt = Date.now();
    this.readyAt = undefined;

    const combinedPath = path.join(runDirectory, 'combined.jsonl');
    const servicePath = path.join(runDirectory, `${name}.jsonl`);
    // 三个服务共用 combined fd；写失败不崩溃（降级到内存）。
    this.combinedFd = openSync(combinedPath, 'a');
    this.serviceFd = openSync(servicePath, 'a');
    this.exitPromise = null;
    this.child = null;
  }

  append(record) {
    try {
      const line = `${JSON.stringify(record)}\n`;
      writeSync(this.combinedFd, line);
      writeSync(this.serviceFd, line);
    } catch {
      // 磁盘满等：不阻断服务进程。
    }
    this.recent.push(record);
    if (this.recent.length > RECENT_LIMIT) this.recent.shift();
    if (this.verbose) {
      process.stdout.write(`${renderRecord(record, { color: this.color })}\n`);
    }
    this.detectLifecycle(record);
  }

  /** 生命周期事件检测：ready / fatal。 */
  detectLifecycle(record) {
    if (this.ready || this.failed) return;
    if (
      record.event === EVENTS.workerReady ||
      record.event === EVENTS.serviceReady
    ) {
      this.ready = true;
      this.readyAt = Date.now();
    }
    if (record.level === 'fatal' || record.event === EVENTS.serviceFailed) {
      this.failed = true;
      this.fatalError = record.error ?? null;
    }
  }

  spawn({ shell = false } = {}) {
    // detached 让每个服务处于独立进程组：orchestrator 统一收信号后按组
    // 终止，避免 pnpm→tsx/next 层级中下层进程成为孤儿占住端口；
    // Windows 用 taskkill /T 杀进程树（detached 语义不同，不启用）。
    const child = spawn(this.command, this.args, {
      env: this.env,
      shell: shell || (process.platform === 'win32' && this.command === 'pnpm'),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    this.child = child;

    const attach = (stream, pipeStream) => {
      const splitter = createLineSplitter((line) => {
        this.append(
          parseProcessLine(line, { service: this.name, stream: pipeStream }),
        );
      });
      stream.on('data', (chunk) => splitter.push(String(chunk)));
      stream.on('end', () => splitter.end());
    };
    attach(child.stdout, 'stdout');
    attach(child.stderr, 'stderr');

    // exit 是权威信号：事件发生后固定成 promise，避免重复监听挂起。
    this.exitPromise = new Promise((resolve) => {
      child.once('exit', (code, signal) => {
        this.append({
          schema: 'educanvas.log.v1',
          ts: new Date().toISOString(),
          level: code === 0 ? 'info' : 'warn',
          service: this.name,
          component: 'orchestrator',
          event: 'process.exit',
          message: `${this.name} 进程退出`,
          code: code ?? null,
          signal: signal ?? null,
        });
        resolve({ code, signal });
      });
      child.once('error', (error) => {
        this.append({
          schema: 'educanvas.log.v1',
          ts: new Date().toISOString(),
          level: 'error',
          service: this.name,
          component: 'orchestrator',
          event: 'process.exit',
          message: `${this.name} spawn 失败`,
          code: null,
          signal: null,
          error: { name: error.name, message: error.message },
        });
        resolve({ code: null, signal: null, error });
      });
    });
    return child;
  }

  /** 按进程树终止：POSIX 杀整个进程组；Windows taskkill /T。 */
  killTree(signal = 'SIGTERM') {
    if (!this.child) return;
    if (process.platform === 'win32') {
      try {
        const killer = spawn(
          'taskkill',
          ['/T', '/PID', String(this.child.pid)],
          {
            stdio: 'ignore',
          },
        );
        killer.unref();
      } catch {
        this.child.kill(signal);
      }
      return;
    }
    try {
      process.kill(-this.child.pid, signal);
    } catch {
      // 进程组不存在或已退出。
      try {
        this.child.kill(signal);
      } catch {
        // 已退出。
      }
    }
  }

  stop(signal = 'SIGTERM') {
    if (
      this.child &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    ) {
      this.killTree(signal);
    }
  }

  async stopWithTimeout(signal = 'SIGTERM', timeoutMs = 5_000) {
    if (!this.child) return;
    this.stop(signal);
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.killTree('SIGKILL');
        resolve();
      }, timeoutMs);
      this.child?.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  close() {
    try {
      closeSync(this.combinedFd);
    } catch {
      /* noop */
    }
    try {
      closeSync(this.serviceFd);
    } catch {
      /* noop */
    }
  }

  readyAtMs() {
    if (!this.ready || this.readyAt === undefined) return null;
    return this.readyAt - this.startedAt;
  }
}

/** 便捷工厂：构造并 spawn 一个服务。 */
export function launchService(options) {
  const service = new ServiceProcess(options);
  service.spawn({ shell: options.shell });
  return service;
}
