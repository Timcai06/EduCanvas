export type OptionWheelSide = 'left' | 'right';

/**
 * Studio 弧形选择器公开属性。selectedIndex 存在时必须由调用方回写 onChange；
 * onSelect 只表示用户确认当前项，不得用 onChange 直接触发有成本的业务动作。
 */
export interface OptionWheelProps {
  items: readonly string[];
  selectedIndex?: number;
  defaultSelected?: number;
  onChange?: (index: number, item: string) => void;
  onSelect?: (index: number, item: string) => void;
  /** 单击非中心项时同时确认；只适合无成本的一级导航，不能用于创建动作。 */
  activateOnItemClick?: boolean;
  textColor?: string;
  activeColor?: string;
  side?: OptionWheelSide;
  fontSize?: number;
  spacing?: number;
  curve?: number;
  tilt?: number;
  blur?: number;
  fade?: number;
  minOpacity?: number;
  smoothing?: number;
  inset?: number;
  loop?: boolean;
  draggable?: boolean;
  soundUrl?: string;
  soundVolume?: number;
  ariaLabel?: string;
  className?: string;
}

export interface OptionWheelConfig {
  count: number;
  items: readonly string[];
  rowHeight: number;
  curve: number;
  tilt: number;
  blur: number;
  fade: number;
  minOpacity: number;
  side: OptionWheelSide;
  loop: boolean;
  smoothing: number;
  draggable: boolean;
  soundUrl: string;
  soundVolume: number;
}

export const clampOptionWheelIndex = (index: number, count: number): number =>
  Math.min(Math.max(Math.round(index), 0), Math.max(count - 1, 0));
