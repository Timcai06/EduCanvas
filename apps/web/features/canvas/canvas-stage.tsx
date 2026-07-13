import { validateArtifact } from '@educanvas/canvas-protocol';

// 样例固定写在客户端代码中，是为了在模型接入前持续验证“协议校验→受控渲染”边界，
// 后续接入真实输出时也不能绕过 validateArtifact（doc/09-decisions/0002-controlled-canvas.md）。
const sampleArtifact = {
  schemaVersion: '1',
  artifactId: 'demo-cat-dog',
  type: 'classification_game',
  title: '猫和狗的分类游戏',
  params: {
    prompt: '把下面的动物拖到正确的类别里',
    categories: [
      { id: 'cat', label: '猫' },
      { id: 'dog', label: '狗' },
    ],
    items: [
      { id: 'i1', label: '橘猫', emoji: '🐱', correctCategoryId: 'cat' },
      { id: 'i2', label: '柴犬', emoji: '🐶', correctCategoryId: 'dog' },
    ],
  },
};

/**
 * Canvas 教学区只接收协议校验通过的 Artifact，模型不能直接生成可执行 HTML、JS 或 GSAP 代码。
 * 当前样例是注册表和 GSAP 组件接入前的边界探针，完整约束见 doc/02-architecture/canvas-and-gsap.md。
 */
export function CanvasStage() {
  const validation = validateArtifact(sampleArtifact);

  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-4 text-lg font-semibold">教学 Canvas</h2>
      <div className="flex-1 rounded-lg border border-dashed border-slate-300 p-4 text-sm">
        {validation.ok ? (
          <div>
            <p className="mb-2 font-medium text-green-700">
              ✓ 协议校验通过：{validation.artifact.title}（{validation.artifact.type}）
            </p>
            <p className="text-slate-400">
              Canvas 渲染区占位——T2 任务在这里实现 Artifact 注册表和 GSAP 组件。
            </p>
          </div>
        ) : (
          <ul className="text-red-600">
            {validation.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
