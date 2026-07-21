'use client';

import {
  gatewayConnectionConnectResultSchema,
  gatewayConnectionListSchema,
  gatewayConnectionRevokeResultSchema,
  type GatewayChannelConnection,
  type GatewayConnectionAuthorization,
  type GatewayConnectionList,
  type GatewayConnectionProvider,
} from '@educanvas/gateway-core';
import {
  ArrowSquareOut,
  CheckCircle,
  Clock,
  LinkSimple,
  PlugsConnected,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

interface VisibleAuthorization extends GatewayConnectionAuthorization {
  provider: GatewayConnectionProvider;
}

const statusLabel: Record<GatewayChannelConnection['status'], string> = {
  pending: '等待确认',
  active: '已连接',
  revoked: '已撤销',
};

async function errorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    return typeof body.error?.message === 'string'
      ? body.error.message
      : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 用户连接控制面：只消费 provider-neutral DTO；外部账号、Adapter ID 和凭据永不进入组件。
 * provider disabled、请求失败和 pending 都有显式状态，不用假成功或无限 loading 掩盖。
 */
export function ConnectionSettings({
  conversationId,
  notebookTitle,
}: {
  conversationId: string;
  notebookTitle: string | null;
}) {
  const [data, setData] = useState<GatewayConnectionList | null>(null);
  const [authorization, setAuthorization] =
    useState<VisibleAuthorization | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const response = await fetch('/api/v1/connections', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(await errorMessage(response, '暂时无法读取连接。'));
    }
    const next = gatewayConnectionListSchema.parse(await response.json());
    setData(next);
  };

  useEffect(() => {
    let active = true;
    void fetch('/api/v1/connections', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await errorMessage(response, '暂时无法读取连接。'));
        }
        return gatewayConnectionListSchema.parse(await response.json());
      })
      .then((next) => {
        if (active) setData(next);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : '暂时无法读取连接。',
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const connect = async (provider: GatewayConnectionProvider) => {
    setBusyKey(`connect:${provider}`);
    setError(null);
    try {
      const response = await fetch('/api/v1/connections/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, conversationId }),
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, '暂时无法发起连接。'));
      }
      const result = gatewayConnectionConnectResultSchema.parse(
        await response.json(),
      );
      setAuthorization({ provider, ...result.authorization });
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法发起连接。');
    } finally {
      setBusyKey(null);
    }
  };

  const revoke = async (connectionId: string) => {
    setBusyKey(`revoke:${connectionId}`);
    setError(null);
    try {
      const response = await fetch('/api/v1/connections/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, '暂时无法撤销连接。'));
      }
      gatewayConnectionRevokeResultSchema.parse(await response.json());
      if (
        data?.connections.some(
          (connection) =>
            connection.connectionId === connectionId &&
            connection.provider === authorization?.provider,
        )
      ) {
        setAuthorization(null);
      }
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法撤销连接。');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="providers-heading">
        <div className="mb-4">
          <h2
            id="providers-heading"
            className="font-display text-xl font-semibold text-ink"
          >
            选择通信方式
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            消息会进入当前笔记本「{notebookTitle ?? '未命名笔记本'}
            」。来源渠道的回复仍回到原渠道。
          </p>
        </div>

        {data ? (
          <div className="grid gap-3 md:grid-cols-3">
            {data.providers.map((provider) => {
              const openConnection = data.connections.find(
                (connection) =>
                  connection.provider === provider.provider &&
                  connection.status !== 'revoked',
              );
              const disabled = provider.availability === 'disabled';
              return (
                <article
                  key={provider.provider}
                  className="rounded-3xl border border-line bg-card p-5 shadow-float"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid size-10 place-items-center rounded-2xl bg-accent-soft text-accent-strong">
                      <PlugsConnected aria-hidden="true" size={20} />
                    </span>
                    {provider.experimental ? (
                      <span className="rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn">
                        实验性
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-5 font-display text-lg font-semibold text-ink">
                    {provider.label}
                  </h3>
                  <p className="mt-2 min-h-12 text-sm leading-6 text-ink-muted">
                    {disabled
                      ? provider.disabledReason
                      : openConnection
                        ? `当前状态：${statusLabel[openConnection.status]}`
                        : '连接后，可以从这个渠道继续当前笔记本的对话。'}
                  </p>
                  <button
                    type="button"
                    disabled={
                      disabled || Boolean(openConnection) || busyKey !== null
                    }
                    onClick={() => void connect(provider.provider)}
                    className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-card transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-strong disabled:text-ink-faint"
                  >
                    <LinkSimple aria-hidden="true" size={16} />
                    {openConnection
                      ? statusLabel[openConnection.status]
                      : disabled
                        ? '暂不可用'
                        : busyKey === `connect:${provider.provider}`
                          ? '正在发起…'
                          : '连接'}
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-3xl border border-line bg-card p-6 text-sm text-ink-muted shadow-float">
            正在读取可用渠道…
          </div>
        )}
      </section>

      {authorization ? (
        <section className="rounded-3xl border border-accent bg-accent-soft p-5">
          <div className="flex gap-3">
            <ArrowSquareOut
              aria-hidden="true"
              size={22}
              className="mt-0.5 shrink-0 text-accent-strong"
            />
            <div>
              <h2 className="font-display text-base font-semibold text-ink">
                还差一步
              </h2>
              <p className="mt-1 text-sm leading-6 text-ink-muted">
                在十分钟内打开授权页面并向渠道发送预填的启动消息。完成后回到这里即可看到“已连接”。
              </p>
              <a
                href={authorization.url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-card hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                前往完成连接
                <ArrowSquareOut aria-hidden="true" size={15} />
              </a>
            </div>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="connections-heading">
        <h2
          id="connections-heading"
          className="font-display text-xl font-semibold text-ink"
        >
          已发起的连接
        </h2>
        <div className="mt-4 overflow-hidden rounded-3xl border border-line bg-card shadow-float">
          {data?.connections.length ? (
            <ul className="divide-y divide-line">
              {data.connections.map((connection) => {
                const provider = data.providers.find(
                  (candidate) => candidate.provider === connection.provider,
                );
                const StatusIcon =
                  connection.status === 'active'
                    ? CheckCircle
                    : connection.status === 'pending'
                      ? Clock
                      : XCircle;
                return (
                  <li
                    key={connection.connectionId}
                    className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"
                  >
                    <StatusIcon
                      aria-hidden="true"
                      size={22}
                      className={
                        connection.status === 'revoked'
                          ? 'text-cinnabar'
                          : 'text-accent'
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">
                        {provider?.label ?? connection.provider}
                      </p>
                      <p className="mt-0.5 text-sm text-ink-muted">
                        {statusLabel[connection.status]} · 发起于{' '}
                        {new Date(connection.createdAt).toLocaleString('zh-CN')}
                      </p>
                    </div>
                    {connection.status !== 'revoked' ? (
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() => void revoke(connection.connectionId)}
                        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-cinnabar px-3.5 text-sm font-medium text-cinnabar transition-colors hover:bg-cinnabar-soft disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <XCircle aria-hidden="true" size={15} />
                        {busyKey === `revoke:${connection.connectionId}`
                          ? '正在撤销…'
                          : '撤销'}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex gap-3 p-6 text-sm text-ink-muted">
              <WarningCircle
                aria-hidden="true"
                size={20}
                className="shrink-0 text-ink-faint"
              />
              还没有连接任何通信方式。
            </div>
          )}
        </div>
      </section>

      {error ? (
        <p
          role="alert"
          className="rounded-2xl bg-cinnabar-soft px-4 py-3 text-sm text-cinnabar-strong"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
