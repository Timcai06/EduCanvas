/**
 * V13 流式转录资源配额 — 集中、可审查、fail-closed 的单一配额源。
 *
 * ## 设计原则
 *
 * - 所有上限是**服务端命名常量**，客户端无法覆盖（握手与连接内都不接受
 *   任何客户端传入的限额字段，V07 strict schema 已拒绝额外键）；
 * - 允许环境变量覆盖，但任何非法值（非整数、越界、idle > duration）都使
 *   启动失败（fail-closed），不允许"宽松配置跑起来"；
 * - 数值以"课堂短时语音片段 + 单机 Gateway"为基线取保守值，理由见各常量
 *   注释；多实例/多用户部署的调优方向见 docs/plan/active/UV-画布语音.md
 *   V13 一节。
 *
 * ## 基线计算
 *
 * 音频速率冻结为 16 kHz × 1 ch × 2 字节 = 32 000 B/s（V04 常量）。课堂
 * 短句 3–15 秒，连续听写一段通常 3–5 分钟。单机 Gateway 每并发 WASM
 * recognizer 占用可观内存（sherpa-onnx streaming 模型数百 MB 级）。
 */

/** 单连接级配额与全局并发配额。 */
export interface StreamingTranscriptionQuotas {
  /** 单用户同时打开的流式连接数上限。 */
  maxConnectionsPerUser: number;
  /** 单用户+Notebook 组合的连接数上限（防同用户多标签页/重复连接）。 */
  maxConnectionsPerNotebook: number;
  /** 全局同时打开的 WebSocket 连接数上限（REVISE：连接槽独立于 recognizer 槽）。 */
  maxConnectionsGlobal: number;
  /** 全局并发 Session/recognizer 槽上限，防不同用户共同耗尽进程内存。 */
  maxActiveSessionsGlobal: number;
  /** 单连接最大持续时间（含等待 start 的空闲阶段）。 */
  maxSessionDurationMs: number;
  /** 单连接最大空闲时间（距最后一条 client 消息）。 */
  maxSessionIdleMs: number;
  /** 单连接累计 PCM 字节上限。 */
  maxPcmBytesPerConnection: number;
  /** 单连接累计 chunk 数上限。 */
  maxChunksPerConnection: number;
  /** 待处理输入消息队列上限（同一事件循环批次内突发帧的防御上限）。 */
  maxQueuedInputMessages: number;
  /** 服务端待发送字节（ws.bufferedAmount）上限。 */
  maxOutputBufferedBytes: number;
}

/**
 * 默认配额。以课堂基线取保守值；未来调优应改这里 + 工程文档，而不是在
 * 运行时放宽（见 README 与计划文档）。
 */
export const STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS: StreamingTranscriptionQuotas =
  {
    // 2：V17 短句模式与课堂字幕共用一条连接，2 已覆盖"一条在用 + 一条
    // 重连窗口"；课堂 40+ 学生场景由全局上限兜底，超 2 基本是客户端异常。
    maxConnectionsPerUser: 2,
    // 2：同一用户同一 Notebook 至多 2 条；多标签页/重复握手立即拒绝。
    maxConnectionsPerNotebook: 2,
    // 32：全局同时打开的 WebSocket 连接上限（REVISE 拆分后连接槽独立）：
    // 连接可空转（未 start 不占 recognizer），连接上限宽于 recognizer 上
    // 限；单机课堂规模 32 条并发连接已保守，防不同用户各开多连接耗尽
    // socket 描述符与事件循环。
    maxConnectionsGlobal: 32,
    // 8：单机 Gateway + WASM 单模型实例，每并发 recognizer 数百 MB 内存；
    // 8 个并发已保守，超出拒绝（多实例部署时按内存调大）。这是 recognizer
    // 槽上限：Session 终态形成即释放，与连接是否关闭解耦（REVISE）。
    maxActiveSessionsGlobal: 8,
    // 10 分钟：课堂连续听写一段通常 3–5 分钟；超过视为异常占用（含不发
    // start 的空转连接），duration 到期强制收敛。
    maxSessionDurationMs: 600_000,
    // 60 秒：与 ticket TTL 同量级；浏览器静默 60 秒视为放弃，防僵尸连接
    // 占槽；必须小于 duration，避免 idle 与 duration 竞争顺序不确定。
    maxSessionIdleMs: 60_000,
    // 60 秒 × 32 000 B/s = 1 920 000：课堂短句 3–15 秒，60 秒累计音频
    // 已是宽松上限，超过视为异常流（循环回放/恶意灌流）。
    maxPcmBytesPerConnection: 1_920_000,
    // 4096：60 秒 × 68 chunk/s 余量（浏览器 100 ms 分块仅 10 chunk/s）；
    // 上限防恶意把音频切成 2 字节小片刷计数绕过字节上限。
    maxChunksPerConnection: 4_096,
    // 64：正常同步处理队列恒为空，64 只作同一批次突发帧的防御上限。
    maxQueuedInputMessages: 64,
    // 256 KiB：ws.send 排队字节超过 256 KiB 说明客户端读取过慢；持续积压
    // partial 会拖垮事件循环与内存，必须稳定失败而非无限缓冲。
    maxOutputBufferedBytes: 256 * 1024,
  };

