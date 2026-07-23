'use client';

import type { GatewayConnectionList } from '@educanvas/gateway-core';
import {
  CheckCircle,
  Clock,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import { connectionStatusLabel } from './connection-settings-status';

/** 只渲染已发起连接及撤销入口；服务端请求由父级控制面执行。 */
export function ConnectionList({
  data,
  busyKey,
  onRevoke,
}: {
  data: GatewayConnectionList | null;
  busyKey: string | null;
  onRevoke: (connectionId: string) => Promise<void>;
}) {
  return (
    <section data-settings-section aria-labelledby="connections-heading">
      <div className="mb-5 flex items-baseline gap-3">
        <span aria-hidden="true" className="h-5 w-1 rounded-full bg-cinnabar" />
        <h2
          id="connections-heading"
          className="font-display text-xl font-semibold text-ink"
        >
          已发起的连接
        </h2>
      </div>
      <div className="overflow-hidden rounded-3xl border border-line bg-card shadow-float">
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
                  className="flex flex-col gap-4 p-5 transition-colors hover:bg-surface/40 sm:flex-row sm:items-center"
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
                      {connectionStatusLabel[connection.status]} · 发起于{' '}
                      {new Date(connection.createdAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  {connection.status !== 'revoked' ? (
                    <button
                      type="button"
                      disabled={busyKey !== null}
                      onClick={() => void onRevoke(connection.connectionId)}
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
  );
}
