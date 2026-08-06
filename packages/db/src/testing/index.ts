/**
 * @educanvas/db 的测试专用入口：集成测试通过它获取 schema 表与数据库客户端。
 *
 * 与 `@educanvas/db/internal` 的差异只在语义定位：本入口只服务于测试（单元、
 * 集成、e2e fixture），生产代码禁止导入，`src/import-boundary.test.ts` 的静态
 * 门禁会拒绝新增生产依赖。默认入口当前仍暂时兼容 getDb 与指定 schema 表
 * （遗留引用），其实际移除属于 R06/R08。
 */
export { getDb } from '../client';
export * from '../schema';
export * from '../schema/study';