/** 各配额环境变量的合法区间（fail-closed 校验用）。 */
const QUOTA_BOUNDS: Record<
  Exclude<keyof StreamingTranscriptionQuotas, 'maxPcmBytesPerConnection'>,
  readonly [min: number, max: number]
> = {
  maxConnectionsPerUser: [1, 64],
  maxConnectionsPerNotebook: [1, 64],
  maxConnectionsGlobal: [1, 1_024],
  maxActiveSessionsGlobal: [1, 1_024],
  maxSessionDurationMs: [10_000, 3_600_000],
  maxSessionIdleMs: [1_000, 600_000],
  maxChunksPerConnection: [1, 1_000_000],
  maxQueuedInputMessages: [1, 1_000],
  maxOutputBufferedBytes: [1, 64 * 1024 * 1024],
};

/** PCM 字节上限独立区间：至少 1 秒音频，至多 1 GiB。 */
const PCM_BYTES_BOUNDS: readonly [number, number] = [
  32_000,
  1024 * 1024 * 1024,
];

const QUOTA_ENV_NAMES: Record<keyof StreamingTranscriptionQuotas, string> = {
  maxConnectionsPerUser: 'EDUCANVAS_GATEWAY_STREAMING_MAX_CONNECTIONS_PER_USER',
  maxConnectionsPerNotebook:
    'EDUCANVAS_GATEWAY_STREAMING_MAX_CONNECTIONS_PER_NOTEBOOK',
  maxConnectionsGlobal: 'EDUCANVAS_GATEWAY_STREAMING_MAX_CONNECTIONS_GLOBAL',
  maxActiveSessionsGlobal:
    'EDUCANVAS_GATEWAY_STREAMING_MAX_ACTIVE_SESSIONS_GLOBAL',
  maxSessionDurationMs: 'EDUCANVAS_GATEWAY_STREAMING_MAX_SESSION_DURATION_MS',
  maxSessionIdleMs: 'EDUCANVAS_GATEWAY_STREAMING_MAX_SESSION_IDLE_MS',
  maxPcmBytesPerConnection:
    'EDUCANVAS_GATEWAY_STREAMING_MAX_PCM_BYTES_PER_CONNECTION',
  maxChunksPerConnection:
    'EDUCANVAS_GATEWAY_STREAMING_MAX_CHUNKS_PER_CONNECTION',
  maxQueuedInputMessages:
    'EDUCANVAS_GATEWAY_STREAMING_MAX_QUEUED_INPUT_MESSAGES',
  maxOutputBufferedBytes:
    'EDUCANVAS_GATEWAY_STREAMING_MAX_OUTPUT_BUFFERED_BYTES',
};

