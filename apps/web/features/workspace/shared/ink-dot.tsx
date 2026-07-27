/**
 * 助手消息的「墨点」标识：墨紫的一滴墨，代表讲课的那支笔。
 * 它只用于助手状态，不承担产品品牌职责。
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
