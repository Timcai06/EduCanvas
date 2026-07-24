export type PasswordRiskLevel = 'high' | 'medium' | 'low';

export interface PasswordRiskAssessment {
  level: PasswordRiskLevel;
  label: string;
  acceptable: boolean;
}

function characterClassCount(password: string): number {
  return [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
}

/**
 * Shared UI/server password risk rubric. The server still enforces the minimum
 * length independently; this function only explains the risk level consistently.
 */
export function assessPasswordRisk(password: string): PasswordRiskAssessment {
  const classes = characterClassCount(password);
  if (password.length < 6) {
    // 长度不足仍由注册提交时的明确错误提示处理；风险区只表达风险等级。
    return { level: 'high', label: '高风险', acceptable: false };
  }
  if (password.length >= 12 && classes >= 3) {
    return { level: 'low', label: '低风险', acceptable: true };
  }
  if (password.length >= 8 && classes >= 2) {
    return { level: 'medium', label: '中风险', acceptable: true };
  }
  return { level: 'high', label: '高风险', acceptable: true };
}
