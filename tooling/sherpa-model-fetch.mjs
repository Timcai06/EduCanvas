#!/usr/bin/env node
/**
 * sherpa WASM 流式转录模型的按需获取安装脚本（V09-C）。
 *
 * 模型权重不进仓库（CLAUDE.md 纪律）：本脚本按 manifest 白名单下载、校验并
 * 原子安装两个受控 profile（480ms / 1920ms）。所有 URL 与 SHA-256 来自
 * `tooling/sherpa-model-manifest.json`（唯一事实源，V09-B 冻结），未知 profile
 * 显式拒绝，绝不猜测下载来源。
 *
 * ## 安装契约
 *
 * - **dry-run**（`--dry-run`）：只报告计划动作，零网络、零文件写入；
 * - 只允许 manifest 内的 HTTPS URL；下载到 staging 临时文件，先验证 archive
 *   SHA-256，再安全解压（拒绝绝对路径、`..`、symlink），校验全部必需文件
 *   及其 SHA-256，从 bpe.model 派生 bpe.vocab 并校验，最后原子 rename 到
 *   目标目录；任一步失败即清理 staging，不留下「看似可用」的半模型目录；
 * - **幂等**：目标模型目录已存在且全部校验通过时直接返回，不重复下载；
 *   已存在但不完整时视为半成品残留，先删除再重装（打印警告）；
 * - 输出不含 Secret 与完整宿主路径（只打印目标目录名与 profile 摘要）。
 *
 * 用法：
 *   node tooling/sherpa-model-fetch.mjs --profile 480ms --target /path/to/models
 *   node tooling/sherpa-model-fetch.mjs --profile 480ms --target /path/to/models --dry-run
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { get } from 'node:https';

const require = createRequire(import.meta.url);
const manifestPath = new URL('./sherpa-model-manifest.json', import.meta.url);
const { profiles } = require(manifestPath.pathname);

/** 安装结果：幂等跳过 / 成功安装 / 失败（失败信息只含稳定原因）。 */
export class SherpaModelFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SherpaModelFetchError';
  }
}

/** 计算文件 SHA-256（十六进制小写）。 */
export async function sha256File(filePath) {
  const { createReadStream } = await import('node:fs');
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** 只允许 manifest 内 HTTPS URL：任何其他来源直接拒绝（白名单纪律）。 */
export function assertManifestUrl(profile) {
  const { url } = profile.archive;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new SherpaModelFetchError('invalid_manifest_url');
  }
  if (parsed.protocol !== 'https:') {
    throw new SherpaModelFetchError('non_https_manifest_url');
  }
}

/**
 * 校验 tar 条目安全：拒绝绝对路径、盘符、`..` 与 symlink 条目（解压器对
 * symlink 的破坏面最大——指向外部路径的链接会在后续校验中被跳过）。
 * 返回条目名列表（去尾斜杠）。
 */
export function assertSafeTarEntries(entries) {
  const names = [];
  for (const entry of entries) {
    const raw = entry.replace(/\/+$/, '');
    if (raw === '') continue;
    if (raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)) {
      throw new SherpaModelFetchError('tar_entry_absolute_path');
    }
    const parts = raw.split(/[\\/]+/);
    if (parts.some((part) => part === '..')) {
      throw new SherpaModelFetchError('tar_entry_parent_traversal');
    }
    names.push(raw);
  }
  return names;
}

/** 解压后目录内不得出现 symlink（防御 tar 中预置的符号链接条目）。 */
async function assertNoSymlinks(dirPath, entries) {
  for (const entry of entries) {
    const full = resolve(dirPath, entry);
    if (!full.startsWith(resolve(dirPath) + sep)) {
      throw new SherpaModelFetchError('extracted_path_escape');
    }
    const info = await lstat(full).catch(() => null);
    if (info === null)
      throw new SherpaModelFetchError('extracted_entry_missing');
    if (info.isSymbolicLink()) {
      throw new SherpaModelFetchError('extracted_symlink');
    }
  }
}

/** 校验解压后的模型目录：必需文件存在且 SHA-256 全部匹配。 */
export async function verifyModelDirectory(
  modelDir,
  profile,
  sha256 = sha256File,
  { includeDerived = true } = {},
) {
  const required = Object.keys(profile.files).filter(
    (name) => includeDerived || name !== 'bpe.vocab',
  );
  for (const name of required) {
    const filePath = join(modelDir, name);
    const info = await stat(filePath).catch(() => null);
    if (info === null || !info.isFile()) {
      return { complete: false, reason: `missing_file:${name}` };
    }
    const actual = await sha256(filePath);
    if (actual !== profile.files[name]) {
      return { complete: false, reason: `checksum_mismatch:${name}` };
    }
  }
  return { complete: true, reason: null };
}

