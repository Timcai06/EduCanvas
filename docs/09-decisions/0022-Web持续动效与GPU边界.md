# ADR-0022：Web 持续动效与 GPU 边界

- 状态：`accepted`
- 日期：2026-07-22
- 决策人：项目负责人
- 产品规格：[学生端界面规格](../01-product/student-ui-spec.md)
- 质量边界：[视觉回归与动效验收](../06-quality/visual-regression.md)

## 背景

Web 是 K12 用户的主要入口。新的“两支笔”视觉在扉页使用 PixelBlast 墨点场，在真实 Turn busy 期间使用 PulsingBorder 边缘光。PixelBlast Runtime 保留液态指针与点击涟漪能力，但扉页产品配置主动选择安静自漂移，不响应鼠标。完整视觉仍需要 Three.js 与 Paper Shaders；若直接改成静态 CSS 或删除已登记的 Runtime 能力，会降低可回滚性和已确认的产品体验。与此同时，持续 GPU、WebGL Context、第三方移植代码和动态 Chunk 不能拖垮 Notebook 的输入、流式回答与无障碍边界。

## 决定

1. 正常且支持 WebGL2 的设备保留 PixelBlast 墨点场、问候呼吸、输入框黛青边缘扫光和 busy 边缘光，不以依赖体积或实现便利为由静默降级参数或帧率。**（2026-07-23 项目负责人决定：扉页墨点场去掉鼠标液态跟随与点击涟漪，改为不响应指针的安静自漂移，向 Gemini/NotebookLM 沉静背景看齐、避免喧宾夺主；这是主动的审美取舍而非静默降级。液态/涟漪能力仍保留在 Runtime 中、由配置开关。busy 边缘光不受影响。）**
2. Three.js 与 Postprocessing 只属于 PixelBlast 视觉 Adapter；Paper Shaders 只属于 busy 边缘 Adapter。两者必须 `ssr:false` 动态加载，不得进入服务端执行或无动效路由的关键 Chunk。
3. 移植的 PixelBlast 按 React 入口、Runtime、Shader、指针、触控纹理和类型拆分，单文件不得超过 360 行（2026-07 因反闪烁同步补渲从 350 上调）；来源、固定提交与许可证记录在 `apps/web/THIRD_PARTY_NOTICES.md`。
4. 每个 PixelBlast 实例最多拥有一个 WebGL Context。Runtime 必须幂等释放 RAF、Observer、事件、Texture、Geometry、Material、Composer、Renderer 和 Context；离屏、页面隐藏或 Context lost 时真正停止调度，恢复后从暂停时间连续运行。
5. `prefers-reduced-motion` 是用户主动选择的例外：水合前按减少动态处理，不创建持续 GPU；不支持 WebGL 或初始化失败的设备使用静态墨点/柔光兜底，核心 Chat 与 Composer 始终可用。
6. busy 边缘光只能映照真实 `turn.busy`，并与状态文案、停止按钮共同出现；它不是 Operation、教学状态、成绩或 Artifact 完成的可信事实。
7. 视觉依赖或 Shader 变化必须同时给出生产 Chunk、亮暗主题、移动端、后台暂停、重复挂载/卸载和低性能设备证据。目标活跃帧率与 Context 上限由视觉质量文档维护。

## 取舍与回滚

静态 CSS、物理删除液态后处理能力或只保留一个简化 Shader 的依赖更少，但会丢失已验证的 Runtime 回滚能力，因此不采用；具体产品表面可以通过受测配置关闭指针交互。把 Shader 写入业务工作区会扩大故障半径，也不采用。

回滚时可以在视觉 Adapter 入口停止挂载并启用静态兜底，不改 Notebook、Turn、教学状态或任何服务端事实；只有达到像素和交互等价的替代实现才能删除现有依赖。

2026-07-22 的生产构建中，PixelBlast 动态 Chunk 为 578,637 B（gzip 144,106 B）；经静态适配器 tree-shaking 后，Paper busy Chunk 为 52,354 B（gzip 27,731 B），低于此前 namespace 动态导入的 250,580 B（gzip 76,050 B）。这些数字是本次验收基线，不是未来可以无界增长的额度。

2026-07-23 的安静墨点场验收覆盖桌面亮暗主题、390×844 移动端和连续宽度变化；各场景均保持单一 Canvas、无横向溢出且 WebGL Context 未丢失。切到已有 Notebook 时 Canvas 归零，回到空 Notebook 后恢复为一个；页面隐藏后的 2.5 秒观测窗口内没有继续调度动画帧。四倍 CPU 限速下前台 2.2 秒观测到 67 帧，期间输入区可用、Context 未丢失且浏览器无错误。生产 PixelBlast 动态 Chunk 为 578,686 B（gzip 143,417 B），与基线相当。源码边界测试固定了扉页关闭指针液态/涟漪、尺寸变化立即补渲和单一 RAF 调度。

## 接受记录

项目负责人于 2026-07-22 明确要求“UI 效果不能有任何降级”。本 ADR 将该产品决定落实为可回滚、可测试的 GPU 与依赖边界；不授权视觉层绕过 reduced-motion、隐私、可信状态或页面可用性要求。
