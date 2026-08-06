/**
 * @educanvas/db 的受控内部入口：`getDb`、schema 全量与迁移辅助的迁移目标 subpath。
 *
 * R04 收口第一阶段后，默认入口仍暂时兼容 getDb 与 R00 指定的 schema 表（遗留
 * 生产/测试引用），其实际移除属于 R06/R08；数据库客户端与底层表定义的迁移目标
 * 是本入口。生产业务代码（apps/*、领域包）禁止导入本入口，`src/import-boundary.test.ts`
 * 的静态门禁会拒绝新增依赖；本入口的合法消费者是 db 包内部基础设施与获准的
 * 迁移/运维脚本。
 */
export { getDb } from '../client';
export * from '../schema';
export * from '../schema/study';
