// 团队协作测试文件
// 用于验证：分支 → 提交 → PR 流程是否正常

export function greet(member: string): string {
  return `你好，${member}！欢迎加入 EduCanvas 团队。`;
}

export function checkBranch(): string {
  return "当前分支正确，未直接修改 main。";
}
