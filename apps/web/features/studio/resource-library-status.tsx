import type { WorkspaceResourceSummary } from '@educanvas/canvas-protocol';
import { Badge } from '@/components/ui/badge';

type ResourceStatus = WorkspaceResourceSummary['status'];

export const resourceStatusLabels: Record<ResourceStatus, string> = {
  processing: '处理中',
  ready: '可用',
  failed: '失败',
  unavailable: '暂不可用',
  archived: '已归档',
};

const resourceStatusVariants: Record<
  ResourceStatus,
  'warn' | 'good' | 'bad' | 'neutral'
> = {
  processing: 'warn',
  ready: 'good',
  failed: 'bad',
  unavailable: 'neutral',
  archived: 'neutral',
};

/** Resource Library 状态只通过共享 Badge 呈现，筛选文案与徽章文案共用同一事实源。 */
export function ResourceStatusBadge({ status }: { status: ResourceStatus }) {
  return (
    <Badge variant={resourceStatusVariants[status]}>
      {resourceStatusLabels[status]}
    </Badge>
  );
}