/** 下载（https）到临时文件；非 200 抛稳定错误，网络层错误原样上抛由外层归一化。 */
export async function downloadArchive(
  url,
  destPath,
  getRequest = get,
  redirectsRemaining = 5,
) {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = getRequest(url, (response) => {
      if (
        [301, 302, 303, 307, 308].includes(response.statusCode) &&
        response.headers.location
      ) {
        response.resume();
        if (redirectsRemaining <= 0) {
          rejectPromise(new SherpaModelFetchError('download_redirect_limit'));
          return;
        }
        let redirectUrl;
        try {
          redirectUrl = new URL(response.headers.location, url);
        } catch {
          rejectPromise(new SherpaModelFetchError('download_redirect_invalid'));
          return;
        }
        if (redirectUrl.protocol !== 'https:') {
          rejectPromise(
            new SherpaModelFetchError('download_redirect_non_https'),
          );
          return;
        }
        downloadArchive(
          redirectUrl.href,
          destPath,
          getRequest,
          redirectsRemaining - 1,
        ).then(resolvePromise, rejectPromise);
        return;
      }
      if (response.statusCode !== 200) {
        rejectPromise(new SherpaModelFetchError('download_status_not_ok'));
        response.resume();
        return;
      }
      const fileStream = createWriteStream(destPath);
      response.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolvePromise();
      });
      fileStream.on('error', (error) => {
        fileStream.destroy();
        rejectPromise(error);
      });
    });
    request.on('error', (error) => rejectPromise(error));
    request.setTimeout(300_000, () => {
      request.destroy(new SherpaModelFetchError('download_timeout'));
    });
  });
}

/** 列出 tar.bz2 条目（不展开内容）。 */
export async function listTarEntries(archivePath) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync('tar', ['-tjf', archivePath], {
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.split('\n').filter((line) => line.trim() !== '');
}

/** 解压 tar.bz2 到目标目录。 */
export async function extractTar(archivePath, destDir) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  await execFileAsync('tar', ['-xjf', archivePath, '-C', destDir]);
}

/** 从 bpe.model 派生 bpe.vocab（与 manifest 冻结的 SHA-256 对应）。 */
async function generateBpeVocab(bpeModelPath, destPath) {
  const { bpeModelToVocab } = await import('./bpe-vocab-export.mjs');
  const buffer = await readFile(bpeModelPath);
  await writeFile(destPath, bpeModelToVocab(buffer), 'utf8');
}

/** 汇总安装计划（dry-run 与正式模式共用，保证输出一致）；不打印完整宿主路径。 */
function planFor(profile, dryRun) {
  return {
    profile: profile.profileId,
    action: dryRun ? 'plan' : 'install',
    target: profile.directory,
    archiveBytes: profile.archive.bytes,
  };
}

/**
 * 安装指定 profile 到 targetDir。默认实现全部真实（网络、tar、文件系统）；
 * 测试可注入 `overrides` 关闭网络或伪造文件系统。
 *
 * @returns {{ status: 'installed' | 'already-installed' | 'dry-run', targetDir: string }}
 */
