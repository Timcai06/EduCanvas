import { expect, test, type Page } from '@playwright/test';
import {
  appendVersions,
  createArtifactFixture,
  createPicturebookArtifactFixture,
  ensureGeneralNotebook,
  openArtifactAndExpectLatest,
} from './fixtures/general-artifact-fixture';

/**
 * AR09「五渲染器走查」的可复现版本。
 *
 * 计划原文要求人工逐个打开五个渲染器确认读体验。人工走查不可复现、也无法留证，
 * 这里用既有 DB fixture 把五个产物种进同一个 Notebook，逐个在 Canvas 里打开并
 * 截图，产出 `output/renderer-walkthrough/` 下的证据图。
 *
 * 断言只保留「渲染器确实渲染出了内容」这一条底线——读体验是否好看由人看图判断，
 * 不把主观视觉写成断言。因此本文件不进默认 CI lane（见 playwright.config.ts 的
 * testIgnore），按需运行：
 *
 *   pnpm test:walkthrough
 */

const SHOT_DIR = 'output/renderer-walkthrough';

async function openCanvas(page: Page, title: string) {
  await openArtifactAndExpectLatest(page, title);
  const canvas = page.getByRole('dialog', { name: '产物Canvas' });
  await expect(canvas).toBeVisible();
  return canvas;
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await ensureGeneralNotebook(page);
});

test('走查：思维导图', async ({ page }) => {
  const fixture = await createArtifactFixture(page, 'mind_map', '走查思维导图');
  /* 刻意用接近真实课程长度的标签：#488 之前 188px 宽的节点只显示得下七个汉字，
     这里的「卷积神经网络的基本结构」等标签正是当时被截断的那一类。 */
  await appendVersions(page, fixture.artifactId, [
    {
      content: {
        contentVersion: 2,
        rootNodeId: 'root',
        nodes: [
          { id: 'root', label: '人工智能如何认识图像' },
          {
            id: 'n1',
            label: '卷积神经网络的基本结构',
            semanticRole: 'topic',
          },
          { id: 'n1a', label: '卷积层提取局部特征' },
          { id: 'n1b', label: '池化层压缩空间尺寸' },
          { id: 'n2', label: '训练中常见的问题', semanticRole: 'question' },
          { id: 'n2a', label: '过拟合与正则化方法' },
          { id: 'n3', label: '课堂动手练习', semanticRole: 'action' },
        ],
        edges: [
          { from: 'root', to: 'n1' },
          { from: 'n1', to: 'n1a' },
          { from: 'n1', to: 'n1b' },
          { from: 'root', to: 'n2' },
          { from: 'n2', to: 'n2a' },
          { from: 'root', to: 'n3' },
        ],
      },
    },
  ]);
  await page.reload();
  const canvas = await openCanvas(page, fixture.title);
  await expect(canvas.locator('[data-mind-map]')).toBeVisible();
  // 底线：长标签必须完整渲染，不被截断成省略号
  await expect(canvas.getByText('卷积神经网络的基本结构')).toBeVisible();
  await canvas.screenshot({ path: `${SHOT_DIR}/01-mind-map.png` });
});

test('走查：Slides', async ({ page }) => {
  const fixture = await createArtifactFixture(page, 'slides', '走查 Slides');
  await appendVersions(page, fixture.artifactId, [
    {
      content: {
        contentVersion: 1,
        slides: [
          {
            id: 's1',
            title: '人工智能如何认识图像',
            bullets: ['像素到特征的抽象', '卷积核提取边缘与纹理'],
            notes: '这里是演讲者备注，按 N 切换显示。',
          },
          {
            id: 's2',
            title: '课堂练习',
            bullets: ['分辨猫与狗的关键特征', '动手标注三张图片'],
          },
        ],
      },
    },
  ]);
  await page.reload();
  const canvas = await openCanvas(page, fixture.title);
  await expect(
    canvas.getByRole('heading', { level: 3, name: '人工智能如何认识图像' }),
  ).toBeVisible();
  await canvas.screenshot({ path: `${SHOT_DIR}/02-slides.png` });
});

test('走查：闪卡', async ({ page }) => {
  const fixture = await createArtifactFixture(page, 'flashcards', '走查闪卡');
  await appendVersions(page, fixture.artifactId, [
    {
      content: {
        contentVersion: 1,
        cards: [
          {
            id: 'c1',
            front: '什么是卷积神经网络？',
            back: '一种用卷积核在图像上滑动提取局部特征的神经网络。',
          },
          { id: 'c2', front: '什么是过拟合？', back: '模型记住了训练集细节。' },
        ],
      },
    },
  ]);
  await page.reload();
  const canvas = await openCanvas(page, fixture.title);
  await expect(canvas.getByText('什么是卷积神经网络？')).toBeVisible();
  await canvas.screenshot({ path: `${SHOT_DIR}/03-flashcards-front.png` });
  await canvas.getByRole('button', { name: '显示答案' }).click();
  await canvas.screenshot({ path: `${SHOT_DIR}/04-flashcards-back.png` });
});

test('走查：Markdown 文档', async ({ page }) => {
  const fixture = await createArtifactFixture(page, 'note', '走查 Markdown');
  await appendVersions(page, fixture.artifactId, [
    {
      content: {
        contentVersion: 1,
        markdown: [
          '# 图像识别入门',
          '',
          '## 一、像素与特征',
          '',
          '计算机看到的是**数字矩阵**，不是图像本身。',
          '',
          '### 1.1 卷积核',
          '',
          '> [!note] 课堂提示',
          '> 卷积核可以理解成一张小小的「找边缘」的滤镜。',
          '',
          '```python',
          'import numpy as np',
          'kernel = np.array([[-1, 0, 1]])',
          '```',
          '',
          '| 层 | 作用 |',
          '| --- | --- |',
          '| 卷积层 | 提取局部特征 |',
          '| 池化层 | 压缩空间尺寸 |',
        ].join('\n'),
      },
    },
  ]);
  await page.reload();
  const canvas = await openCanvas(page, fixture.title);
  // #487 的回归底线：标题有层级、代码块有结构与语言标识
  await expect(canvas.locator('h1')).toBeVisible();
  await expect(canvas.locator('.chat-prose__code-block')).toBeVisible();
  await expect(canvas.locator('.chat-prose__code-lang')).toHaveText('python');
  await canvas.screenshot({ path: `${SHOT_DIR}/05-markdown.png` });
});

test('走查：绘本', async ({ page }) => {
  const fixture = await createPicturebookArtifactFixture(page, '走查绘本');
  await page.reload();
  const canvas = await openCanvas(page, fixture.title);
  await canvas.screenshot({ path: `${SHOT_DIR}/06-picturebook.png` });
});
