/**
 * V08 sherpa 流式转录 Adapter 测试 — 验收 1-9：partial/endpoint/final 投影、
 * finish 尾部 flush、取消/中止、超时竞争、recognizer 异常归一化。
 *
 * 全部使用 fake recognizer（见 test-support），不读取真实模型、不调用
 * 付费 Provider。验收 10-16 见同目录 rejection 测试文件。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { StreamingTranscriptionStateError } from '@educanvas/agent-core';
import {
  FakeRecognizer,
  collectEvents,
  createGateway,
  endpointEvent,
  expectValidSequence,
  failedEvent,
  finalEvent,
  partialEvent,
  pcmChunk,
  request,
} from './sherpa-streaming-transcription-gateway.test-support';

afterEach(() => {
  vi.useRealTimers();
});

describe('SherpaStreamingTranscriptionGateway', () => {
  describe('验收 1-3：partial/endpoint/final 投影', () => {
    it('合法 PCM 产生 partial', async () => {
      const fake = new FakeRecognizer();
      fake.partialScript = ['同学你好'];
      fake.finalText = '同学你好';
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      const eventsPromise = collectEvents(session);
      session.finish();
      const events = await eventsPromise;
      expectValidSequence(events);
      expect(events).toEqual([
        partialEvent(0, '同学你好'),
        finalEvent(1, '同学你好'),
      ]);
    });

    it('partial 被后续 partial 修正', async () => {
      const fake = new FakeRecognizer();
      fake.partialScript = ['同学', '同学你好'];
      fake.finalText = '同学你好';
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      session.pushChunk(pcmChunk(1, 16_000));
      const eventsPromise = collectEvents(session);
      session.finish();
      const events = await eventsPromise;
      expectValidSequence(events);
      expect(events).toEqual([
        partialEvent(0, '同学'),
        partialEvent(1, '同学你好'),
        finalEvent(2, '同学你好'),
      ]);
    });

    it('endpoint 后仍可产生 final', async () => {
      const fake = new FakeRecognizer();
      fake.partialScript = ['同学你好'];
      fake.endpointAfterDecode = 2;
      fake.finalText = '同学你好';
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      session.pushChunk(pcmChunk(1, 16_000)); // 第二次 decode 后检测到端点
      const eventsPromise = collectEvents(session);
      session.finish();
      const events = await eventsPromise;
      expectValidSequence(events);
      expect(events).toEqual([
        partialEvent(0, '同学你好'),
        partialEvent(1, '同学你好'),
        endpointEvent(2),
        finalEvent(3, '同学你好'),
      ]);
    });
  });

  describe('验收 4：finish 尾部 flush', () => {
    it('finish 补入完整 1.5 秒零值尾部', async () => {
      const fake = new FakeRecognizer();
      fake.finalText = '结果';
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      // 输入 48 000 字节 = 24 000 样本
      session.pushChunk(pcmChunk(0, 32_000));
      session.pushChunk(pcmChunk(1, 16_000));
      const eventsPromise = collectEvents(session);
      session.finish();
      const events = await eventsPromise;
      expect(events.at(-1)).toMatchObject({ type: 'final' });
      expectValidSequence(events);
      // 输入 24 000 样本 + 尾部 48 000 字节 = 24 000 样本
      expect(fake.totalSamples).toBe(48_000);
      expect(fake.sampleRates).toEqual(
        Array.from({ length: fake.chunks.length }, () => 16_000),
      );
      // 尾部按单 chunk 上限拆成 [16 000, 8 000] 样本且全零
      const tailSamples = fake.chunks.slice(-2).flatMap((c) => Array.from(c));
      expect(tailSamples.length).toBe(24_000);
      expect(tailSamples.every((value) => value === 0)).toBe(true);
      // 输入部分保持非零
      const inputSamples = fake.chunks
        .slice(0, -2)
        .flatMap((c) => Array.from(c));
      expect(inputSamples.every((value) => value !== 0)).toBe(true);
    });
  });

  describe('验收 5-6：取消与中止', () => {
    it('cancel 不补尾部并产生 CANCELLED', async () => {
      const fake = new FakeRecognizer();
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      const eventsPromise = collectEvents(session);
      session.cancel();
      const events = await eventsPromise;
      expect(events).toEqual([failedEvent(0, 'CANCELLED')]);
      expect(fake.totalSamples).toBe(16_000); // 无尾部
      expect(fake.inputFinishedCalls).toBe(0);
      expect(fake.freeCalls).toBe(1);
    });

    it('AbortSignal 取消会话', async () => {
      const fake = new FakeRecognizer();
      const { gateway } = createGateway([fake]);
      const controller = new AbortController();
      const session = gateway.beginStreaming({
        ...request,
        signal: controller.signal,
      });
      session.pushChunk(pcmChunk(0));
      const eventsPromise = collectEvents(session);
      controller.abort();
      const events = await eventsPromise;
      expect(events).toEqual([failedEvent(0, 'CANCELLED')]);
      expect(fake.inputFinishedCalls).toBe(0);
      expect(fake.freeCalls).toBe(1);
    });

    it('beginStreaming 时 signal 已 aborted 立即取消', async () => {
      const fake = new FakeRecognizer();
      const { gateway } = createGateway([fake]);
      const controller = new AbortController();
      controller.abort();
      const session = gateway.beginStreaming({
        ...request,
        signal: controller.signal,
      });
      const events = await collectEvents(session);
      expect(events).toEqual([failedEvent(0, 'CANCELLED')]);
    });

    it('finish 后但 final 前 AbortSignal 仍抢占为 CANCELLED', async () => {
      vi.useFakeTimers();
      const fake = new FakeRecognizer();
      fake.finalText = null;
      const { gateway } = createGateway([fake], { timeoutMs: 1_000 });
      const controller = new AbortController();
      const session = gateway.beginStreaming({
        ...request,
        signal: controller.signal,
      });
      session.pushChunk(pcmChunk(0));
      session.finish();
      const eventsPromise = collectEvents(session);
      controller.abort();
      const events = await eventsPromise;
      expect(events).toEqual([failedEvent(0, 'CANCELLED')]);
      expect(fake.freeCalls).toBe(1);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(events).toHaveLength(1);
    });
  });

  describe('验收 7：超时与 finish 竞争', () => {
    it('finish 后识别器永不就绪 → 超时产生唯一 failed 终态', async () => {
      vi.useFakeTimers();
      const fake = new FakeRecognizer();
      fake.finalText = null; // 永不就绪
      const { gateway } = createGateway([fake], { timeoutMs: 1_000 });
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      session.finish();
      const eventsPromise = collectEvents(session);
      await vi.advanceTimersByTimeAsync(1_000);
      const events = await eventsPromise;
      expect(events).toEqual([failedEvent(0, 'MODEL_FAILED')]);
      expect(
        events.filter((e) => e.type === 'final' || e.type === 'failed'),
      ).toHaveLength(1);
      expect(fake.freeCalls).toBe(1);
      // 再推进不会产生第二个终态
      await vi.advanceTimersByTimeAsync(5_000);
      expect(events).toHaveLength(1);
    });

    it('final 在超时前就绪：final 唯一终态且超时计时器被清理', async () => {
      vi.useFakeTimers();
      const fake = new FakeRecognizer();
      fake.finalText = null; // 初始未就绪
      const { gateway } = createGateway([fake], { timeoutMs: 1_000 });
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      session.finish();
      const eventsPromise = collectEvents(session);
      await vi.advanceTimersByTimeAsync(200); // flush 轮询进行中
      fake.finalText = '超时前就绪';
      await vi.advanceTimersByTimeAsync(100);
      const events = await eventsPromise;
      expect(events.at(-1)).toMatchObject({
        type: 'final',
        text: '超时前就绪',
      });
      expect(
        events.filter((e) => e.type === 'final' || e.type === 'failed'),
      ).toHaveLength(1);
      expect(fake.freeCalls).toBe(1);
      // 超时已被清理：继续推进无第二个终态
      await vi.advanceTimersByTimeAsync(5_000);
      expect(
        events.filter((e) => e.type === 'final' || e.type === 'failed'),
      ).toHaveLength(1);
    });
  });

  describe('验收 8-9：recognizer 异常归一化', () => {
    it('decode 异常归一化为 MODEL_FAILED', async () => {
      const fake = new FakeRecognizer();
      fake.decodeError = new Error('decode boom');
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      const eventsPromise = collectEvents(session);
      session.pushChunk(pcmChunk(0));
      const events = await eventsPromise;
      expect(events).toEqual([failedEvent(0, 'MODEL_FAILED')]);
      expect(fake.freeCalls).toBe(1);
    });

    it('acceptWaveform 异常归一化为 MODEL_FAILED', async () => {
      const fake = new FakeRecognizer();
      fake.acceptError = new Error('accept boom');
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      const eventsPromise = collectEvents(session);
      session.pushChunk(pcmChunk(0));
      const events = await eventsPromise;
      expect(events).toEqual([failedEvent(0, 'MODEL_FAILED')]);
    });

    it('acceptWaveform 显式拒收也归一化为 MODEL_FAILED', async () => {
      const fake = new FakeRecognizer();
      fake.acceptResult = false;
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      const eventsPromise = collectEvents(session);
      session.pushChunk(pcmChunk(0));
      expect(await eventsPromise).toEqual([failedEvent(0, 'MODEL_FAILED')]);
      expect(fake.freeCalls).toBe(1);
    });

    it.each(['partial', 'endpoint'] as const)(
      'recognizer %s 查询异常被安全归一化',
      async (query) => {
        const fake = new FakeRecognizer();
        if (query === 'partial') fake.partialError = new Error('/secret/model');
        else fake.endpointError = new Error('/secret/model');
        const { gateway } = createGateway([fake]);
        const session = gateway.beginStreaming(request);
        const eventsPromise = collectEvents(session);
        expect(() => session.pushChunk(pcmChunk(0))).not.toThrow();
        expect(await eventsPromise).toEqual([failedEvent(0, 'MODEL_FAILED')]);
        expect(fake.freeCalls).toBe(1);
      },
    );

    it('free 异常不泄漏、不覆盖已形成的终态', async () => {
      const fake = new FakeRecognizer();
      fake.finalText = '最终';
      fake.freeError = new Error('free boom');
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      const eventsPromise = collectEvents(session);
      session.finish();
      const events = await eventsPromise;
      expect(events.at(-1)).toMatchObject({ type: 'final', text: '最终' });
      expect(events.filter((e) => e.type === 'failed')).toHaveLength(0);
      expect(fake.freeCalls).toBe(1);
    });

    it('cancel 路径 free 抛错也不影响 CANCELLED 终态', async () => {
      const fake = new FakeRecognizer();
      fake.freeError = new Error('free boom');
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      const eventsPromise = collectEvents(session);
      session.cancel();
      const events = await eventsPromise;
      expect(events).toEqual([failedEvent(0, 'CANCELLED')]);
      expect(fake.freeCalls).toBe(1);
    });

    it('recognizer 工厂异常归一化为稳定错误，不泄漏模型路径', () => {
      const modelPath = '/Users/secret/models/sherpa-int8.onnx';
      const { gateway } = createGateway([], {
        recognizerFactory: {
          create: () => {
            throw Object.assign(new Error(`无法加载 ${modelPath}`), {
              stack: `at ${modelPath}`,
            });
          },
        },
      });
      try {
        gateway.beginStreaming(request);
        expect.unreachable('应当抛稳定错误');
      } catch (error) {
        expect(error).toBeInstanceOf(StreamingTranscriptionStateError);
        const stateError = error as StreamingTranscriptionStateError;
        expect(stateError.code).toBe('MODEL_FAILED');
        expect(stateError.message).toBe('MODEL_FAILED');
        expect(JSON.stringify(stateError)).not.toContain(modelPath);
      }
    });

    it('预中止 signal 的日志顺序为 started → ended', async () => {
      const controller = new AbortController();
      controller.abort();
      const { gateway, logs } = createGateway([new FakeRecognizer()]);
      const session = gateway.beginStreaming({
        ...request,
        signal: controller.signal,
      });
      const events = await collectEvents(session);
      expect(events).toEqual([failedEvent(0, 'CANCELLED')]);
      expect(logs.map((entry) => entry.label)).toEqual([
        'session_started',
        'session_ended',
      ]);
    });
  });
});
