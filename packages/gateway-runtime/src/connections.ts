import {
  gatewayConnectionConnectResultSchema,
  gatewayConnectionListSchema,
  gatewayConnectionProviderDescriptorSchema,
  gatewayConnectionRevokeResultSchema,
  type GatewayChannelConnection,
  type GatewayConnectionAuthorization,
  type GatewayConnectionConnectRequest,
  type GatewayConnectionConnectResult,
  type GatewayConnectionList,
  type GatewayConnectionProvider,
  type GatewayConnectionProviderDescriptor,
  type GatewayConnectionRevokeResult,
} from '@educanvas/gateway-core';

const ACTIVATION_TTL_MS = 10 * 60 * 1_000;

/** Connections 持久化 Port；实现必须在每次读取/撤销时按 userId 做租户隔离。 */
export interface GatewayConnectionRepositoryPort {
  list(userId: string): Promise<readonly GatewayChannelConnection[]>;
  begin(input: {
    provider: GatewayConnectionProvider;
    userId: string;
    conversationId: string;
    now: Date;
    activationExpiresAt: Date;
  }): Promise<GatewayChannelConnection>;
  revoke(input: {
    connectionId: string;
    userId: string;
    now: Date;
  }): Promise<GatewayChannelConnection>;
}

/** Provider 配置把产品目录与具体授权跳转留在组合根，不进入公共连接 DTO。 */
export interface GatewayConnectionProviderConfig {
  descriptor: GatewayConnectionProviderDescriptor;
  authorize?: (input: {
    connectionId: string;
    expiresAt: string;
  }) => GatewayConnectionAuthorization;
}

export class GatewayConnectionRuntimeError extends Error {
  constructor(
    readonly code: 'PROVIDER_DISABLED' | 'PROVIDER_NOT_CONFIGURED',
    message: string,
  ) {
    super(message);
    this.name = 'GatewayConnectionRuntimeError';
  }
}

/**
 * 构造当前正式 Provider 目录。Telegram 只有在公开 Bot username 合法时可发起；
 * 微信/QQ 在平台资格与凭据未落地前始终诚实 disabled，不创建虚假连接。
 */
export function createDefaultGatewayConnectionProviders(input: {
  telegramBotUsername?: string | null;
}): readonly GatewayConnectionProviderConfig[] {
  const candidate = input.telegramBotUsername?.trim().replace(/^@/, '') ?? '';
  const telegramBotUsername = /^[A-Za-z][A-Za-z0-9_]{2,28}[Bb][Oo][Tt]$/.test(
    candidate,
  )
    ? candidate
    : null;
  return [
    {
      descriptor: gatewayConnectionProviderDescriptorSchema.parse({
        provider: 'telegram',
        label: 'Telegram',
        availability: telegramBotUsername ? 'available' : 'disabled',
        disabledReason: telegramBotUsername
          ? null
          : '尚未配置 Telegram Bot，当前不能发起连接',
        experimental: true,
      }),
      ...(telegramBotUsername
        ? {
            authorize: (authorization: {
              connectionId: string;
              expiresAt: string;
            }) => ({
              kind: 'external_url' as const,
              url: `https://t.me/${telegramBotUsername}?start=educanvas_${authorization.connectionId}`,
              expiresAt: authorization.expiresAt,
            }),
          }
        : {}),
    },
    {
      descriptor: gatewayConnectionProviderDescriptorSchema.parse({
        provider: 'wechat',
        label: '微信',
        availability: 'disabled',
        disabledReason: '需要微信开放平台资格与正式凭据，当前尚未开放',
        experimental: false,
      }),
    },
    {
      descriptor: gatewayConnectionProviderDescriptorSchema.parse({
        provider: 'qq',
        label: 'QQ',
        availability: 'disabled',
        disabledReason: '需要 QQ 开放平台资格与正式凭据，当前尚未开放',
        experimental: false,
      }),
    },
  ];
}

/**
 * Provider-neutral Connections 用例服务。它只接受认证层传入的 userId，
 * 不接受客户端自报主体；授权有效期固定由服务端产生。
 */
export class GatewayConnectionService {
  private readonly providers: ReadonlyMap<
    GatewayConnectionProvider,
    GatewayConnectionProviderConfig
  >;

  constructor(
    private readonly repository: GatewayConnectionRepositoryPort,
    providerConfigs: readonly GatewayConnectionProviderConfig[],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.providers = new Map(
      providerConfigs.map((config) => [
        config.descriptor.provider,
        {
          ...config,
          descriptor: gatewayConnectionProviderDescriptorSchema.parse(
            config.descriptor,
          ),
        },
      ]),
    );
  }

  async list(userId: string): Promise<GatewayConnectionList> {
    return gatewayConnectionListSchema.parse({
      providers: [...this.providers.values()].map(
        (provider) => provider.descriptor,
      ),
      connections: await this.repository.list(userId),
    });
  }

  async connect(input: {
    userId: string;
    request: GatewayConnectionConnectRequest;
  }): Promise<GatewayConnectionConnectResult> {
    const provider = this.providers.get(input.request.provider);
    if (!provider) {
      throw new GatewayConnectionRuntimeError(
        'PROVIDER_NOT_CONFIGURED',
        'Connection provider is not configured',
      );
    }
    if (
      provider.descriptor.availability !== 'available' ||
      !provider.authorize
    ) {
      throw new GatewayConnectionRuntimeError(
        'PROVIDER_DISABLED',
        provider.descriptor.disabledReason ?? 'Connection provider is disabled',
      );
    }
    const now = this.now();
    const activationExpiresAt = new Date(now.getTime() + ACTIVATION_TTL_MS);
    const connection = await this.repository.begin({
      provider: input.request.provider,
      userId: input.userId,
      conversationId: input.request.conversationId,
      now,
      activationExpiresAt,
    });
    return gatewayConnectionConnectResultSchema.parse({
      connection,
      authorization: provider.authorize({
        connectionId: connection.connectionId,
        expiresAt: activationExpiresAt.toISOString(),
      }),
    });
  }

  async revoke(input: {
    userId: string;
    connectionId: string;
  }): Promise<GatewayConnectionRevokeResult> {
    return gatewayConnectionRevokeResultSchema.parse({
      connection: await this.repository.revoke({
        connectionId: input.connectionId,
        userId: input.userId,
        now: this.now(),
      }),
    });
  }
}
