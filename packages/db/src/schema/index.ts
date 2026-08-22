/**
 * D05：Schema 领域模块化聚合入口（薄聚合，不承载实现）。
 * 导出顺序保持拆分前 schema.ts 的表定义顺序，领域边界与依赖方向
 * 见 docs/04-data/09-D05-Schema源码领域模块化.md。
 *
 * 索引命名 `*_fk_idx` 专指「为外键强制查询兜底」的索引，不服务任何业务读取。
 * 父行删除时 PostgreSQL 会对每条被删行在子表上做等值探测；缺索引时该探测退化为
 * 顺序扫描，并在删除期间放大锁窗口。这类索引只在父表确实存在生产删除路径时才
 * 添加——判定依据与 EXPLAIN 证据见 docs/04-data/03-外键索引审计.md。
 */
export * from './identity';
export * from './workspace';
export * from './gateway';
export * from './conversation';
export * from './agent-runtime';
export * from './asset';
export * from './asset-web-snapshot';
export * from './turn';
export * from './knowledge';
export * from './retrieval';
export * from './learning';
export * from './artifact';

// 既有领域模块（D05 前已在 schema/ 下）：统一从 schema 入口导出，
// 与原 schema.ts 的 re-export 行为保持一致（确保生产/测试连接使用同一 Drizzle 类型）。
export * from './study';
export * from './account';
export * from './web-runtime';
export * from './annotation';
export * from './surface-layout';
export * from './research-checkpoint';
