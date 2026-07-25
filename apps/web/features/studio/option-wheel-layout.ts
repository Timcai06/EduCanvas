import type { OptionWheelConfig } from './option-wheel-contract';

/**
 * 将轮盘当前位置投影为各标签的弧线位置与视觉权重。
 *
 * 调用边界：仅写入调用方提供的 DOM 列表，不持有 rAF、选中态或 Studio 业务状态。
 * `position` 可以是小数，以便上层使用任意平滑算法驱动连续动画。
 */
export function applyOptionWheelLayout(
  config: OptionWheelConfig,
  elements: readonly (HTMLDivElement | null)[],
  position: number,
): void {
  const mirror = config.side === 'right' ? -1 : 1;
  const tiltRadians = (config.tilt * Math.PI) / 180;
  const radius = tiltRadians > 0.0005 ? config.rowHeight / tiltRadians : 0;

  for (let index = 0; index < config.count; index += 1) {
    const element = elements[index];
    if (!element) continue;
    let distanceFromCenter = index - position;
    if (config.loop && config.count > 1) {
      distanceFromCenter =
        ((distanceFromCenter % config.count) + config.count) % config.count;
      if (distanceFromCenter > config.count / 2) {
        distanceFromCenter -= config.count;
      }
    }

    const distance = Math.abs(distanceFromCenter);
    let x = 0;
    let y = distanceFromCenter * config.rowHeight;
    let rotation = 0;
    if (radius > 0) {
      const angle = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, distanceFromCenter * tiltRadians),
      );
      y = radius * Math.sin(angle);
      x = -mirror * radius * (1 - Math.cos(angle)) * config.curve;
      rotation = (mirror * angle * 180) / Math.PI;
    }

    element.style.transform = `translate(${x.toFixed(2)}px, calc(${y.toFixed(2)}px - 50%)) rotate(${rotation.toFixed(3)}deg)`;
    element.style.opacity = String(
      Math.max(config.minOpacity, 1 - distance * config.fade),
    );
    element.style.filter =
      config.blur > 0
        ? `blur(${(distance * config.blur).toFixed(2)}px)`
        : 'none';
    element.style.setProperty(
      '--ow-proximity',
      Math.max(0, 1 - Math.min(distance, 1)).toFixed(4),
    );
  }
}
