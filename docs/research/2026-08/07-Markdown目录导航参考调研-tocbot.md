# Markdown 目录导航参考调研：tocbot

- 状态：`draft`
- 负责人：hzlgou
- 创建时间：2026-08-26
- 相关分支：`docs/20260826-artifact-display-research`

## 一、调研定位

**目标**：为 EduCanvas Markdown 文档只读渲染路径（`apps/web/features/canvas/note-renderer.tsx` 的 readOnly 分支，复用为 `markdown_document` 产物查看器）的显示优化提供源码级参考。

**当前渲染器的显示短板**（对照 2026-08-26 main @ `4f97d7d6`）：

1. 长文档（Schema 上限 60,000 字符）无目录 TOC、无章节跳转；
2. 无阅读进度指示；
3. 只读模式仍渲染底部操作栏（空占位 + 「只读」标签）与编辑工具栏残留逻辑。

**范围边界**：

- ✅ 标题提取与锚点生成、scroll-spy 高亮算法、平滑滚动、节流策略
- ❌ 全文搜索、Mermaid、导出——不在本轮显示优化范围

## 二、项目概览

| 项目 | 版本（克隆 HEAD） | 许可 | 定位 |
| --- | --- | --- | --- |
| [tocbot](https://github.com/tscanlin/tocbot) | `e50da5f` 2026-05-14 | MIT | 经典 scroll-spy 目录库，零依赖 |

## 三、实现分析

### 3.1 TOC 构建：标题扫描 + 栈式嵌套

`contentElement.querySelectorAll(selector)` 提取标题（可拼 `:not()` 排除项），按 H 级别用栈嵌套成树（`src/js/parse-content.js`）。锚点 id 生成本体在站点工具 `src/utils/make-ids.js`：优先复用已有 `heading.id`，否则 slug 化 + 计数表处理重名：

```js
var id = heading.id ? heading.id
  : heading.innerText.trim().toLowerCase()
      .replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
headingMap[id] = !isNaN(headingMap[id]) ? ++headingMap[id] : 0
if (headingMap[id]) heading.id = id + "-" + headingMap[id]
else heading.id = id
```

「复用已有 id 优先」适配 react-markdown 已生成 id 的场景。

### 3.2 scroll-spy 核心：offsetTop 扫描，非 IntersectionObserver

document 级 `scroll` 监听 + 每次遍历比较 offsetTop。激活判定：找第一个顶边超过「scrollTop + offset + 10」的标题，取其**前一个**为当前；滚到底则强制取最后一个（`src/js/build-html.js` getTopHeader）:

```js
some.call(headings, (heading, i) => {
  if (getHeadingTopPos(heading) > scrollTop + options.headingsOffset + 10) {
    topHeader = headings[i === 0 ? i : i - 1]; return true
  }
  if (i === headings.length - 1) { topHeader = headings[i]; return true }
})
```

性能细节：新旧激活链接相同直接 return；className 仅变化时写入 DOM。另有 bottom-mode 兜底：目标无法滚到视口顶部时仍高亮点击/hash 对应项。

### 3.3 平滑滚动与 hash

body 上委托监听点击，rAF 循环 + easeInOutQuad 缓动（默认 420ms）；**不 preventDefault**，让浏览器原生更新 hash；跳转结束给目标元素临时 `tabIndex=-1` 并 `focus()` 保证键盘可达性（`src/js/scroll-smooth/index.js`）。

### 3.4 节流策略

auto 策略：间隔 <334ms 用 debounce，否则 throttle（默认 50ms debounce）——原因是 iOS 限制 `pushState` 每 30 秒最多 100 次（若开启滚动中同步 hash）。点击 TOC 后置 `isClick=true` 并暂停高亮动画 `scrollSmoothDuration+100ms`，**避免平滑滚动过程中高亮乱跳**。

## 四、对 EduCanvas 渲染器的借鉴映射

按性价比排序（目标文件 `apps/web/features/canvas/note-renderer.tsx` 或新建 `markdown-document-view.tsx`）：

| # | 借鉴点 | 落地方式 |
| --- | --- | --- |
| 1 | **TOC 构建 + 重名去重锚点** | 渲染后从 article 容器 querySelectorAll(h1-h4) 建目录；slug 化沿用中文场景需保留 CJK 字符（`replace(/[\s]+/g,'-')` 去掉 ASCII-only 过滤），计数表去重 |
| 2 | **scroll-spy 换容器化实现** | 监听**滚动容器**（prose 外层 div）的 scroll 事件而非 document，offsetTop 扫描算法照搬；≥3 个标题才显示目录；激活项高亮用现有 accent token |
| 3 | **点击暂停高亮** | 点击目录项后 ~500ms 内冻结 spy 更新，避免平滑滚动期间高亮抖动 |
| 4 | **阅读进度条** | 容器 scrollTop / (scrollHeight - clientHeight) 映射到顶部细条（同 Slides 的 scaleX 方案） |
| 5 | **只读态瘦身** | readOnly 且非 latest 时隐藏整个底部栏与编辑工具栏分支，替代现在的空占位 |

**不采纳**：IntersectionObserver 方案（受控固定宽度 prose 容器内 offsetTop 扫描更简单可靠，且我们不需要跨动态布局健壮性）；URL hash 同步（产物视图内跳转无需路由联动，规避 iOS pushState 限制问题）；rAF 自绘平滑滚动（原生 `scrollTo({behavior:'smooth'})` 足够，配合点击暂停高亮即可）。

## 五、证据与边界

- 证据等级：**事实**——tocbot 克隆源码直读，版本见表二，快照日期 2026-08-26；
- MIT 许可；本文档只提炼算法模式不复制代码；
- 实施约束：目录数据从已渲染 DOM 读取（react-markdown 输出后 useEffect 扫描），不解析原始 markdown（避免两套解析不一致）；中文 slug 规则须显式定义并测试；spy 监听须在容器卸载时清理。
