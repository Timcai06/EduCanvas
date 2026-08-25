'use client';

import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';

/*
 * Design QA — UI 基础件预览：同一页面给出「纸面(亮)」与「砚墨(暗)」两个面板，
 * 用于人工/截图验收 token、对比度、圆角、阴影与 reduced-motion 降级。
 * 门控见 app/design-qa/design-qa-gate.ts（EDUCANVAS_ENABLE_DESIGN_QA=true）。
 */

function PrimitiveGrid() {
  const tabs = [
    {
      id: 'overview',
      label: '概览',
      content: <p className="text-sm text-ink-muted">页签一内容。</p>,
    },
    {
      id: 'detail',
      label: '明细',
      content: <p className="text-sm text-ink-muted">页签二内容。</p>,
    },
  ];
  return (
    <div className="space-y-6 text-sm">
      <div className="space-y-3">
        <Banner tone="info" title="这一页用于验收基础件，不承载真实数据" />
        <Banner
          tone="warn"
          title="暗面板模拟砚墨"
          description="检查对比度与墨色投影是否可读"
        />
        <Banner tone="error" title="错误横幅 role=alert" />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button>主按钮</Button>
          <Button variant="secondary">次按钮</Button>
          <Button variant="ghost">弱操作</Button>
          <Button variant="danger">批改</Button>
          <Button loading>保存</Button>
          <Button disabled>禁用</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>默认</Badge>
          <Badge variant="accent">重点</Badge>
          <Badge variant="cinnabar">审批</Badge>
          <Badge variant="good">已通过</Badge>
          <Badge variant="warn">待处理</Badge>
          <Badge variant="bad">失败</Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card hover className="p-4">
          <p className="text-sm font-medium">悬停卡片（hover 抬升）</p>
          <p className="mt-1 text-caption text-ink-muted">
            shadow-float → card-hover
          </p>
        </Card>
        <Card glass className="p-4">
          <p className="text-sm font-medium">磨砂玻璃卡（glass）</p>
          <p className="mt-1 text-caption text-ink-muted">背层透过半透明纸面</p>
        </Card>
      </div>

      <div className="space-y-3">
        <div>
          <p className="mb-1 text-caption text-ink-muted">进度 40%</p>
          <Progress value={40} label="进度 40%" />
        </div>
        <div>
          <p className="mb-1 text-caption text-ink-muted">进度 75%</p>
          <Progress value={75} label="进度 75%" />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>科目</TableHead>
            <TableHead>掌握度</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>数学</TableCell>
            <TableCell>良好</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>英语</TableCell>
            <TableCell>需提升</TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <Tabs
        items={tabs}
        value="overview"
        onChange={() => {}}
        aria-label="预览页签"
      />
    </div>
  );
}

export function UiPrimitivesPreview() {
  return (
    <div className="rounded-3xl border border-line bg-canvas p-4 text-ink sm:p-6">
      <PrimitiveGrid />
    </div>
  );
}
