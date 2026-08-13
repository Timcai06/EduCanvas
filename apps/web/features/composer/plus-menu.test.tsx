import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./plus-menu.tsx', import.meta.url)),
  'utf8',
);

describe('PlusMenu', () => {
  it('只暴露 Source intake actions，不暴露生成动作', () => {
    expect(source).toContain("id: 'upload_file'");
    expect(source).toContain("id: 'upload_image'");
    expect(source).toContain("id: 'add_link'");
    expect(source).toContain("id: 'pick_course_material'");
    expect(source).not.toMatch(
      /icon:\s*(?:PresentationChart|Cards|Slideshow|TreeStructure|Headphones|NotePencil)/,
    );
    const visibleMenu = source.slice(
      source.indexOf('export const PLUS_MENU_ITEMS'),
      source.indexOf('];', source.indexOf('export const PLUS_MENU_ITEMS')),
    );
    expect(visibleMenu).not.toMatch(/create_/);
    expect(visibleMenu).not.toContain('create_demo');
  });
});
