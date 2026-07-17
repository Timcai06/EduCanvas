/**
 * EduCanvas 品牌标记:四芒星火花 + 品牌渐变,替代通用图标库的 Sparkle。
 * 纯内联 SVG,无运行时依赖;渐变 id 加前缀避免同页多实例冲突由 aria-hidden
 * 装饰性使用规避(同 id 引用同一渐变定义是合法的)。
 */
export function LogoMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <defs>
        <linearGradient
          id="educanvas-logo-gradient"
          x1="3"
          y1="21"
          x2="21"
          y2="3"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#98a5ff" />
          <stop offset="0.55" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#e0a6c8" />
        </linearGradient>
      </defs>
      <path
        d="M12 2c.9 5.2 4.8 9.1 10 10-5.2.9-9.1 4.8-10 10-.9-5.2-4.8-9.1-10-10 5.2-.9 9.1-4.8 10-10Z"
        fill="url(#educanvas-logo-gradient)"
      />
    </svg>
  );
}
