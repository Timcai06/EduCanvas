/**
 * @educanvas/db 的受控内部入口：`getDb`、schema 全量与迁移辅助的组合根 subpath。
 *
 * 默认入口不再导出底层连接。生产代码只有静态门禁列出的服务端组合点可导入
 * `getDb`；其它业务模块不得把它当作 Repository API。测试使用
 * `@educanvas/db/testing`，迁移/运维脚本仍可使用本入口。
 */
export { getDb } from '../client';
export * from '../schema';
export * from '../schema/study';
