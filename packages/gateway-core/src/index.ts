/**
 * Pure, versioned control-plane contracts for EduCanvas Gateway.
 * 仅导出协议层定义（schema/type/错误码），不承载实现细节，以免形成依赖污染。
 */

export * from './capabilities';
export * from './channels';
export * from './citations';
export * from './common';
export * from './delivery';
export * from './envelopes';
export * from './events';
export * from './handoffs';
export * from './identity';
export * from './native-client-auth';
export * from './nodes';
export * from './routing';
