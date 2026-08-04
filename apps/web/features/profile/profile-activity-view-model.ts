import type { ActivityLoadState } from './learning-activity-loader';

/**
 * 档案活动区的 UI 投影模型。
 *
 * 纯函数：输入 ActivityLoadState → 输出统一视图结构。
 * 不依赖 React / DOM / Router / Canvas / 数据库。
 *
 * 安全约束：
 * - failed 时 message 始终返回固定安全文案，忽略传入的原始错误信息
 * - loading 时所有统计值为 null，不展示虚假数字
 * - empty 时统计值为 null，诚实告知"还没有学习记录"
 */
export interface ActivityViewModel {
  isBusy: boolean;
  isFailed: boolean;
  isEmpty: boolean;
  streakDays: number | null;
  activeDays: number | null;
  masteryPercent: number | null;
  /** 显示给用户的安全文案；loading/ready 时为 null */
  message: string | null;
}

const FAILED_MESSAGE = '暂时无法加载学习活动';
const EMPTY_MESSAGE = '还没有学习记录';

export function toActivityViewModel(
  state: ActivityLoadState,
): ActivityViewModel {
  switch (state.kind) {
    case 'loading':
      return {
        isBusy: true,
        isFailed: false,
        isEmpty: false,
        streakDays: null,
        activeDays: null,
        masteryPercent: null,
        message: null,
      };

    case 'ready':
      return {
        isBusy: false,
        isFailed: false,
        isEmpty: false,
        streakDays: state.activity.streakDays,
        activeDays: state.activity.activeDays,
        masteryPercent: state.activity.masteryPercent,
        message: null,
      };

    case 'empty':
      return {
        isBusy: false,
        isFailed: false,
        isEmpty: true,
        streakDays: null,
        activeDays: null,
        masteryPercent: null,
        message: EMPTY_MESSAGE,
      };

    case 'failed':
      // 安全：忽略传入的 message，始终返回固定安全文案
      return {
        isBusy: false,
        isFailed: true,
        isEmpty: false,
        streakDays: null,
        activeDays: null,
        masteryPercent: null,
        message: FAILED_MESSAGE,
      };
  }
}
