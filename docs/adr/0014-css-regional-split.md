# ADR-0014: web CSS 按区域拆分,Draft 覆盖随区域走

- 状态:accepted
- 日期:2026-07-15
- 范围:layer2(web)`global.css`(3682 行)按功能区域拆分为 7 个文件,删除 `global.css`。纯 locality 重组,不改样式值。
- 关联:ADR-0005(D2 token 收口 `:root`,本候选不动)、ADR-0006/0013(Draft 主题覆盖点)、ADR-0003(layer2 SPA 不破坏三层)

## 背景

`web/src/styles/global.css` 单文件 3682 行,整个 app 的 CSS 全在此。`main.tsx` 单一 `import './styles/global.css'`。Draft 主题覆盖散落 5 处(token 块 L109、组件覆盖集中块 L161–203、chat-drawer-panel L2133、settings-switch-knob L3169、theme-toggle-knob L3477)。改 Draft 主题或任何组件样式要全文扫 3682 行找覆盖点--ADR-0013 厘清 Draft 配色花了 5 轮 grilling,根因就是缺 locality,覆盖点不可枚举。

本 ADR 是 locality 重组,不是重新设计:所有样式值(颜色/间距/字体/动效)零改动,只搬移规则到对应区域文件。

## 决策

### D1:拆分粒度 -- 沿现有段头边界,按功能区域合并

`global.css` 已有 ~47 个 `/* ── XXX ── */` 段头,天然分区。沿段头边界切,合并相邻段为 7 个区域文件:

| 文件 | 内容 |
|---|---|
| `tokens.css` | `:root` + `:root[data-theme="draft"]` + `:root` 的宽屏 media(`--content-w`) |
| `base.css` | Reset / App Shell / States / 浮动控件(fab/back-to-top)/ 全局 toast / 混合 `@media` 块(768px 跨区 + print) |
| `header.css` | Header / Breadcrumb / Search / 对话按钮 / 设置按钮 / 主题开关 |
| `home.css` | Hero / Section Headings / Card Grid / 3D 书架 / 下栏 + hero/drawer-pull 的 Draft 覆盖 |
| `article.css` | Article 系列(Prose/Headings/Tables/Code 等 10+ 段)+ toc/page-nav |
| `chat.css` | Chat 系列(抽屉/面板/时间线/markdown/思考胶囊)+ chat-row-fairy 的 Draft 覆盖 |
| `settings.css` | Settings 系列(表单/下拉/关于)+ settings-switch-knob 的 Draft 覆盖 |

不严格"按组件"(一个组件常对多段,且全局段落无单一归属);不"按区域过粗"(一个 `components.css` 仍几千行,locality 丢)。段头边界零主观,机械移动风险最低。

### D2:Draft 覆盖 -- token 归 tokens,组件级覆盖随区域走

- Draft **token** 覆盖(`:root[data-theme="draft"]` 颜色/字体 token,L109–153)归 `tokens.css`。
- Draft **组件级**覆盖随区域走:`chat-drawer-panel`→chat、`settings-switch-knob`→settings、`theme-toggle-knob`→header、`hero`/`drawer-pull` 覆盖→home、`chat-row-fairy` 覆盖→chat。原 L161–203 的集中块(横跨 home/chat)据此拆散。

locality 轴是组件:改 chat 在 Draft 下的表现去 `chat.css` 一处。拆分后单文件已降到几百行,"改 Draft 扫 3682 行"的痛点已解;`grep '[data-theme="draft"]'` 命中分布可预测(tokens + 各区域),不再散落于一个 3682 行大文件。

### D3:引入方式 -- main.tsx 集中 import;单区域 media 归区域,混合 media 进 base 排最后

