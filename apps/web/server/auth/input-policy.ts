import 'server-only';

import { z } from 'zod';

const boundedText = (maxCodePoints: number) =>
  z.string().refine((value) => [...value].length <= maxCodePoints);

const passwordText = boundedText(128).refine((value) => [...value].length >= 8);

/** 登录 JSON 的字段边界；在密码派生或数据库查询前拒绝超长输入。 */
export const loginInputSchema = z
  .object({
    username: boundedText(32),
    password: passwordText,
  })
  .strict();

/** 注册 JSON 的字段边界；用户名与昵称的业务格式仍由账号领域规则负责。 */
export const registerInputSchema = z
  .object({
    username: boundedText(32),
    nickname: boundedText(30),
    password: passwordText,
  })
  .strict();

/** 修改密码 JSON 的字段边界；避免超长口令触发高成本密码派生。 */
export const passwordChangeInputSchema = z
  .object({
    currentPassword: passwordText,
    newPassword: passwordText,
  })
  .strict();

/** 资料更新 JSON 的闭集边界；Unicode 规范化与控制字符规则仍由账号领域执行。 */
export const profileUpdateInputSchema = z
  .object({
    nickname: boundedText(30),
  })
  .strict();
