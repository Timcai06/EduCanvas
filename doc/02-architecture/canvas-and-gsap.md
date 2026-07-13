# 教学Canvas与GSAP

- 状态：`accepted`

## 核心决定

Canvas是受控教学组件运行时。模型输出结构化Artifact，前端选择审核过的React组件渲染。模型不能在主页面执行任意HTML或JavaScript。

## 初始Artifact类型

- `story_book`
- `concept_card`
- `step_animation`
- `classification_game`
- `sorting_game`
- `quiz`
- `code_lab`
- `image_observation`
- `project_task`
- `learning_summary`

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
animation_hint_requested
animation_answer_submitted
```

## 安全边界

模型生成的是动画语义和参数，不是任意GSAP源码。所有目标元素、可动画属性、持续时间和事件类型均由Schema白名单校验。

