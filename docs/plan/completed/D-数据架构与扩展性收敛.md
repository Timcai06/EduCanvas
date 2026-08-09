# 数据架构与扩展性收敛

- 状态：`completed`
- 负责人：项目负责人
- 完成时间：2026-08-09
- 基线范围：D00–D08
- 阶段出口：`Core Architecture Freeze → Feature Development Phase`

## 目标

在 UV、KM、PET 与新工具/产物并行开发前冻结 Stable Data Kernel：明确长期事实权威、
数据库完整性、开放扩展点、派生物版本、Schema 协作边界、Migration 纪律与真实
PostgreSQL 运维证据。D 线不是第三轮数据库重写，没有创建第二套 Runtime、Ledger、
RAG 或通用万能实体模型。

## 实际交付

| 任务 | 结果 | 主要交付                                                                        |
| ---- | ---- | ------------------------------------------------------------------------------- |
| D00  | PASS | 67 表真实基线、Domain Map、Authority/Ownership、Schema 图与证据缺口             |
| D01  | PASS | 67/67 生命周期与删除契约、Logical-ID 裁定、Feature Data Contract 模板           |
| D02  | PASS | Assets→Spaces、Lesson Sessions→Platform Users、Budget→Operation 三条强 FK；0051 |
| D03  | PASS | 44 closed state 与 19 open extension identifier 分离；0052 + vocabulary gate    |
| D04  | PASS | Asset Representation 五元 identity、多 Provider/多版本并存、幂等写入；0053      |
| D05  | PASS | 2993 行 schema 单体拆为领域模块，公共入口兼容，物理 Schema 零变化               |
| D06  | PASS | 历史 Migration 不可变门禁、records 8 字段、DB/Worker/Migration CI 分层          |
| D07  | PASS | shared live 只读健康审计 + isolated 0053 clone query plans + rollout gates      |
| D08  | PASS | Feature Data Contract、全量验证、Core Architecture Freeze 与计划归档            |

详细证据位于：

- [D00 数据架构基线](../../04-data/04-D00-数据架构基线.md)
- [D01 数据权威生命周期与删除契约](../../04-data/05-D01-数据权威生命周期与删除契约.md)
- [D02 核心参照完整性](../../04-data/06-D02-核心参照完整性与孤儿事实收口.md)
- [D03 开放 Vocabulary 与封闭状态机](../../04-data/07-D03-开放Vocabulary与封闭状态机分离.md)
- [D04 Asset 派生表示](../../04-data/08-D04-Asset派生表示多版本收敛.md)
- [D05 Schema 模块化](../../04-data/09-D05-Schema源码领域模块化.md)
- [D06 Migration 治理](../../04-data/10-D06-快速开发期Migration治理.md)
- [D07 PostgreSQL 健康与查询计划](../../04-data/11-D07-真实PostgreSQL健康与查询计划审计.md)
- [D08 Feature 数据门禁与 Freeze](../../04-data/12-D08-Feature数据门禁与CoreArchitectureFreeze.md)

## 冻结后的 Stable Data Kernel

```text
Platform User / Personal Agent
  └─ Space / Notebook + Membership
       ├─ Conversation → Operation → Runtime ledgers
       ├─ Asset → AssetVersion → Representation / Processing
       ├─ Artifact → ArtifactVersion / Generation Job
       ├─ Knowledge / Retrieval derivations
       └─ Vertical contexts such as K12
```

- PostgreSQL 是长期业务事实源；Graphile Worker 是可回收执行基础设施；
- `learning_events` 是学习事实源，`mastery_states` 是投影；
- `conversation_messages` 是平台长期消息权威，`chat_messages` 受 ADR-0013 三闸门管理；
- Model Run、Tool Call、Context Snapshot 只有统一生产写入路径；
- Asset 派生物以五元 identity 允许多 Provider/版本并存；
- 开放 Registry 在应用层注册和校验，安全/生命周期状态继续由 DB closed CHECK 强制；
- `packages/db/src/schema.ts` 是兼容公共入口，领域定义位于 `schema/*.ts`；
- 新长期事实必须填写 canonical Feature Data Contract，不能以 JSONB 或平行根实体绕过。

## Migration 与协作纪律

- 已进入 main 的 SQL/snapshot 不可修改，journal 只允许合法尾部追加；
- 并行 migration 的后合并分支必须 rebase main 后重新生成自己的新 migration；
- 新 migration 必须成套、记录规模/锁/数据迁移/回退，并通过 drift、fresh 与 N-1；
- 0051 snapshot 漏记 D02 三条 FK 和一个索引，冻结为历史不可变 metadata anomaly：
  0051 SQL 是该步物理事实，0052+ snapshot 是后续 metadata baseline，fresh catalog
  回归显式守住最终约束；禁止回写 0051 或生成重复 FK migration。

## 关键偏差与证据边界

1. shared local development DB 仍停在 0050；D07 没有修改它。当前 head 的物理证据来自
   isolated clone 与 disposable fresh/N-1 数据库。运行 head 前必须走标准 migrate。
2. 生产数据规模、锁窗口和生产 query plans 未被伪造。0051–0053 发布前 preflight 与
   D07 六类 Watch 查询由 release/operator 在目标库执行。
3. 本地 Node 为 24.18.0，而仓库要求 Node 22；工程测试通过时保留 engine warning，
   GitHub CI 的 Node 22 是最终远端证据。
4. macOS sandbox 对 `/bin/ps` / 本地 socket 的 EPERM 不能被记为代码失败，也不能用于
   跳过与 D 相关的测试；远端 CI 和可复核子集承担最终门禁。

## 未完成项去向

- `chat_messages` 退役继续遵守 ADR-0013 回填→切读→退役三闸门；不在 D 线物理删除；
- AssetVersion 的 legacy extracted/transcription mirror 在调用方切读、生产零调用与一个发布
  周期回退窗口后再 contract；
- D07 Watch indexes 只有拿到生产/代表性预发规模证据后才可单独立项；
- 0051–0053 的 production preflight 进入 release 门禁，不改变 D 的本地架构 PASS；
- UV 复用 Asset/Consent/Retention，KM 新 Memory 可建新 Domain 但必须填写 Contract，
  PET 优先 Preference；O 继续承担删除 outbox 的并发/恢复收口。

## 完成定义

- 67 张长期表均有领域、owner、authority、retention/deletion 契约；
- 核心内部弱关系均已强化或给出明确分类；D-RISK-01/02 已成为 DB 强约束；
- Asset derivation 支持多版本、多 Provider；open/closed vocabulary 已分离；
- Schema 可按领域低冲突协作；Migration 有不可变、fresh/N-1/rollback 纪律；
- 真实 PostgreSQL health/query-plan audit 已完成且生产证据边界诚实；
- 新表契约已进入 canonical 数据设计；DB public boundary 未放宽；
- 收口本地门禁通过；归档提交只允许在远端 required CI 全绿后进入 main。

因此 D08 = PASS，Core Architecture Freeze 生效。Freeze 只禁止无证据的大范围基础架构
重构，不阻止按真实产品需求、Feature Data Contract 与 migration discipline 演进。
