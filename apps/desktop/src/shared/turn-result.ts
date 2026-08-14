/**
 * turn 代理的返回类型（main/preload/renderer 三侧共用）。
 * ok:false 的 code 用于 renderer 呈现与测试断言。
 */
export type TurnResult =
  | {
      ok: true;
      action: string;
      message: string;
      artifactId?: string;
      panel?: string;
    }
  | {
      ok: false;
      code:
        | 'backend_offline'
        | 'timeout'
        | 'aborted'
        | 'interrupted'
        | 'http'
        | 'unauthenticated'
        | 'route_required';
      message: string;
    };
