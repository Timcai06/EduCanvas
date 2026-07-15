import 'server-only';
import {
  artifactSchema,
  prepareArtifact,
} from '@educanvas/canvas-protocol/server';
import { CanvasArtifactRenderer } from './canvas-registry';

// 服务端样例用于持续验证“完整Artifact校验→公开投影→受控渲染”边界。
// 接入模型、持久化与真实课程后仍必须经过同一服务端协议边界。
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
 * 当前已接入静态Renderer注册表；GSAP模板、持久化和浏览器提交链路仍待实现。
 * 完整约束见 docs/02-architecture/canvas-and-gsap.md。
 */
export function CanvasStage() {
  const validation = artifactSchema.safeParse(sampleArtifact);
  const publicArtifact = validation.success
    ? prepareArtifact(validation.data).publicArtifact
    : null;
  const validationErrors = validation.success ? [] : validation.error.issues;

  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-4 text-lg font-semibold">教学 Canvas</h2>
      <div className="flex-1 rounded-lg border border-dashed border-slate-300 p-4 text-sm">
        {publicArtifact ? (
          <div>
            <p className="mb-2 font-medium text-green-700">
              ✓ 受控组件：{publicArtifact.title}（{publicArtifact.type}）
            </p>
            <CanvasArtifactRenderer artifact={publicArtifact} />
          </div>
        ) : (
          <ul className="text-red-600">
            {validationErrors.map((issue) => (
              <li key={`${issue.path.join('.')}:${issue.message}`}>
                {issue.path.join('.') || '(root)'}: {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