function readBoundedInt(
  env: NodeJS.ProcessEnv,
  key: keyof StreamingTranscriptionQuotas,
): number | null {
  const raw = env[QUOTA_ENV_NAMES[key]]?.trim();
  if (raw === undefined || raw === '') return null;
  // 只接受十进制正整数：拒绝 0x/科学计数/小数等非规范格式，与错误消息的
  // "必须是整数"承诺一致（fail-closed 不因解析宽容而放宽）。
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${QUOTA_ENV_NAMES[key]} 必须是正整数（当前值 ${raw}）`);
  }
  const value = Number(raw);
  const [min, max] =
    key === 'maxPcmBytesPerConnection' ? PCM_BYTES_BOUNDS : QUOTA_BOUNDS[key];
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `${QUOTA_ENV_NAMES[key]} 必须是 ${min}..${max} 的整数（当前值 ${raw}）`,
    );
  }
  return value;
}

/**
 * 读取配额配置：未设置的环境变量用默认值，任何非法值直接抛错（启动
 * 失败，fail-closed）。额外校验 idle 必须小于 duration，避免两个 deadline
 * 的触发顺序不确定。
 */
export function readStreamingTranscriptionQuotas(
  env: NodeJS.ProcessEnv = process.env,
): StreamingTranscriptionQuotas {
  const defaults = STREAMING_TRANSCRIPTION_DEFAULT_QUOTAS;
  const quotas: StreamingTranscriptionQuotas = {
    maxConnectionsPerUser:
      readBoundedInt(env, 'maxConnectionsPerUser') ??
      defaults.maxConnectionsPerUser,
    maxConnectionsPerNotebook:
      readBoundedInt(env, 'maxConnectionsPerNotebook') ??
      defaults.maxConnectionsPerNotebook,
    maxConnectionsGlobal:
      readBoundedInt(env, 'maxConnectionsGlobal') ??
      defaults.maxConnectionsGlobal,
    maxActiveSessionsGlobal:
      readBoundedInt(env, 'maxActiveSessionsGlobal') ??
      defaults.maxActiveSessionsGlobal,
    maxSessionDurationMs:
      readBoundedInt(env, 'maxSessionDurationMs') ??
      defaults.maxSessionDurationMs,
    maxSessionIdleMs:
      readBoundedInt(env, 'maxSessionIdleMs') ?? defaults.maxSessionIdleMs,
    maxPcmBytesPerConnection:
      readBoundedInt(env, 'maxPcmBytesPerConnection') ??
      defaults.maxPcmBytesPerConnection,
    maxChunksPerConnection:
      readBoundedInt(env, 'maxChunksPerConnection') ??
      defaults.maxChunksPerConnection,
    maxQueuedInputMessages:
      readBoundedInt(env, 'maxQueuedInputMessages') ??
      defaults.maxQueuedInputMessages,
    maxOutputBufferedBytes:
      readBoundedInt(env, 'maxOutputBufferedBytes') ??
      defaults.maxOutputBufferedBytes,
  };
  if (quotas.maxSessionIdleMs >= quotas.maxSessionDurationMs) {
    throw new Error(
      'EDUCANVAS_GATEWAY_STREAMING_MAX_SESSION_IDLE_MS 必须小于 MAX_SESSION_DURATION_MS',
    );
  }
  return quotas;
}

/**
 * V13 稳定配额错误码（封闭集合，遵循仓库大写蛇形协议风格）。连接建立前
 * 的 CONNECTION_LIMIT_EXCEEDED 以 HTTP 429 表达；连接内配额违约以
 * `{ error: { code } }` 错误帧 + close(1008) 表达，且绝不携带内部容量、
 * 路径或原始错误。
 */
export const streamingTranscriptionQuotaErrorCodes = [
  'CONNECTION_LIMIT_EXCEEDED',
  'SESSION_LIMIT_EXCEEDED',
  'SESSION_DURATION_EXCEEDED',
  'SESSION_IDLE_TIMEOUT',
  'INPUT_BYTE_LIMIT_EXCEEDED',
  'INPUT_CHUNK_LIMIT_EXCEEDED',
  'INPUT_BACKPRESSURE_EXCEEDED',
  'OUTPUT_BACKPRESSURE_EXCEEDED',
] as const;

export type StreamingTranscriptionQuotaErrorCode =
  (typeof streamingTranscriptionQuotaErrorCodes)[number];
