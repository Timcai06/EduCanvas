import type { TurnApplicationDependencies } from './dependencies';
import type { TurnApplicationPort } from './ports';
import { TurnApplicationService } from './service';

/**
 * 唯一 Turn Application 组合工厂（R 线 R06）。
 *
 * Web General、Web Teaching、Gateway 三个生产入口统一经本工厂装配
 * `TurnApplicationService`；除本文件外，生产代码不得 `new TurnApplicationService`
 * （见 apps/web、apps/gateway 的 turn-application 组合根门禁）。工厂只接受抽象
 * Port / adapter，不导入 db、Provider SDK 或任何入口实现。
 */
export function createTurnApplication(
  dependencies: TurnApplicationDependencies,
): TurnApplicationPort {
  return new TurnApplicationService(dependencies);
}
