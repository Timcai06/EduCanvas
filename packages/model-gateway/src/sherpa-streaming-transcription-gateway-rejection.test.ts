/**
 * V08 sherpa 流式转录 Adapter 测试 — 验收 10-16：非法输出拒绝、非法 chunk
 * 拒绝、终态纪律、free 至多一次、会话隔离、公共导出边界、安全错误面。
 *
 * 全部使用 fake recognizer（见 test-support），不读取真实模型、不调用
 * 付费 Provider。验收 1-9 见同目录主测试文件。
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SherpaStreamingTranscriptionGateway,
  type SherpaStreamingTranscriptionLogEntry,
} from './sherpa-streaming-transcription-gateway';
import * as publicApi from './index';
import {
  FakeRecognizer,
  assertRejected,
  collectEvents,
  createGateway,
  endpointEvent,
  expectValidSequence,
  factoryFor,
  failedEvent,
  finalEvent,
  partialEvent,
  pcmChunk,
  request,
} from './sherpa-streaming-transcription-gateway.test-support';

describe('SherpaStreamingTranscriptionGateway（验收 10-16）', () => {
  describe('验收 10：空白、超长与非法输出被拒绝', () => {
    it.each([
      ['空白文本', '   '],
      ['超长文本', '长'.repeat(1_001)],
    ])('partial（%s）不进入领域事件', async (_label, text) => {
      const fake = new FakeRecognizer();
      fake.partialScript = [text];
      fake.finalText = '最终';
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      const eventsPromise = collectEvents(session);
      session.finish();
      const events = await eventsPromise;
      expect(events.filter((e) => e.type === 'partial')).toEqual([]);
      expect(events.at(-1)).toMatchObject({ type: 'final', text: '最终' });
    });

    it('非法（非字符串）partial 被拒绝', async () => {
      const fake = new FakeRecognizer();
      fake.partialScript = [null as unknown as string];
      fake.finalText = '最终';
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      const eventsPromise = collectEvents(session);
      session.finish();
      const events = await eventsPromise;
      expect(events.filter((e) => e.type === 'partial')).toEqual([]);
      expect(events.at(-1)).toMatchObject({ type: 'final' });
    });

    it.each([
      ['空白文本', '   '],
      ['超长文本', '长'.repeat(1_001)],
    ])('final（%s）不能成为成功终态 → MODEL_FAILED', async (_label, text) => {
      const fake = new FakeRecognizer();
      fake.partialScript = ['假设'];
      fake.finalText = text;
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      const eventsPromise = collectEvents(session);
      session.finish();
      const events = await eventsPromise;
      expect(events.at(-1)).toEqual(failedEvent(1, 'MODEL_FAILED'));
      expect(
        events.filter((e) => e.type === 'final' || e.type === 'failed'),
      ).toHaveLength(1);
    });

    it('非法（非字符串）final → MODEL_FAILED', async () => {
      const fake = new FakeRecognizer();
      fake.partialScript = ['假设'];
      // 运行时非字符串：schema 直接拒绝，不等超时
      fake.finalText = 12_345 as unknown as string;
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      const eventsPromise = collectEvents(session);
      session.finish();
      const events = await eventsPromise;
      expect(events.at(-1)).toEqual(failedEvent(1, 'MODEL_FAILED'));
      expect(
        events.filter((e) => e.type === 'final' || e.type === 'failed'),
      ).toHaveLength(1);
    });
  });

  describe('验收 11：非法 chunk 被稳定拒绝', () => {
    it('重复 sequence → UNKNOWN', () => {
      const { gateway } = createGateway([new FakeRecognizer()]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      assertRejected(() => session.pushChunk(pcmChunk(0)), 'UNKNOWN');
    });

    it('跳号 → UNKNOWN', () => {
      const { gateway } = createGateway([new FakeRecognizer()]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      assertRejected(() => session.pushChunk(pcmChunk(2)), 'UNKNOWN');
    });

    it('跨 operation → UNKNOWN', () => {
      const { gateway } = createGateway([new FakeRecognizer()]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      assertRejected(
        () => session.pushChunk(pcmChunk(1, 32_000, 1_000, 'op-other')),
        'UNKNOWN',
      );
    });

    it('跨 segment → UNKNOWN', () => {
      const { gateway } = createGateway([new FakeRecognizer()]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      assertRejected(
        () =>
          session.pushChunk(
            pcmChunk(1, 32_000, 1_000, request.operationId, 'seg-other'),
          ),
        'UNKNOWN',
      );
    });

    it('空 PCM → INVALID_PCM_CHUNK', () => {
      const { gateway } = createGateway([new FakeRecognizer()]);
      const session = gateway.beginStreaming(request);
      assertRejected(
        () => session.pushChunk(pcmChunk(0, 0)),
        'INVALID_PCM_CHUNK',
      );
    });

    it('奇数长度 PCM → INVALID_PCM_CHUNK', () => {
      const { gateway } = createGateway([new FakeRecognizer()]);
      const session = gateway.beginStreaming(request);
      const chunk = pcmChunk(0, 16_000);
      chunk.pcmBytes = chunk.pcmBytes.subarray(0, 9_999);
      assertRejected(() => session.pushChunk(chunk), 'INVALID_PCM_CHUNK');
    });

    it('超过单分片上限 → INVALID_PCM_CHUNK', () => {
      const { gateway } = createGateway([new FakeRecognizer()]);
      const session = gateway.beginStreaming(request);
      assertRejected(
        () => session.pushChunk(pcmChunk(0, 32_002)),
        'INVALID_PCM_CHUNK',
      );
    });

    it('beginStreaming 携带非法身份 → UNKNOWN（终态投影前拒绝）', () => {
      const createSpy = vi.fn(() => new FakeRecognizer());
      const gateway = new SherpaStreamingTranscriptionGateway({
        recognizerFactory: { create: createSpy },
        timeoutMs: 1_000,
      });
      // 非法身份在 recognizerFactory.create() 之前抛错：不创建、不泄漏识别器。
      assertRejected(
        () => gateway.beginStreaming({ ...request, operationId: '非法 id!' }),
        'UNKNOWN',
      );
      assertRejected(
        () => gateway.beginStreaming({ ...request, segmentId: '' }),
        'UNKNOWN',
      );
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('验收 12：终态后输入拒绝', () => {
    it('finish 后 pushChunk → INPUT_AFTER_FINISH，超时收敛后 → INPUT_AFTER_TERMINAL', async () => {
      vi.useFakeTimers();
      const fake = new FakeRecognizer(); // finalText 恒 null，flush 挂起
      const { gateway } = createGateway([fake], { timeoutMs: 500 });
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      session.finish();
      assertRejected(
        () => session.pushChunk(pcmChunk(1)),
        'INPUT_AFTER_FINISH',
      );
      assertRejected(() => session.finish(), 'INPUT_AFTER_FINISH');
      const eventsPromise = collectEvents(session);
      await vi.advanceTimersByTimeAsync(500);
      const events = await eventsPromise;
      expect(events).toEqual([failedEvent(0, 'MODEL_FAILED')]);
      assertRejected(
        () => session.pushChunk(pcmChunk(2)),
        'INPUT_AFTER_TERMINAL',
      );
      assertRejected(() => session.finish(), 'INPUT_AFTER_TERMINAL');
    });

    it('endpoint 后 pushChunk → INPUT_AFTER_ENDPOINT，finish 仍允许', async () => {
      const fake = new FakeRecognizer();
      fake.endpointAfterDecode = 1;
      fake.finalText = '最终';
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0)); // 投影 endpoint
      assertRejected(
        () => session.pushChunk(pcmChunk(1)),
        'INPUT_AFTER_ENDPOINT',
      );
      const eventsPromise = collectEvents(session);
      session.finish();
      const events = await eventsPromise;
      expectValidSequence(events);
      expect(events).toEqual([endpointEvent(0), finalEvent(1, '最终')]);
    });

    it('final 终态后 pushChunk → INPUT_AFTER_TERMINAL', async () => {
      const fake = new FakeRecognizer();
      fake.partialScript = ['假设'];
      fake.finalText = '最终';
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      session.finish();
      await collectEvents(session);
      assertRejected(
        () => session.pushChunk(pcmChunk(1)),
        'INPUT_AFTER_TERMINAL',
      );
      assertRejected(() => session.finish(), 'INPUT_AFTER_TERMINAL');
    });

    it('cancel 后重复 cancel / pushChunk → INPUT_AFTER_TERMINAL', () => {
      const fake = new FakeRecognizer();
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      session.cancel();
      assertRejected(() => session.cancel(), 'INPUT_AFTER_TERMINAL');
      assertRejected(
        () => session.pushChunk(pcmChunk(1)),
        'INPUT_AFTER_TERMINAL',
      );
    });
  });

  describe('验收 13：free 最多一次', () => {
    it('各终态路径只释放一次', () => {
      const fake = new FakeRecognizer();
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      session.cancel();
      expect(fake.freeCalls).toBe(1);
      // 终态后的动作不再触发释放
      assertRejected(() => session.cancel(), 'INPUT_AFTER_TERMINAL');
      assertRejected(
        () => session.pushChunk(pcmChunk(0)),
        'INPUT_AFTER_TERMINAL',
      );
      expect(fake.freeCalls).toBe(1);
    });

    it('finish 成功路径只释放一次', async () => {
      const fake = new FakeRecognizer();
      fake.finalText = '结果';
      const { gateway } = createGateway([fake]);
      const session = gateway.beginStreaming(request);
      session.pushChunk(pcmChunk(0));
      const eventsPromise = collectEvents(session);
      session.finish();
      await eventsPromise;
      expect(fake.freeCalls).toBe(1);
    });
  });

  describe('验收 14：两个 Session 状态完全隔离', () => {
    it('一个会话取消不影响另一个正常终态', async () => {
      const fakeA = new FakeRecognizer();
      const fakeB = new FakeRecognizer();
      fakeB.partialScript = ['B 的假设'];
      fakeB.finalText = 'B 的最终';
      const { gateway } = createGateway([fakeA, fakeB]);
      const sessionA = gateway.beginStreaming({
        ...request,
        operationId: 'op-a',
        segmentId: 'seg-a',
      });
      const sessionB = gateway.beginStreaming({
        ...request,
        operationId: 'op-b',
        segmentId: 'seg-b',
      });
      const eventsA = collectEvents(sessionA);
      const eventsB = collectEvents(sessionB);
      sessionA.pushChunk(pcmChunk(0, 32_000, 1_000, 'op-a', 'seg-a'));
      sessionA.cancel();
      sessionB.pushChunk(pcmChunk(0, 32_000, 1_000, 'op-b', 'seg-b'));
      sessionB.finish();
      expect(await eventsA).toEqual([
        failedEvent(0, 'CANCELLED', 'op-a', 'seg-a'),
      ]);
      expect(await eventsB).toEqual([
        partialEvent(0, 'B 的假设', 'op-b', 'seg-b'),
        finalEvent(1, 'B 的最终', 'op-b', 'seg-b'),
      ]);
      // 各自 recognizer 独立释放
      expect(fakeA.freeCalls).toBe(1);
      expect(fakeB.freeCalls).toBe(1);
    });
  });

  describe('验收 15：公共导出不含 sherpa SDK 类型', () => {
    it('index.ts 不引用内部 recognizer 模块，只导出公共 Adapter', () => {
      const source = readFileSync(
        new URL('./index.ts', import.meta.url),
        'utf8',
      );
      expect(source).not.toContain('sherpa-streaming-recognizer');
      expect(source).not.toMatch(/SherpaStreamingRecognizer/);
      expect(source).toContain('SherpaStreamingTranscriptionGateway');
    });

    it('index 运行时导出集合不含 recognizer/工厂符号', () => {
      const keys = Object.keys(publicApi);
      expect(keys).toContain('SherpaStreamingTranscriptionGateway');
      expect(keys).not.toContain('SherpaStreamingRecognizer');
      expect(keys).not.toContain('SherpaStreamingRecognizerFactory');
    });
  });

  describe('验收 16：事件、错误与日志不含路径/PCM/stack/Secret', () => {
    it('识别异常只投影稳定码，错误消息即稳定码', async () => {
      const secret = 'sk-test-secret-12345';
      const modelPath = '/Users/secret/models/sherpa-int8.onnx';
      const logs: SherpaStreamingTranscriptionLogEntry[] = [];
      const fake = new FakeRecognizer();
      fake.decodeError = Object.assign(
        new Error(`${modelPath} pcm-decode-boom ${secret}`),
        { stack: `at ${modelPath}` },
      );
      const gateway = new SherpaStreamingTranscriptionGateway({
        recognizerFactory: factoryFor(fake),
        timeoutMs: 1_000,
        log: (entry) => logs.push(entry),
      });
      const session = gateway.beginStreaming(request);
      const eventsPromise = collectEvents(session);
      session.pushChunk(pcmChunk(0));
      const events = await eventsPromise;
      expect(events).toEqual([failedEvent(0, 'MODEL_FAILED')]);
      // 事件与日志序列化后不含敏感信息
      const serialized = JSON.stringify({ events, logs });
      expect(serialized).not.toContain(modelPath);
      expect(serialized).not.toContain('pcm-decode-boom');
      expect(serialized).not.toContain(secret);
      // 终态后动作抛稳定错误：message 只有稳定码
      assertRejected(
        () => session.pushChunk(pcmChunk(1)),
        'INPUT_AFTER_TERMINAL',
      );
      // 日志只有稳定标签与身份，无自由文本字段
      expect(logs.map((entry) => entry.label)).toEqual([
        'session_started',
        'session_ended',
        'input_rejected',
      ]);
      expect(logs.some((entry) => 'text' in entry)).toBe(false);
    });
  });
});
