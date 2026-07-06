# ADR-0005: 主题系统 —— Archive/Draft 双主题,书架恒深色展台

- 状态:accepted
- 日期:2026-07-06
- 范围:layer2(web)引入明暗双主题,涉及 CSS token 拆分、主题切换控件、首屏防闪、书架区作用域
- 关联:CONTEXT.md「主题」节、ADR-0003(layer2 SPA 不破坏三层)

## 背景

z-wiki 此前只有一套深色工业档案风主题(CSS 头注释称 "Archive Vault Theme"),颜色 token 全部硬编码在 `:root`,无明暗模式基础设施(无 `prefers-color-scheme`/`data-theme`/`color-scheme`),web 端也无任何 localStorage。需求:在 header 设置按钮右侧加一个 pill 滑动开关(月左日右、纯图标),控制页面明暗,并设计一套浅色工业风主题。

## 决策

### D1: 双主题命名与调色板 —— Archive(暗)/ Draft(浅冷蓝图纸),共享靛青 accent

- **Archive** = 现有深色主题,沿用不动,作为默认。
- **Draft** = 新浅色主题,走"冷蓝图纸"方向:浅灰冷底 + 深石板字 + 原子化空心边框。
- 两主题 **共享同一靛青 accent**(`#6b8fc7` 系)。理由:切换时品牌色不断裂,且 accent 是"档案/图纸"两套基底共同的工作色,不该随明暗变。

术语已入 `CONTEXT.md`「主题」节。

### D2: token 拆分 —— `:root` = Archive 默认,`:root[data-theme="draft"]` 覆盖颜色

`:root` 保留所有现有值(即 Archive,兼作无 `data-theme` 时的兜底)。新增 `:root[data-theme="draft"]` **仅覆盖颜色 token**(surface/text/accent/border/shadow/code 等)。共享 token(font/spacing/radius/size/`--nav-h`/`--content-*`)**留 `:root` 不动**,两主题继承同一套。

这是最小改动:不移动任何现有变量,Archive 视觉零变化,Draft 只是覆盖层。将来加第三主题也只需再加一个 `[data-theme="xxx"]` 块。

### D3: 书架恒深色展台 —— `--surface-shelf` 不随主题变(DRAFT 下书架区仍深)

首页 3D 书架(`BookShelf3D.tsx`)是 canvas 程序化绘制,颜色**硬编码**(`#12121a`/`#0c0c12`/`#e8ddd0`/靛青封面色板),不走 CSS token。

**浅色主题下书架画布区保持深色**,不跟随变浅。两条实现:

- CSS:`--surface-shelf` 是颜色 token 但**不放进 Draft 覆盖块**——两主题都继承 `:root` 的深色值。`.book-shelf-3d` 背景 = `var(--surface-shelf)` 自然恒深。
- canvas:`BookShelf3D.tsx` 内部硬编码颜色**不改**。

**取舍理由**:书架是"档案展柜"——深色舞台与 Archive 的档案身份一致,浅色外围是"图纸台",书架区是"展柜",两者并置合理(博物馆展台恒暗,外围阅读区可亮)。且让书架跟浅色需重写 canvas 调色板(底色/纸色/封面色板/阴影/封面文字对比度),回归面广、收益小。这是**有意的不一致**,不是遗漏。

### D4: 持久化走 localStorage,不进 config.json;首屏 FOUC 防护

- **存 localStorage `theme` 键**,纯 web 本地。不进 server 的 `config.json` 单一真相源(ADR-0003 D3.1)——主题是阅读偏好,非业务/引导配置,且 dev 形态(web 直连 server)用不上 UserDataDir。不跨机器同步可接受。
- **首屏防闪**:`index.html` 的 `<head>` 注入一段同步内联脚本,在 React 挂载前据 `localStorage.theme` 设 `document.documentElement.data-theme`(无值/异常回落 `archive`)。CSS 立即按正确主题渲染,无首屏闪烁。`useTheme` hook 初值读 `data-theme`(FOUC 脚本已设),保证状态与 DOM 一致。
- **a11y**:开关 `role="switch"` + `aria-checked` + `aria-label` + Space/Enter 键盘切换,对齐项目自定义控件基准(`Select.tsx`)。

### D5: 硬编码颜色点收口到 token / color-mix

随主题才和谐的几处硬编码颜色,改成走 token 或 `color-mix`:

- `.header::after` 警戒带斜纹次色 → 新增 `--header-stripe` token(Archive 暖白 / Draft 深石板)。
- `.hero-bg` 扫描线、`.prose tbody` 斑马纹 → `color-mix(in srgb, var(--text) N%, transparent)`,两主题自适应。
- callout 语义色(note/warning/tip)、error 红色 → 保留,两主题都可读。
- `.chat-drawer-overlay` 深遮罩 → 保留(模态遮罩本就该暗化,浅色主题下深遮罩亦合理)。

## 后果

- **Archive 主题零变化**:`:root` 值未改,D2 是纯覆盖层。现有用户的默认体验不变。
- **书架在浅色主题下仍深**:这是 D3 的有意取舍。后人看 Draft 主题会问"为何书架不跟着变浅"——答案在此 ADR。若将来要让书架跟浅,需重写 `BookShelf3D.tsx` 的 canvas 调色板 + 把 `--surface-shelf` 移入 Draft 覆盖块。
- **`BookShelf3D.tsx` 颜色与 CSS token 解耦**:canvas 永远画深色舞台,不受主题切换影响。这是 D3 的代价,换零回归。
- **主题偏好不跨机器**:换设备需重选。可接受(阅读偏好,非业务数据)。
- **`color-mix` 依赖**:需现代浏览器(2023+);z-wiki 是 dev/桌面形态,目标环境均满足。
