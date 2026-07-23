/**
 * EduCanvas 品牌标记：一枚朱砂印章，章面是老师批改的笔触对勾。
 * 「两支笔」体系里朱砂代表批改与肯定，印章代表完成与身份——
 * 这是整个产品唯一允许朱砂脱离批改语义出现的地方（品牌例外）。
 * 纯内联 SVG 取色自语义 token，随亮暗主题联动。
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
      <rect
        x="1.6"
        y="1.6"
        width="20.8"
        height="20.8"
        rx="5.6"
        fill="var(--color-cinnabar)"
      />
      <path
        d="M6.8 12.6l3.6 3.9 6.8-8.6"
        stroke="var(--color-card)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 助手消息的「墨点」标识：黛青的一滴墨，代表讲课的那支笔。
 * 与品牌印章刻意区分——助手每条消息都会出现，不能滥用朱砂。
 */
export function InkDot({ size = 10 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
    >
      <path
        d="M6 1.2c1.9 1.5 4.3 3.4 4.3 5.7A4.3 4.3 0 0 1 6 11.1 4.3 4.3 0 0 1 1.7 6.9C1.7 4.6 4.1 2.7 6 1.2Z"
        fill="var(--color-accent)"
      />
    </svg>
  );
}