- `main.tsx` 集中 import 7 个文件(否决组件级 `import './X.css'`:Vite 下加载序 = 组件挂载序,非确定,响应式有概率失效)。
- import 顺序:`tokens.css` 置顶(被所有 `var()` 依赖);`base.css` 排最后(见下);区域文件居中。
- **单区域 `@media` 块**(纯一区域选择器)归该区域:1024px toc→article、1023px cards→home、480px hero→home、767px chat-drawer→chat、1440px `:root`→tokens。同区域 media + 基础样式同文件,顺序不依赖跨文件加载序。
- **混合 `@media` 块**(跨多区域选择器)整体进 `base.css`,base 排最后 import:
  - `@media (max-width:768px)`(含 `:root`/hero/cards/header/article/page-nav/fab/toc)--内部跨 5 区,不拆散。
  - `@media print`(隐藏 header/fab/toc/page-nav + body/a + `.prose pre`)--跨多区,不拆散。
  - **不拆散混合块的理由**:渐进式(D5)不能跨 commit 拆散一个 `@media` 块内部(中间状态 `global.css` 会有半个块,语法破裂)。base 排最后保证混合块的同特异性 media 覆盖在区域基础规则之后生效。代价:改某组件的 768px/print 响应式要去 `base.css`(非该区域文件),这是 locality 妥协,换渐进式的可中途停 + 单步可验证。

### D4:token 层 -- 拆 tokens.css,删 global.css

ADR-0005 D2 要求 token 收口 `:root`,指变量定义集中在 `:root` 选择器,**不绑定文件名**。拆 `tokens.css` 不违背。`global.css` 在最后一个 commit(切完 settings)删除,`main.tsx` 去掉其 import。`--heading-font` 是 ADR-0013 D5'' 对 D2 的小扩展点,仍随 Draft token 块在 `tokens.css`。

### D5:渐进式 7 commit

1. 拆 `tokens.css`(置顶)
2. 拆 `base.css`
3. 拆 `header.css`
4. 拆 `home.css`
5. 拆 `article.css`
6. 拆 `chat.css`
7. 拆 `settings.css` + 删 `global.css`

每步连带搬该区域的单区域 `@media` 块。每步后 app 可运行、视觉不变(机械移动,值未改)。

## 被否备选

- **严格按组件**:一个组件对多段 + 全局段落无归属,做不通,退化成按区域。
- **按区域过粗**(layout/components/theme):一个 `components.css` 仍几千行,locality 丢。
- **集中 `draft-overrides.css`**:组件轴 locality 损(基础在区域、Draft 覆盖在别处),拆分后单文件已小,grep 即达,集中的边际收益小。
- **组件级 `import`**:Vite 下挂载序非确定,响应式覆盖顺序不可控。
- **一次性 3682 行重组**:diff 巨大、中途不可停;渐进式贴合 surgical/可验证偏好。
- **完全拆散混合 `@media` 块**(每个区域一个同条件 media):locality 最好,但与渐进式冲突(不能跨 commit 拆散块内部),且重组块结构增加 review 面。一次性方案下可选,渐进式下否决。
- **CSS-in-JS / CSS Modules / Tailwind**:换技术栈,超范围(YAGNI),biome/vite 配置要跟着改。

## 后果

- **locality 改善**:改组件样式去对应区域文件;Draft 覆盖随区域可枚举。
- **混合 `@media` 块在 `base.css`**:改 768px 响应式或 print 样式去 `base.css`,非各区域文件。这是渐进式 + 不拆散混合块的代价。
- **`base.css` 排最后是硬约定**:后人新增 CSS 文件须在 `main.tsx` 保持 `base.css` 最后 import,否则混合 media 覆盖失效。本 ADR 记录此约定。
- **`tokens.css` 置顶是硬约定**:被所有区域 `var()` 依赖(虽 CSS 变量运行时合并、顺序不敏感,但置顶是语义惯例)。
- **深色 Archive 零改动 / Draft 视觉零改动**:纯机械搬移,验收点。
- **不碰 `BookShelf3D.tsx`**:canvas 颜色常量(ARCHIVE/DRAFT_COLORS)是 TS 非 CSS,本候选不碰。

## 验证

- `make format` / `make typecheck` 通过。
- Archive + Draft 两主题视觉与拆前一致(首页/文章/聊天/设置/书架)。
- `grep '[data-theme="draft"]'` 命中 `tokens.css` + chat/settings/header/home,不再散落 5+ 处于一个 3682 行文件。