export async function installSherpaModelProfile(
  profileId,
  targetDir,
  overrides = {},
) {
  const profile = profiles[profileId];
  if (profile === undefined) {
    throw new SherpaModelFetchError('unknown_profile');
  }
  assertManifestUrl(profile);

  const log = overrides.log ?? ((message) => console.log(message));
  const dryRun = overrides.dryRun ?? false;
  const download = overrides.download ?? downloadArchive;
  const listTar = overrides.listTarEntries ?? listTarEntries;
  const extract = overrides.extractTar ?? extractTar;
  const sha256 = overrides.sha256File ?? sha256File;
  const remove = overrides.rm ?? rm;
  const mkdirFn = overrides.mkdir ?? mkdir;

  // dry-run 在一切副作用之前返回：不创建目录、不发起网络、不写文件。
  if (dryRun) {
    log(
      `[sherpa-model-fetch] dry-run: ${JSON.stringify(planFor(profile, true))}`,
    );
    return { status: 'dry-run', targetDir };
  }

  await mkdirFn(targetDir, { recursive: true });

  const modelDir = join(targetDir, profile.directory);
  const existing = await verifyModelDirectory(modelDir, profile, sha256);
  if (existing.complete) {
    log(`[sherpa-model-fetch] already installed: ${profile.profileId}`);
    return { status: 'already-installed', targetDir };
  }
  // 目录存在但不完整 → 半成品残留，先删除再重装；完全不存在则直接安装。
  const modelDirExists = await stat(modelDir).catch(() => null);
  if (modelDirExists !== null) {
    log(
      `[sherpa-model-fetch] warning: removing incomplete model directory for ${profile.profileId}`,
    );
    await remove(modelDir, { recursive: true, force: true });
  }

  // staging 目录内完成下载与全部校验；任何失败都在 finally 中清理。
  const stagingRoot = await mkdtemp(
    join(targetDir, `.${profile.directory}.tmp-`),
  );
  let stagingModelDir = null;
  try {
    const archivePath = join(stagingRoot, 'model.tar.bz2');
    log(
      `[sherpa-model-fetch] downloading ${profile.profileId} (${profile.archive.bytes} bytes)`,
    );
    await download(profile.archive.url, archivePath);
    const actualArchive = await sha256(archivePath);
    if (actualArchive !== profile.archive.sha256) {
      throw new SherpaModelFetchError('archive_checksum_mismatch');
    }

    const entries = await assertSafeTarEntries(await listTar(archivePath));
    await extract(archivePath, stagingRoot);
    await assertNoSymlinks(stagingRoot, entries);

    stagingModelDir = join(stagingRoot, profile.directory);
    // 官方 archive 不含派生的 bpe.vocab：先只校验 archive 交付文件，
    // 再由已校验的 bpe.model 生成词表，最后对完整安装目录做第二次校验。
    const archiveVerification = await verifyModelDirectory(
      stagingModelDir,
      profile,
      sha256,
      { includeDerived: false },
    );
    if (!archiveVerification.complete) {
      throw new SherpaModelFetchError(`staging_${archiveVerification.reason}`);
    }

    const bpeVocabPath = join(stagingModelDir, 'bpe.vocab');
    await generateBpeVocab(join(stagingModelDir, 'bpe.model'), bpeVocabPath);
    const vocabHash = await sha256(bpeVocabPath);
    if (vocabHash !== profile.files['bpe.vocab']) {
      throw new SherpaModelFetchError('bpe_vocab_checksum_mismatch');
    }
    const completeVerification = await verifyModelDirectory(
      stagingModelDir,
      profile,
      sha256,
    );
    if (!completeVerification.complete) {
      throw new SherpaModelFetchError(`staging_${completeVerification.reason}`);
    }
    // bpe.vocab 由脚本派生：只读文件权限，防止被当作部署方文件误改。
    await chmod(bpeVocabPath, 0o444);

    // 原子发布：rename 到最终目录。目标已存在（不完整残留）时先清理；
    // rename 跨目录在同一文件系统内是原子的。
    await mkdirFn(targetDir, { recursive: true });
    if (stagingModelDir !== modelDir) {
      const info = await stat(modelDir).catch(() => null);
      if (info !== null) {
        await remove(modelDir, { recursive: true, force: true });
      }
      await rename(stagingModelDir, modelDir);
    }
    await remove(stagingRoot, { recursive: true, force: true });
    log(`[sherpa-model-fetch] installed: ${profile.profileId}`);
    return { status: 'installed', targetDir };
  } catch (error) {
    await remove(stagingRoot, { recursive: true, force: true }).catch(() => {});
    if (error instanceof SherpaModelFetchError) throw error;
    throw new SherpaModelFetchError('install_failed');
  }
}

/** CLI 入口：--profile <id> --target <dir> [--dry-run]。 */
async function main() {
  const args = process.argv.slice(2);
  const profileIndex = args.indexOf('--profile');
  const targetIndex = args.indexOf('--target');
  if (profileIndex === -1 || targetIndex === -1) {
    console.error(
      'usage: sherpa-model-fetch.mjs --profile <480ms|1920ms> --target <dir> [--dry-run]',
    );
    process.exit(2);
  }
  const profileId = args[profileIndex + 1];
  const targetDir = resolve(args[targetIndex + 1]);
  if (!['480ms', '1920ms'].includes(profileId)) {
    console.error('[sherpa-model-fetch] unknown profile');
    process.exit(2);
  }
  const dryRun = args.includes('--dry-run');
  try {
    const result = await installSherpaModelProfile(profileId, targetDir, {
      dryRun,
    });
    if (result.status === 'dry-run') {
      console.log(
        '[sherpa-model-fetch] dry-run complete: no files written, no network used',
      );
    }
  } catch (error) {
    console.error(`[sherpa-model-fetch] ${error.message}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
