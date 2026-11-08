# dsh-panel-layout

中文 | [English](README.en.md)

https://github.com/user-attachments/assets/9111c670-63ae-499f-ab50-a6fcf16fad87

| 视图 | 浅色 | 深色 |
|---|---|---|
| 按钮行 · 1 行 | ![按钮行 1 行（浅色）](https://github.com/user-attachments/assets/2868e611-14ed-4aa7-9e16-e0c783639fa5) | ![按钮行 1 行（深色）](https://github.com/user-attachments/assets/9b7c6b2e-10f2-43cc-8a1d-21d96dab6653) |
| 按钮行 · 2 行 | ![按钮行 2 行（浅色）](https://github.com/user-attachments/assets/01c45f3d-7cc0-4ef2-ae1a-bac50c644027) | ![按钮行 2 行（深色）](https://github.com/user-attachments/assets/56b6452c-c0d3-4e09-8979-b965003c9cfe) |
| 列表 | ![列表模式（浅色）](https://github.com/user-attachments/assets/82e14045-e8d3-49fe-a237-1318a238e5e1) | ![列表模式（深色）](https://github.com/user-attachments/assets/f1d5eb52-d1c2-4dcf-9c48-707ce95bfcb5) |
| 设置项 | ![设置 → 通用（浅色）](https://github.com/user-attachments/assets/980a08e6-227e-4df4-9b38-cff6f86fe349) | ![设置 → 通用（深色）](https://github.com/user-attachments/assets/19f613b3-fe3a-436f-9635-6589eb4e4a93) |

侧边栏面板菜单的布局、排序与收纳。用按钮行或列表排布「插件 / 插件市场 / 上下文 / 任务板 / MCP …」这一栏，设定按钮行最多几行，拖动排序；放不下的和左下角「更多」里的设置、意见反馈、登录一起收进「更多」。

DSH Web 侧边栏顶部的全局面板菜单（`sidebar.panellist`）由宿主渲染：每项一行带图标与文字，末尾是「更多」启动器。左下角的账号启动器在未登录时就是一个「更多」，底下挂着设置 / 意见反馈 / 登录三项。本插件把这两处合成一个可配置的菜单。

## 能力

| 能力 | 说明 |
|---|---|
| 布局切换 | 设置 → 通用 → 「侧边栏面板菜单」在 **按钮行** 与 **列表** 之间切换，默认按钮行 |
| 按钮行行数 | 1–3 行，默认 1 行；按侧边栏实际宽度算每行格数（36px 单元格 + 4px 间距） |
| 拖动排序 | 直接在面板菜单里拖任意一项到另一项上；行模式按左右半区判断插入点，列表模式按上下半区 |
| 从「更多」拖出来 | 「更多」里的项同样可拖，拖到面板栏某行的前半区就插到它前面，拖出来即恢复可见 |
| 移到最前（触屏） | 「更多」每行右侧有一个向上箭头，点一下该项排到第一，自动回到可见区；触屏没有 HTML5 拖拽，用这个 |
| 溢出收纳 | 超出上限的项隐藏，同时列进宿主自己的「更多」菜单，顺序一致 |
| 列表上限 | 列表模式下默认只显示前 4 项，从第 5 项起进「更多」 |
| 吸收左下角「更多」 | 设置 / 意见反馈 / 登录变成面板菜单里的普通项，沿用它们原本的图标，也能一起拖动排序；左下角那个「更多」在未登录时隐藏 |
| 登录态感知 | 登录后不再显示「登录」项；左下角恢复为账号头像入口，不再隐藏 |
| 收起侧栏 | 图标栏放不下也拖不动，此时不隐藏左下角入口，三项仍从原处可达 |

设置存浏览器 `localStorage`（`dsh-panel-layout:settings` / `dsh-panel-layout:order`），与宿主自身的面板上/下钉（`setPinned`）互不干扰。

## 安装

```bash
dsh plugin --profile web add github:devome/dsh-panel-layout
```

在 DSH 的插件市场里搜 `dsh-panel-layout` 点安装也一样——市场对 GitHub 条目执行的就是这条命令。发布到 npm 之后，命令可简写为 `dsh plugin --profile web add dsh-panel-layout`。

装好后刷新页面生效；修改 `lib/client.js` 需要重启 Harness 才会重新生成浏览器模块。

## 实现要点

宿主只把面板项的**图标**交给 `sidebar.panellist` 槽，行距、行数上限和顺序都归宿主所有，没有任何槽暴露这些。因此本插件：

1. 通过每行的 `data-slot="sidebar.panellist"` 锚点定位面板栏，用 `aria-haspopup="menu"` 认出「更多」启动器；
2. 给行打自己的 `data-dpl-*` 属性，用 flex `order` 排序、用 `display:none` 隐藏溢出项——宿主重渲染也不会丢；
3. 引用 `<html data-dpl-mode>` 上的单一开关做样式门控，切回列表或卸载插件时宿主外观原样恢复；
4. 只用 `sidebar.panellist.actions` 往宿主的「更多」里补行——那是 DOM 做不到的事：把被上限挤出去的项补回去。

吸收进来的「设置 / 意见反馈 / 登录」分别走：宿主命令 `settings.open`（无绑定时先调宿主交给启动器的 `openSettings`，那里没有才回放「打开账号菜单 → 点设置行」这条人工路径）、宿主自己用的公开问卷链接（`__DSH_CONTACT_CONFIG__`，缺省值与宿主一致）、宿主账号流的 `startSignIn`（授权 URL 只在 attempt 走到 `waiting-browser` 后才出现，所以跟随 `remote.$stream` 的 account 流取，而不是读一次性返回值）。

不引入任何 Harness 客户端包，只用 `--dsw-alias-*` 主题令牌，所以宿主升级换了类名也不会崩。

## 开发

```bash
node test/manifest.mjs                      # 清单、导出、patch、语言包、图标
node test/smoke.mjs                         # 纯函数 + DOM 调和
DPL_JSDOM=/path/to/jsdom node test/smoke.mjs # 指定 jsdom 位置（不装也能跑纯函数部分）
```

`test/smoke.mjs` 用 jsdom 在真实节点上跑一遍调和：认行、排序、行数上限、溢出隐藏、登录态、图标栏不动。

## 与 `dsh-sidebar-panel-buttons` 的关系

两者都写侧边栏同一个面板栏。`dsh-sidebar-panel-buttons` 只做「按钮行 / 列表」二选一，没有行数上限、排序和收纳，也不动左下角。

本插件是它的超集：同样的按钮行 / 列表切换，再加行数上限、拖动排序、溢出收纳与左下角三项并入。**同一时间只留一个**——两个都启用时它们会各自改同一批节点，行模式外观相近但切到列表会互相顶掉。装本插件后建议停用 `dsh-sidebar-panel-buttons`。

## 已知边界

- 只作用于展开态（带文字的侧边栏）。收起后的图标栏保持宿主原样：不加按钮、不改行距、不隐藏左下角入口——三项在图标栏里没有位置，只能留在原处。
- 拖动用 HTML5 drag-and-drop，触屏不触发；触屏改用「更多」行右侧的向上箭头（点一下排第一）。
- 把一项排到最前，会把原本可见的最后一项挤进「更多」——收纳位是固定的，换来一个必然挤掉一个。
- 图标不自绘：面板项照搬它自己插件注册的那份图标结构，三项引用宿主 sprite 里的同名 symbol。宿主若改图标 id 或改成内联路径，三项会失去图标（面板项不受影响）。
- 面板项的行数上限按 36px 单元格估算；宿主若改了单元格尺寸，需同步 `CELL` 常量。

## 许可

MIT，见 [LICENSE](LICENSE)。
