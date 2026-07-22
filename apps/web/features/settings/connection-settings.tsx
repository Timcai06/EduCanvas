'use client';

import {
  gatewayConnectionConnectResultSchema,
  gatewayConnectionListSchema,
  gatewayConnectionRevokeResultSchema,
  type GatewayConnectionAuthorization,
  type GatewayConnectionList,
  type GatewayConnectionProvider,
} from '@educanvas/gateway-core';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { ConnectionAuthorization } from './connection-settings-authorization';
import { ConnectionList } from './connection-settings-list';
import { ConnectionProviderGrid } from './connection-settings-provider-grid';

gsap.registerPlugin(useGSAP);

interface VisibleAuthorization extends GatewayConnectionAuthorization {
  provider: GatewayConnectionProvider;
}

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
  const [announcement, setAnnouncement] = useState('正在读取可用渠道。');
  const rootRef = useRef<HTMLDivElement>(null);
  const authorizationHeadingRef = useRef<HTMLHeadingElement>(null);

  const providerLabel = (provider: GatewayConnectionProvider): string =>
    data?.providers.find((candidate) => candidate.provider === provider)
      ?.label ?? provider;

  /* 面板分区入场：读到渠道后逐块上浮淡入；reduced-motion 由 matchMedia 直接跳过。 */
  useGSAP(
    () => {
      if (!data) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('[data-settings-section]', {
          autoAlpha: 0,
          y: 12,
          duration: 0.4,
          stagger: 0.08,
          ease: 'power2.out',
        });
      });
      return () => media.revert();
    },
    { scope: rootRef, dependencies: [Boolean(data)] },
  );

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
        if (active) {
          setData(next);
          setAnnouncement('通信方式已加载。');
        }
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
    const label = providerLabel(provider);
    setBusyKey(`connect:${provider}`);
    setError(null);
    setAnnouncement(`正在发起${label}连接。`);
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
      setAnnouncement(`${label}连接已发起，请在十分钟内完成授权。`);
      window.requestAnimationFrame(() => {
        authorizationHeadingRef.current?.focus();
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法发起连接。');
      setAnnouncement('');
    } finally {
      setBusyKey(null);
    }
  };

  const revoke = async (connectionId: string) => {
    const connection = data?.connections.find(
      (candidate) => candidate.connectionId === connectionId,
    );
    const label = connection ? providerLabel(connection.provider) : '通信方式';
    setBusyKey(`revoke:${connectionId}`);
    setError(null);
    setAnnouncement(`正在撤销${label}连接。`);
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
      setAnnouncement(`${label}连接已撤销。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法撤销连接。');
      setAnnouncement('');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div
      ref={rootRef}
      aria-busy={busyKey !== null || (data === null && error === null)}
      className="space-y-10"
    >
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </p>
      <ConnectionProviderGrid
        data={data}
        notebookTitle={notebookTitle}
        busyKey={busyKey}
        onConnect={connect}
      />

      {authorization ? (
        <ConnectionAuthorization
          authorization={authorization}
          headingRef={authorizationHeadingRef}
        />
      ) : null}

      <ConnectionList data={data} busyKey={busyKey} onRevoke={revoke} />

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
