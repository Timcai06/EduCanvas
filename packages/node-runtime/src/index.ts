/** 受配对设备能力进入统一 Tool Kernel 的生产 Adapter 边界。 @packageDocumentation */
export {
  NODE_TOOL_CAPABILITIES,
  NodeToolInvocationError,
  createNodeToolAdapters,
  resolveAvailableNodeToolCapabilities,
  type NodeInvocationOutcome,
  type NodeInvocationPersistencePort,
  type NodeToolCapability,
  type NodeToolRuntimeOptions,
  type NodeToolScope,
} from './node-tool-adapters';
