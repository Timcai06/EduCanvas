/**
 * 阶段一模块化单体的现行表集（D05 起为兼容聚合入口）。
 * 实际表定义已按数据领域拆入 ./schema/ 各领域模块（identity/workspace/gateway/
 * conversation/agent-runtime/asset/turn/knowledge/retrieval/learning/artifact），
 * 本文件仅 re-export 以保持 `./schema` 导入路径与导出名称完全不变。
 * 领域边界、依赖方向与等价证明见 docs/04-data/09-D05-Schema源码领域模块化.md。
 */
export * from './schema/index';
