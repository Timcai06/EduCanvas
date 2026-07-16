# @educanvas/agent-runtime

EduCanvas 的通用 Agent 运行时。它把已验证的 Asset 版本转换成供应商可消费的上下文，并在能力不足时明确失败；不包含课程、学生、掌握度、教学状态机、数据库或 Provider SDK。

当前首个增量能力是 `buildAssetContext`：

- 对已提取文本的文档建立有字符上限、带不可信边界声明的上下文；
- 不静默丢弃图片、音频或视频；当前模型不支持时返回稳定的模态错误；
- 为未来原生视觉、音频和视频 Provider 保留不可变 Asset 引用，而不暴露私有存储地址。

通用 Turn/Tool 编排会在现有 K12 纵切保持可用的前提下继续小步迁入本包。
