import { describe, expect, it } from 'vitest';
import { parseCalloutMarker } from './remark-callout';

describe('parseCalloutMarker', () => {
  it('解析类型/折叠标记/标题三段', () => {
    expect(parseCalloutMarker('[!note] 标题文本')).toEqual({
      type: 'note',
      fold: null,
      title: '标题文本',
      restLines: '',
    });
  });

  it('折叠标记 + / - 与标题可自由组合', () => {
    expect(parseCalloutMarker('[!tip]-')).toMatchObject({
      type: 'tip',
      fold: '-',
      title: '',
    });
    expect(parseCalloutMarker('[!warning]+ 注意事项')).toMatchObject({
      type: 'warning',
      fold: '+',
      title: '注意事项',
    });
  });

  it('大小写不敏感且别名收敛到规范类型', () => {
    expect(parseCalloutMarker('[!FAQ] 常见问题')).toMatchObject({
      type: 'question',
      title: '常见问题',
    });
    expect(parseCalloutMarker('[!CAUTION]')).toMatchObject({
      type: 'warning',
    });
  });

  it('软换行正文进入 restLines 而不混入标题', () => {
    expect(parseCalloutMarker('[!info] 标题\n第一行正文')).toEqual({
      type: 'info',
      fold: null,
      title: '标题',
      restLines: '第一行正文',
    });
  });

  it('非 callout 文本与畸形标记返回 null（降级普通引用块）', () => {
    expect(parseCalloutMarker('普通引用内容')).toBeNull();
    expect(parseCallot('[!]')).toBeNull();
    /* 行首空白容忍：blockquote 内文本常带原始缩进 */
    expect(parseCallot('  [!note] 缩进标记')).toMatchObject({
      type: 'note',
    });
  });

  it('未知但格式合法的类型原样返回（渲染层降级 note 风格）', () => {
    const parsed = parseCallot('[!mystery] 神秘块');
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('mystery');
  });
});

/** 测试内小包装：避免每处写 parseCalloutMarker 全名 */
function parseCallot(text: string) {
  return parseCalloutMarker(text);
}
