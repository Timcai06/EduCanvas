import { z } from 'zod';
import {
  gatewayCapabilityNameSchema,
  type GatewayCapabilityName,
  type GatewayRiskLevel,
} from './capabilities';

/**
 * Desktop 第一方客户端的版本化 capability manifest 契约（DP06）。
 *
 * 客户端只声明能力名；risk/version 由服务端用 `gatewayCapabilityDefaultRisk` 解析，
 * 客户端不得自报 L2/L3。冻结的 v1 能力集覆盖四轴：
 * - 可输入：`input.text`；
 * - 可渲染：`output.markdown`/`output.stream`（真实流式，含取消反馈）、
 *   `output.card`/`output.action`（DP07 结果卡与动作）；
 * - 可取消：`output.stream` 提供实时 operation 反馈，取消是协议级操作；
 * - 可 handoff：刻意不含 `artifact.native`，Artifact 一律降级为可验证 Web handoff（DP08）。
 */

/** Desktop manifest 结构版本；未知版本由 `z.literal` 在契约层直接 400。 */
export const gatewayDesktopCapabilityVersion = '1' as const;
export const gatewayDesktopCapabilityVersionSchema = z.literal(
  gatewayDesktopCapabilityVersion,
);
export type GatewayDesktopCapabilityVersion = z.infer<
  typeof gatewayDesktopCapabilityVersionSchema
>;

export const gatewayDesktopCapabilityNames = [
  'input.text',
  'output.markdown',
  'output.stream',
  'output.card',
  'output.action',
  'approval.interactive',
] as const satisfies readonly GatewayCapabilityName[];

export type GatewayDesktopCapabilityName =
  (typeof gatewayDesktopCapabilityNames)[number];

/**
 * 客户端可发送的 manifest 声明形状。capabilities 校验到 gateway 全量能力名集合，
 * 具体哪些可被接受由服务端 risk 表决定（未知能力名 → 400 INVALID_REQUEST）。
 */
export const gatewayDesktopCapabilityManifestSchema = z
  .object({
    manifestVersion: gatewayDesktopCapabilityVersionSchema,
    capabilities: z
      .array(gatewayCapabilityNameSchema)
      .min(1)
      .max(64)
      .superRefine((names, context) => {
        if (new Set(names).size !== names.length) {
          context.addIssue({
            code: 'custom',
            path: [],
            message: 'Capability names must be unique within a manifest',
          });
        }
      }),
  })
  .strict();

export type GatewayDesktopCapabilityManifest = z.infer<
  typeof gatewayDesktopCapabilityManifestSchema
>;

/** 桌面客户端直接发送的冻结 v1 manifest。 */
export const gatewayDesktopCapabilityManifest: GatewayDesktopCapabilityManifest =
  {
    manifestVersion: gatewayDesktopCapabilityVersion,
    capabilities: [...gatewayDesktopCapabilityNames],
  };

/**
 * 服务端能力名 → risk 解析表。只覆盖服务端认可的投影能力；
 * 未知或未登记能力名由网关明确拒绝，不做宽大处理。
 */
export const gatewayCapabilityDefaultRisk: Readonly<
  Partial<Record<GatewayCapabilityName, GatewayRiskLevel>>
> = {
  'input.text': 'l0',
  'output.markdown': 'l0',
  'output.stream': 'l0',
  'output.card': 'l0',
  'output.action': 'l0',
  'approval.interactive': 'l1',
};

/** 服务端解析时对客户端声明能力的默认版本。 */
export const gatewayCapabilityDefaultVersion = '1' as const;
