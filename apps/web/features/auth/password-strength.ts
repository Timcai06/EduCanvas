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
 * 浏览器风险提示只用于解释输入质量；服务端以独立策略执行真实长度边界。
 */
export function assessPasswordRisk(password: string): PasswordRiskAssessment {
  const classes = characterClassCount(password);
  if (password.length < 8) {
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
