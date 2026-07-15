# 教学Canvas与GSAP

- 状态：`accepted`
- 相关决策：[ADR-0002](../09-decisions/0002-controlled-canvas.md)

## 核心决定

Canvas是受控教学组件运行时。模型输出结构化Artifact，前端选择审核过的React组件渲染。模型不能在主页面执行任意HTML或JavaScript。

## 当前实现状态

- **已实现**：`classification_game`、`quiz`的严格Schema，公开投影/私有判分键拆分，编译期静态Renderer注册表和确定性服务端判分；
- **阶段一待实现**：`pipeline_flow`动画模板、共享`AnimationShell`、GSAP时间线与播放控制、学习事件上报、认证后的浏览器提交链路；
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

- 使用`@gsap/react`和`useGSAP()`；
- 每个组件使用独立`scope`；
- 组件卸载时必须回收Timeline；
- 优先使用`transform`和`opacity`；
- 页面不可见时暂停动画；
- 支持降低动态效果；
- 不在服务端渲染阶段执行GSAP；
- 高频指针跟随优先使用`quickTo()`；
- 低端设备也要验证动画流畅度。

## 统一控制协议

动画Artifact需要支持：播放、暂停、跳转、上一步、下一步、重置和速度控制。

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
