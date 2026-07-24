/**
 * 水墨极光背景（灵感来源：React Bits「Aurora」流光背景，改为两支笔的墨紫/朱砂低饱和版）。
 * 纯 CSS 动画、无客户端脚本、pointer-events:none、aria-hidden，仅作氛围，reduced-motion 下停帧
 * （见 globals.css .aurora-ink）。放在容器内需父级 relative + overflow-hidden。
 */
export function AuroraInk() {
  return (
    <div className="aurora-ink" aria-hidden="true">
      <span
        style={{
          left: '-6%',
          top: '-30%',
          background: 'var(--color-accent)',
          animationDelay: '0s',
        }}
      />
      <span
        style={{
          left: '38%',
          top: '-45%',
          background: 'var(--color-accent-strong)',
          animationDelay: '-7s',
        }}
      />
      <span
        style={{
          left: '70%',
          top: '-20%',
          background: 'var(--color-cinnabar)',
          animationDelay: '-13s',
          opacity: 0.28,
        }}
      />
    </div>
  );
}
