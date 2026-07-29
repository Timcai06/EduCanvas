# 安全规则

- 错误响应不能包含堆栈、SQL、请求体、Cookie、URL 动态参数或 Provider 信息
- 不在前端代码中硬编码任何 key/token/secret
- 学生 ID 只能从服务端身份（readAnonymousIdentity）获取，不接受浏览器 query/body/header 参数
- AI 生成的代码不能在主页直接执行，必须进沙箱
- 不通过 mock 数据伪造成功状态或学习记录
- 日志和遥测只使用稳定错误码或固定文案，不记录业务正文
