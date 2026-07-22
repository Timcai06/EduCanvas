/**
 * Gateway HTTP 服务的兼容入口。
 *
 * 路由实现已按传输边界拆分到 `./http/` 目录：`common`（请求/响应/鉴权/错误映射）、
 * `dependencies`（依赖类型）、`node-routes` / `client-routes` / `internal-routes`（三组路由）
 * 与 `handler`（顶层分派）。本文件仅保留向后兼容的 re-export，公共导出与导入路径不变。
 */

export { createGatewayHttpHandler } from './http/handler';
