import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  VIDEO_KEYFRAME_COUNT,
  VideoProcessingError,
  extractVideoAudioTrack,
  extractVideoKeyframes,
  probeVideoFile,
  resolveVideoToolchain,
  withVideoWorkspace,
} from './video-processing';

const run = promisify(execFile);
const toolchain = resolveVideoToolchain();

/** 没有工具链的环境跳过而不是失败：它是部署依赖，不是代码缺陷。 */
async function hasToolchain(): Promise<boolean> {
  try {
    await run(toolchain.ffmpegPath, ['-version'], { timeout: 10_000 });
    await run(toolchain.ffprobePath, ['-version'], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const toolchainAvailable = await hasToolchain();
const describeWithToolchain = toolchainAvailable ? describe : describe.skip;

describeWithToolchain('视频派生（真实 ffmpeg fixture）', () => {
  let fixtureDirectory = '';
  let withAudioPath = '';
  let withoutAudioPath = '';

  beforeAll(async () => {
    fixtureDirectory = await mkdtemp(
      path.join(tmpdir(), 'educanvas-video-fixture-'),
    );
    withAudioPath = path.join(fixtureDirectory, 'with-audio.mp4');
    withoutAudioPath = path.join(fixtureDirectory, 'silent.mp4');

    /* 合成 fixture 而不是往仓库里放二进制：既避免未授权素材，也让分辨率、
       时长和有无音轨这些被测边界成为显式参数。 */
    await run(
      toolchain.ffmpegPath,
      [
        '-nostdin',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x240:rate=10:duration=4',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=4',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        withAudioPath,
      ],
      { timeout: 120_000 },
    );
    await run(
      toolchain.ffmpegPath,
      [
        '-nostdin',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x240:rate=10:duration=4',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        withoutAudioPath,
      ],
      { timeout: 120_000 },
    );
  }, 240_000);

  afterAll(async () => {
    await rm(fixtureDirectory, { recursive: true, force: true });
  });

  it('探测出时长、分辨率与音轨存在性', async () => {
    const metadata = await probeVideoFile(withAudioPath, toolchain);

    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);
    expect(metadata.durationSeconds).toBeGreaterThan(3);
    expect(metadata.durationSeconds).toBeLessThan(6);
    expect(metadata.hasAudioTrack).toBe(true);

    const silent = await probeVideoFile(withoutAudioPath, toolchain);
    expect(silent.hasAudioTrack).toBe(false);
  }, 60_000);

  it('损坏文件按 video_probe_failed 终结，不抛原始 ffprobe 输出', async () => {
    const brokenPath = path.join(fixtureDirectory, 'broken.mp4');
    await run(
      'sh',
      [
        '-c',
        `head -c 512 ${JSON.stringify(withAudioPath)} > ${JSON.stringify(brokenPath)}`,
      ],
      { timeout: 30_000 },
    );

    const error = await probeVideoFile(brokenPath, toolchain).catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(VideoProcessingError);
    expect((error as VideoProcessingError).code).toBe('video_probe_failed');
    expect((error as Error).message).not.toContain(brokenPath);
  }, 60_000);

  it('提取的音轨是可用的单声道 MP3', async () => {
    const bytes = new Uint8Array(await readFile(withAudioPath));

    const audio = await withVideoWorkspace(bytes, 'mp4', (workspace) =>
      extractVideoAudioTrack(workspace, toolchain),
    );

    expect(audio.byteLength).toBeGreaterThan(0);
    /* MP3 帧同步字或 ID3 头，二选一即可证明容器正确。 */
    expect(
      audio[0] === 0x49 || (audio[0] === 0xff && (audio[1]! & 0xe0) === 0xe0),
    ).toBe(true);
  }, 120_000);

  it('按等间隔抽出确定数量的关键帧，且同一输入结果稳定', async () => {
    const bytes = new Uint8Array(await readFile(withAudioPath));
    const extract = () =>
      withVideoWorkspace(bytes, 'mp4', (workspace) =>
        extractVideoKeyframes({ ...workspace, durationSeconds: 4 }, toolchain),
      );

    const first = await extract();
    const second = await extract();

    expect(first).toHaveLength(VIDEO_KEYFRAME_COUNT);
    expect(first.map((frame) => frame.ordinal)).toEqual([1, 2, 3, 4]);
    expect(first.map((frame) => frame.timestampSeconds)).toEqual(
      second.map((frame) => frame.timestampSeconds),
    );
    for (const frame of first) {
      /* JPEG SOI */
      expect(frame.bytes[0]).toBe(0xff);
      expect(frame.bytes[1]).toBe(0xd8);
    }
  }, 120_000);

  it('无论成功还是失败都不残留临时目录', async () => {
    const before = (await readdir(tmpdir())).filter((entry) =>
      entry.startsWith('educanvas-video-'),
    );

    const bytes = new Uint8Array(await readFile(withAudioPath));
    await withVideoWorkspace(bytes, 'mp4', async () => undefined);
    await expect(
      withVideoWorkspace(bytes, 'mp4', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const after = (await readdir(tmpdir())).filter((entry) =>
      entry.startsWith('educanvas-video-'),
    );
    expect(after).toEqual(before);
  }, 60_000);

  it('缺失工具链以稳定失败码报告，不是崩溃', async () => {
    const error = await probeVideoFile(withAudioPath, {
      ffmpegPath: '/nonexistent/ffmpeg',
      ffprobePath: '/nonexistent/ffprobe',
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(VideoProcessingError);
    expect((error as VideoProcessingError).code).toBe(
      'video_toolchain_unavailable',
    );
  }, 30_000);
});
