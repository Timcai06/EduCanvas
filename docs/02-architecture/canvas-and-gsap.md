# 教学Canvas与GSAP

- 状态：`accepted`
- 相关决策：[ADR-0010](../09-decisions/0010-canvas-trust-tiers.md)（取代 [ADR-0002](../09-decisions/0002-controlled-canvas.md)）

## 核心决定

Canvas 采用分层信任模型。Tier 1（判分型可信 Artifact）：模型输出结构化 Artifact，前端选择审核过的 React 组件渲染，服务端判分；Tier 2（沙箱探索型产物）：模型生成的 HTML/JS 只能在无 same-origin、禁网络的 sandboxed iframe 中运行，交互不产生可信学习事件。模型在任何 tier 下都不能在主页面执行任意 HTML 或 JavaScript。

**Tier 2 v1（已实现）**：助手消息中的 ```` ```html ```` 代码块是 Tier 2 的轻量入口——`MessageMarkdown` 识别后渲染为沙箱预览产物卡，用户显式点击"运行"才在 `HtmlSandbox`（`sandbox="allow-scripts"`、文档级 CSP `default-src 'none'`、禁嵌套 iframe 与表单提交、来源上限 256KB）中执行；v1 为纯展示型沙箱，无 postMessage 桥，产物随消息文本持久化。正式的 Artifact 生命周期（提议/确认/版本/Studio）仍属 P4，见 ADR-0010 开放问题。

## 当前实现状态

- **已实现**：`classification_game`、`quiz`的严格Schema，公开投影/私有判分键拆分，编译期静态Renderer注册表和确定性服务端判分；匿名会话范围内的浏览器提交、可信事件写入和进度回显已连通；`pipeline_flow`以render-only Artifact加入公开投影，不伪造判分键，也不复用assessment持久化路径；
- **已实现的GSAP范围**：`gsap`与`@gsap/react`已经安装；`AmbientHalo`、`CanvasPanel`和`Sheet`使用`useGSAP()`实现呼吸或表面进入动效。三层Halo的gradient/blur为静态子层，Timeline只修改wrapper的transform/opacity；页面不可见时暂停，reduced-motion不创建无限Timeline，移动端降为一层动画core加静态haze；
- **已实现的教学动画范围**：首个`pipeline_flow`模板、静态React Renderer和共享`AnimationShell`已落地，支持播放/暂停/跳转/上下步/重置/速度、键盘控制、页面隐藏暂停及reduced-motion即时切换；模型只可提供严格Schema中的步骤文案、注册槽位、高亮顺序和暂停点；
- **阶段一待实现**：将客户端动画观察与真实runtime完成确认对齐后再提升为可信学习事件，以及正式身份认证后的浏览器提交链路；普通播放不得改变mastery；
- **候选能力**：其余Artifact与动画模板按课程需求逐个增加，不因出现在规划清单中就视为已实现。

## 初始Artifact类型

以下是目标类型清单；当前落地范围以“当前实现状态”为准。

- `story_book`
- `concept_card`
- `classification_game`
- `sorting_game`
- `quiz`
- `code_lab`
- `image_observation`
- `project_task`
- `learning_summary`
- 教学动画模板族（见下节，取代原规划的单一`step_animation`类型）

## 动画走模板族，不做通用动画DSL

原规划的`step_animation`隐含"用Schema描述任意动画"的目标，本质是设计动画DSL：约束紧则动画呆板，约束松则安全边界失守。取舍改为：

- **每种教学动画是一个人工编写的参数化模板组件**，GSAP编排由人手写手调；模型输出的`params`只包含教学内容和模板允许的语义步骤（步骤文案、旁白、已注册语义槽位、高亮顺序、暂停答题点），不包含CSS选择器、任意属性、任意时长或GSAP指令；
- 表达力靠**随时间增加模板**扩展，不靠放松单个Schema的约束。首个模板为`pipeline_flow`（数据流经模型各层，覆盖"图片→特征→判断"的猫狗分类演示）；
- 候选模板还包括`feature_highlight`（在图片上逐个高亮特征）、`comparison_morph`（两个概念的对比演变），按课程需要逐个立项；
- 各模板共享一个`AnimationShell`包装组件，统一提供控制协议和学习事件上报，模板只声明自己的timeline步骤。

这里的“受控教学交互语言”是各模板自己的类型化语义参数，不是一套跨模板操纵DOM和动画属性的万能DSL。模型可以组合模板和教学步骤，Renderer始终掌握实际布局、动画属性、时长与Timeline。

## GSAP要求

以下是全部GSAP代码的工程约束。`AnimationShell`与`pipeline_flow`人工Timeline已按这些约束实现；后续模板必须逐个复用并重新验证。

- 使用`@gsap/react`和`useGSAP()`；
- 每个组件使用独立`scope`；
- 组件卸载时必须回收Timeline；
- 优先使用`transform`和`opacity`；
- 页面不可见时暂停动画；
- 支持降低动态效果；
- 不在服务端渲染阶段执行GSAP；
- 高频指针跟随优先使用`quickTo()`；
- 低端设备也要验证动画流畅度。

当前 `AmbientHalo` 是装饰性 UI 动效，不是模型可生成 Artifact，也不进入统一教学动画控制协议。Canvas 在桌面分栏使用 `region`；移动端和桌面全屏使用 `dialog + aria-modal`，背景分支 `inert`，焦点约束和归还由共享模态工具管理。

## 统一控制协议

动画Artifact需要支持：播放、暂停、跳转、上一步、下一步、重置和速度控制。

`pipeline_flow`已实现以上控制。reduced-motion下播放会同步跳到下一个人工暂停点或终点，不创建插值Timeline；页面hidden时仅暂停且不会自动恢复。设计QA入口`/design-qa/pipeline-flow`由`EDUCANVAS_ENABLE_DESIGN_QA=true`显式开启，默认返回404，不读取数据库、Provider或用户输入。

动画的关键节点必须产生学习事件，例如：

```text
animation_started
animation_paused
animation_step_completed
hint_requested
quiz_answer_submitted
classification_submitted
```

## 安全边界

模型生成的是教学语义和模板参数，不是任意GSAP源码。可操作目标只能引用模板注册的语义槽位；实际DOM、可动画属性和持续时间由人工Renderer决定。

**信任分界线**：Canvas产生的交互事件只表示客户端发生了什么，不能直接证明学生答对或掌握。服务端必须依据保存的答案、当前会话与状态机规则完成验证，再生成可信领域事件；只有可信领域事件可以进入掌握度计算。详细契约见[学习事件契约](../04-data/learning-event-contract.md)与[ADR-0006](../09-decisions/0006-trusted-learning-events.md)。

## 开放问题

- **沙箱代码生成Artifact**：Gemini Canvas类产品的灵活可视化来自"模型现写代码 + 沙箱iframe运行"（隔离靠CSP与iframe，不靠内容白名单）。若模板族表达力不够，可考虑增加一类探索性Artifact：模型生成代码在沙箱运行，其事件只作参考、不进掌握度。是否引入、何时引入，需要新ADR决定，且依赖`code_lab`沙箱基础设施先落地。
