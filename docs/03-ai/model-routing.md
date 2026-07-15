# 模型路由

- 状态：`draft`
- 注意：模型名称变化快，上线前必须重新核对供应商文档并锁定快照版本。

> 当前实现状态：`packages/teaching-core` 已定义供应商无关的 `ModelGateway` Port和结构化请求/结果类型；Provider适配、路由策略、Fallback、配额、Trace与持久化均尚未实现。下文描述目标能力，不代表当前已有可调用的模型链路。

## 路由原则

- 不用一个最强模型处理所有请求；
- 按任务质量、延迟、成本和模态选择模型；
- 主供应商故障时有跨供应商降级；
- 业务代码不直接写死模型ID；
- 每次调用记录模型版本、Prompt版本、Token、耗时和结果状态。

## 当前候选

| 任务                     | 主选方向              |
| ------------------------ | --------------------- |
| 意图识别、查询改写       | Qwen Flash级模型      |
| 日常教学和Canvas结构生成 | Qwen Plus级模型       |
| 高价值课程离线生成与审核 | Qwen Max级模型        |
| 实时语音和视觉           | Qwen Omni Realtime    |
| 跨供应商文本容灾         | DeepSeek Flash级模型  |
| 文本Embedding            | Qwen3-Embedding-4B    |
| 多模态Embedding          | Qwen3-VL-Embedding-2B |

## Model Gateway职责

- Provider适配；
- 模型别名与版本配置；
- 超时、重试和熔断；
- 并发配额；
- 成本预算；
- Fallback；
- Prompt和Schema版本；
- 安全检查；
- Trace和评测采样。
