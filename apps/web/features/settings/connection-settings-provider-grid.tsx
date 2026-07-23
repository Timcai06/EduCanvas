'use client';

import type {
  GatewayConnectionList,
  GatewayConnectionProvider,
} from '@educanvas/gateway-core';
import { CheckCircle, LinkSimple, PlugsConnected } from '@phosphor-icons/react';
import { connectionStatusLabel } from './connection-settings-status';

/** 只渲染可用渠道与连接入口；请求和状态归属仍由父级控制面持有。 */
export function ConnectionProviderGrid({
  data,
  notebookTitle,
  busyKey,
  onConnect,
}: {
  data: GatewayConnectionList | null;
  notebookTitle: string | null;
  busyKey: string | null;
  onConnect: (provider: GatewayConnectionProvider) => Promise<void>;
}) {
  return (
    <section data-settings-section aria-labelledby="providers-heading">
      <div className="mb-5 flex items-baseline gap-3">
        <span aria-hidden="true" className="h-5 w-1 rounded-full bg-accent" />
        <div>
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
                className={`group relative flex flex-col overflow-hidden rounded-3xl border bg-card p-5 shadow-float transition-all duration-200 ${
                  disabled
                    ? 'border-line/70 opacity-75'
                    : 'border-line hover:-translate-y-0.5 hover:border-accent/45 hover:shadow-[var(--shadow-card-hover)]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={`grid size-11 place-items-center rounded-2xl transition-colors ${
                      openConnection?.status === 'active'
                        ? 'bg-good-soft text-good'
                        : 'bg-accent-soft text-accent-strong'
                    }`}
                  >
                    <PlugsConnected aria-hidden="true" size={21} />
                  </span>
                  {openConnection?.status === 'active' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-good-soft px-2.5 py-1 text-xs font-medium text-good">
                      <CheckCircle aria-hidden="true" size={13} weight="fill" />
                      已连接
                    </span>
                  ) : provider.experimental ? (
                    <span className="rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn">
                      实验性
                    </span>
                  ) : null}
                </div>
                <h3 className="mt-5 font-display text-lg font-semibold text-ink">
                  {provider.label}
                </h3>
                <p className="mt-2 min-h-12 flex-1 text-sm leading-6 text-ink-muted">
                  {disabled
                    ? provider.disabledReason
                    : openConnection
                      ? `当前状态：${connectionStatusLabel[openConnection.status]}`
                      : '连接后，可以从这个渠道继续当前笔记本的对话。'}
                </p>
                <button
                  type="button"
                  disabled={
                    disabled || Boolean(openConnection) || busyKey !== null
                  }
                  onClick={() => void onConnect(provider.provider)}
                  className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-card transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-strong disabled:text-ink-faint"
                >
                  <LinkSimple aria-hidden="true" size={16} />
                  {openConnection
                    ? connectionStatusLabel[openConnection.status]
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
        <div
          role="status"
          className="rounded-3xl border border-line bg-card p-6 text-sm text-ink-muted shadow-float"
        >
          正在读取可用渠道…
        </div>
      )}
    </section>
  );
}
