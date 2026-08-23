# Web 第三方代码声明

## React Bits PixelBlast

`features/workspace/shared/pixel-blast-*` 基于 React Bits 的 PixelBlast 组件修改，固定来源：

- 项目：https://github.com/DavidHDev/react-bits
- 上游提交：`4cedd620128d36f20b5fcfdee2e27a192f82072f`
- 原始文件：https://github.com/DavidHDev/react-bits/blob/4cedd620128d36f20b5fcfdee2e27a192f82072f/src/ts-default/Backgrounds/PixelBlast/PixelBlast.tsx
- Copyright (c) 2026 David Haz

上游使用 MIT + Commons Clause License Condition v1.0：

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, and distribute the Software as part of an
> application, website, or product, subject to the following conditions.

版权声明与许可声明须保留在软件的全部或实质部分中。不得单独、打包或以移植版本出售、再许可或重新分发这些组件。软件按“原样”提供，不附带任何明示或暗示担保。

EduCanvas 将其作为产品内部视觉层使用，不把该组件作为独立组件库销售或分发。

## React Bits RippleDistortion

`features/voice/ripple-distortion/` 由 shadcn registry 的
`@react-bits/RippleDistortion-TS-CSS` 安装；仅增加本仓库 strict TypeScript 与 React
ref lint 所需的等价适配：

- 项目：https://github.com/DavidHDev/react-bits
- Registry：https://reactbits.dev/r/{name}.json
- Copyright (c) David Haz

EduCanvas 仅在外层增加 WebGL 能力检测，并把效果裁切到 Live Voice 左侧液态球；右侧
资源图片保持静态、无失真预览。不修改组件的 shader 或波纹算法。上游项目使用 MIT +
Commons Clause License Condition v1.0；本组件只作为 EduCanvas 产品内部交互使用，
不单独出售、再许可或重新分发。

## React Bits OptionWheel

`features/studio/option-wheel*` 基于 Code Owner 在 2026-07-25 提供的 React Bits
OptionWheel TypeScript + CSS 源码修改，项目来源：

- 项目：https://github.com/DavidHDev/react-bits
- Registry：https://reactbits.dev/r/{name}.json
- Copyright (c) David Haz

主要修改包括受控选中态、确认动作、中文无障碍标签、低动态模式和 EduCanvas
语义颜色。上游项目使用 MIT + Commons Clause License Condition v1.0；本组件仅作为
EduCanvas 产品内部交互使用，不单独出售、再许可或重新分发。

## React Bits 品牌与导航动效

`components/CircularText*`、`components/PillNav*`、`components/LogoLoop*`、
`components/LineSidebar*` 和 `features/workspace/shared/text-type*` 基于 Code Owner
在 2026-07-25 提供的 React Bits TypeScript + CSS 源码与 Registry 设计调整：

- 项目：https://github.com/DavidHDev/react-bits
- Registry：https://reactbits.dev/r/{name}.json
- Copyright (c) David Haz

EduCanvas 的适配补充了语义颜色、Next.js 路由、中文无障碍标签、可控状态、动画清理与
`prefers-reduced-motion`。上游项目使用 MIT + Commons Clause License Condition v1.0；
这些组件只作为 EduCanvas 产品内部交互使用，不单独出售、再许可或重新分发。
