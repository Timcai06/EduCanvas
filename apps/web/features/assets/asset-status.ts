export interface AssetStatusView {
  id: string;
  label: string;
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'tombstoned';
  processing: {
    failureCode: string | null;
    createdAt: string;
  } | null;
}

export interface AssetStatusNotice {
  assetId: string;
  tone: 'success' | 'error';
  message: string;
}

const PROCESSING_STALL_MS = 2 * 60_000;

/** 稳定失败码到用户文案的唯一映射；未知码一律退化，绝不展示服务端原文。 */
export function assetFailureMessage(failureCode: string | null): string {
  switch (failureCode) {
    case 'pdf_text_unavailable':
      return 'PDF没有可提取的文字，可能是扫描件';
    case 'text_content_unavailable':
      return '文件没有可读取的文字或编码不受支持';
    case 'unsupported_media_type':
      return '暂不支持这种文件格式';
    case 'asset_processing_exhausted':
      return '处理服务多次尝试后仍未完成';
    case 'unsupported_audio_type':
      return '暂不支持这种音频格式';
    case 'audio_input_too_large':
      return '音频文件超过处理上限';
    case 'audio_metadata_unavailable':
      return '无法读取音频格式或时长';
    case 'audio_duration_exceeded':
      return '音频时长超过60分钟';
    case 'invalid_response':
      return '转录服务返回了无法使用的结果';
    case 'unsupported_video_type':
      return '暂不支持这种视频格式';
    case 'video_input_too_large':
      return '视频文件超过处理上限';
    case 'video_metadata_unavailable':
    case 'video_probe_failed':
      return '无法读取视频格式或媒体信息';
    case 'video_duration_exceeded':
      return '视频时长超过20分钟';
    case 'video_resolution_exceeded':
      return '视频分辨率超过1080p处理上限';
    case 'video_toolchain_unavailable':
      return '视频处理服务尚未配置';
    default:
      return '文件处理失败';
  }
}

export function assetProcessingMessage(
  createdAt: string | null,
  now = Date.now(),
): string {
  if (!createdAt) return '处理中';
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created) || now - created < PROCESSING_STALL_MS) {
    return '处理中';
  }
  return '处理时间较长，可稍后刷新或重新上传';
}

/** 只报告本次轮询中新发生的 processing -> terminal 转换，初次加载不制造旧通知。 */
export function detectAssetStatusNotices(
  previous: readonly AssetStatusView[],
  next: readonly AssetStatusView[],
): readonly AssetStatusNotice[] {
  const previousById = new Map(previous.map((asset) => [asset.id, asset]));
  const notices: AssetStatusNotice[] = [];
  for (const asset of next) {
    const before = previousById.get(asset.id);
    if (
      !before ||
      (before.status !== 'pending' && before.status !== 'processing')
    ) {
      continue;
    }
    if (asset.status === 'ready') {
      notices.push({
        assetId: asset.id,
        tone: 'success',
        message: `“${asset.label}”已处理完成，可以用于对话。`,
      });
      continue;
    }
    if (asset.status === 'failed') {
      notices.push({
        assetId: asset.id,
        tone: 'error',
        message: `“${asset.label}”处理失败：${assetFailureMessage(
          asset.processing?.failureCode ?? null,
        )}。`,
      });
    }
  }
  return notices;
}
