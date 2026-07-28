# ADR-0011：K12 学习产物与平台长期 Artifact 桥接

- 状态：`accepted`
- 日期：2026-07-27
- 负责人：项目负责人

## 背景

K12 学习纵切的 Canvas Artifact（quiz、classification_game、pipeline_flow）当前仅存在于 `canvas_artifacts` 表，绑定到 `lesson_sessions`。这些产物是不可变的学习回放/判分快照，但缺少平台 Artifact 的长期身份，因而无法跨对话追踪，也无法为后续 Studio Registry 迁移和平台级生命周期管理提供稳定主键。

平台 Artifact（`artifacts` + `artifact_versions`）是一等公民，拥有归属、类型、信任层、不可变版本和任务状态。K12 产物需要同时拥有这两种身份，但禁止直接合表。

## 候选方案

### 方案一：K12 产物直接写入 artifacts 表

简单直接，但 `canvas_artifacts` 的判分键（grading_key）必须物理隔离，且 K12 的 `(sessionId, artifactId)` 唯一约束与平台的 `(spaceId, ownerSubjectId)` 唯一约束语义不同，强行合并会导致约束冲突和查询路径混乱。

### 方案二：在 canvas_artifacts 上加外键关联 artifacts（选定）

为 `canvas_artifacts` 添加可空的 `platform_artifact_id` 和 `platform_artifact_version_id` 外键，指向 `artifacts` 和 `artifact_versions`。新 K12 产物在同一事务中同时创建快照和平台身份；旧记录保持 NULL，不做无界回填。

### 方案三：通过消息引用间接关联

在 `conversation_messages` 或 `agent_operations` 中添加引用，但查询路径过长，且无法直接从 K12 快照反查平台身份。

## 决定

选择方案二，并接受以下约束：

1. `canvas_artifacts` 新增可空列 `platform_artifact_id` 和 `platform_artifact_version_id`；二者必须同时为空或同时存在。
2. 复合外键保证 `platform_artifact_version_id` 必须属于同一个 `platform_artifact_id`；唯一索引确保每个平台 Artifact 最多关联一个 K12 快照。
3. 新 K12 产物创建路径（`ensurePreparedArtifact`）在同一事务中同时写入：
   - `canvas_artifacts` + `canvas_artifact_grading_keys`（学习快照 + 判分键）
   - `artifacts` + `artifact_versions`（平台长期身份 + 不可变内容）
   - 回写 `canvas_artifacts.platform_artifact_id` 和 `platform_artifact_version_id`
4. 平台 Artifact Version 的 `content` 仅保存浏览器安全投影（`publicArtifact.params`）；判分键（grading key）永远不进入 `artifacts`、`artifact_versions` 或浏览器响应。
5. 旧 K12 记录（`platform_artifact_id` 为 NULL）继续可读，不做无界全量回填。
6. `lesson_sessions.conversation_id` 的既有 `ON DELETE RESTRICT` 语义保持不变：存在学习会话时禁止删除 Conversation，快照与桥接关系都保留。对于没有学习会话引用的普通平台 Artifact，Conversation 删除仍只把 `artifacts.conversation_id` 置空。只有平台 Artifact 或所关联 Version 被删除时，桥接两列才一起置空。
7. 平台 Artifact 归档（`artifacts.status = 'archived'`）不影响历史学习回放——回放只读 `canvas_artifacts`。
8. Web Renderer Registry 尚未支持 `quiz`、`classification_game`、`pipeline_flow`。在 Registry 迁移前，现有 Studio 列表在数据库分页阶段排除这些桥接类型；K12 页面继续走原快照渲染路径。
9. 只有已绑定 Conversation/Notebook 的新 K12 产物创建平台身份；没有 Conversation 的兼容 Session 继续只写学习快照，避免伪造归属。该兼容债务不在本阶段扩张为新的 Notebook 推断规则。

## 原因

这个方案同时满足：

- K12 产物获得平台长期身份，为后续 Studio Registry 迁移提供稳定主键
- `canvas_artifacts` 继续作为不可变学习回放/判分快照
- 判分键物理隔离，不进入平台版本或浏览器响应
- 旧记录无需迁移，新路径原子创建
- 符合 ADR-0005（Artifact 是一等公民）和 ADR-0009（Canvas 是统一工作面）的设计

## 后果

- `canvas_artifacts` 表新增两列、成对检查、复合外键和一个唯一索引
- 迁移由两个生成步骤完成：0041 先建立列和被引用唯一约束，0042 再建立复合外键，避免 Drizzle 生成顺序导致不可执行迁移
- `ensurePreparedArtifact` 函数增加平台 Artifact 创建逻辑，事务内额外两次 INSERT 和一次 UPDATE
- 本阶段不新增无授权参数的桥接查询 API；需要消费桥接关系时必须从现有 Notebook 授权组合层进入
- 不修改 `artifact-resource-adapter.ts`——协议身份已经建立，但 Web Registry 尚未迁移；K12 产物仍通过 `canvas_artifacts` 路径渲染
- 不需要修改 `anonymous-data-lifecycle.ts`——FK ON DELETE SET NULL 保证删除 canvas_artifact 不影响平台 Artifact

## 验证方式

- 新 K12 Artifact 同时产生平台长期身份与不可变快照
- 重试幂等（同一 sessionId + artifactId 不重复创建平台身份）
- 判分键不进入平台版本和 API
- 平台 Artifact 归档不破坏历史学习回放
- 存在学习会话时 Conversation 删除被拒绝，桥接与快照保留
- 跨用户/跨 Notebook 统一 404
- 旧无关联 snapshot 仍可读取
