import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

describe('Table primitives', () => {
  it('渲染语义化表格骨架', () => {
    const html = renderToStaticMarkup(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>数学</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(html).toContain('<table');
    expect(html).toContain('<thead');
    expect(html).toContain('<tbody');
    expect(html).toContain('<th');
    expect(html).toContain('<td');
  });

  it('表头使用淡墨语义色', () => {
    expect(renderToStaticMarkup(<TableHead>分数</TableHead>)).toContain(
      'text-ink-muted',
    );
  });

  it('行带分隔线并叠加 hover', () => {
    expect(renderToStaticMarkup(<TableRow />)).toContain(
      'border-b border-line/60',
    );
  });
});
