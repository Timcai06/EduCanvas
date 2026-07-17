import 'server-only';

import { channel } from 'node:diagnostics_channel';
import type { TeachingObservabilityPort } from '@educanvas/teaching-runtime';

const metricChannel = channel('educanvas.teaching.metric.v1');

/**
 * Node 组合根只发布低基数、无正文的封闭指标事件。部署平台可订阅该 channel
 * 转发到正式指标后端；没有订阅者时它是低开销 no-op。
 */
export const webTeachingObservability: TeachingObservabilityPort = {
  record(metric) {
    metricChannel.publish(metric);
  },
};
