# 阶段执行计划

- 状态：`accepted`
- 负责人：项目负责人
- 最后验证时间：2026-08-13

`docs/plan/`是短期执行工作区，用于把阶段目标落实为有负责人、有边界、有证据的任务。这里不是产品、架构、接口或部署事实的长期来源。

## 与现有文档体系的关系

- [`路线图.md`](路线图.md)：跨阶段路线图和长期里程碑；
- `active/`：正在执行的阶段计划，同一目标只保留一个主计划；
- `completed/`：完成或取消后经过压缩的收尾记录；
- [`../09-decisions/`](../09-decisions/)：已经接受的重大技术取舍；
- `01-product`至`07-operations`：已实现行为和稳定工程事实的canonical文档。

`plan/`保持无编号，并在一个入口下区分稳定路线图与短期执行状态。

## 当前计划

当前任务以 [`active/README.md`](active/README.md) 为唯一分配索引：

- [KM 知识记忆](active/KM-知识记忆.md)；
- [G 产品发布闭环](active/G-产品发布闭环.md)。
- [DP 桌宠统一桌面外延](active/DP-桌宠统一桌面外延.md)。
- [WS Web 搜索与研究来源](active/WS-Web搜索与研究来源.md)。

[A 账号会话](completed/A-账号会话.md)、[P 学习档案](completed/P-学习档案.md)、
[F 画布界面](completed/F-画布界面.md)和[R 运行时收敛](completed/R-运行时事实收敛.md)
、[Q 质量观测成本](completed/Q-质量观测成本.md)、[W 工作面画布](completed/W-工作面画布收敛.md)、
[D 数据架构](completed/D-数据架构与扩展性收敛.md)、
[O 删除队列](completed/O-删除队列.md)与
[UV 画布语音](completed/UV-画布语音.md)已完成归档。UV 的真人麦克风、课堂噪声、十分钟长流和受控并发作为非阻塞后续保留，
不得把自动化证据改称真人验收。
[LC Live 与 Canvas 输出](completed/LC-Live与Canvas输出产品化.md)已完成真实产品验收并归档；
生成 Markdown 质量、产物状态卡重复和多输入口径收敛已由
[RM 统一资源工作台](completed/RM-统一资源工作台.md)完成；
[CA 代码与架构可信化](completed/CA-代码与架构可信化.md)已同步完成本地集成与归档，CA06
Desktop 主链保留为后续独立计划。

[自适应学习基线](completed/2026-07-自适应学习基线.md) 已完成并归档。
[账号、历史记录删除与用户资料](completed/2026-07-账号、历史记录删除与用户资料.md)
已在 PR #192 完成交付并归档。
第二代Hybrid Ports架构已[完成并结档](completed/2026-07-第二代架构升级.md)；
Memory、教育质量、正式身份、渠道生产化、自动verifier与完整SLO继续分别立项；
多模态输入输出和受控运行环境的稳定基线见已归档 UV 计划，后续扩展另行立项。
历史交付与去向见[`completed/`](completed/README.md)。

## 命名规则

- active 新计划使用`任务线代号-中文短名.md`，例如`O-删除队列.md`；
- 日期、完整目标和阶段范围写在文档正文；completed 历史可保留原有日期名；
- 一个文件只描述一个可独立验收的阶段目标；
- 状态只使用`draft`、`active`、`blocked`、`completed`、`cancelled`；
- `active`计划必须有负责人和最后验证时间；
- 依赖另一个计划时使用相对链接，不复制对方的任务清单。

## 生命周期

```text
draft -> active -> completed
                -> cancelled
        blocked -> active
```

计划完成不等于把复选框全部勾上。归档前必须：

1. 记录可复现的测试、截图、PR、部署或人工验收证据；
2. 把已实现的稳定事实回写到对应canonical文档；
3. 重大决策新增或更新ADR；
4. 删除已经失效的候选方案和逐日过程记录；
5. 保留实际交付范围、未完成项、关键偏差、证据和事实文档链接；
6. 将文件移至`completed/`并更新本索引；
7. 清理`active/`中的重复、暂停和被替代计划，必要时基于下一阶段重新组织目录。

单项自动化验证通过只更新 active 计划中的证据状态；只要完成终点仍有未验收能力，计划就继续留在`active/`。

详细协作规则见[`../08-collaboration/02-文档维护规则.md`](../08-collaboration/02-文档维护规则.md)。新计划从[`00-计划模板.md`](00-计划模板.md)开始。
