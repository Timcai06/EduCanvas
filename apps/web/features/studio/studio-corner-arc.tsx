'use client';

import './studio-corner-arc.css';

/**
 * Studio 一级径向入口。圆心与顶栏 Studio 按钮对齐，两个无成本主题沿右上角
 * 四分之一圆展开；这里只切换工作台，不直接触发上传或 Artifact 创建。
 */
export function StudioCornerArc({
  onSelect,
}: {
  onSelect: (level: 'input' | 'output') => void;
}) {
  return (
    <nav className="studio-corner-arc" aria-label="Studio 输入与输出">
      <svg
        aria-hidden="true"
        className="studio-corner-arc__track"
        viewBox="0 0 480 360"
        preserveAspectRatio="xMaxYMin meet"
      >
        <path d="M 178 36 A 262 262 0 0 1 440 298" />
      </svg>
      <button
        type="button"
        onClick={() => onSelect('input')}
        className="studio-corner-arc__item studio-corner-arc__item--input"
      >
        文件输入
      </button>
      <button
        type="button"
        onClick={() => onSelect('output')}
        className="studio-corner-arc__item studio-corner-arc__item--output"
      >
        内容输出
      </button>
      <p className="studio-corner-arc__hint">选择一个方向展开工作台</p>
    </nav>
  );
}
