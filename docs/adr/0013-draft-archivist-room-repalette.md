# ADR-0013: Draft 主题改「档案室」配色(泛黄纸 + 蓝黑墨水)

- 状态:partially superseded(D1''/D3'' 由 ADR-0022 取代、D3'' 固定书皮色由 ADR-0020 取代,D4''/D5''/D6'' accepted)
- 日期:2026-07-13
- 范围:layer2(web)Draft 主题配色方向从陶土橙暖纸改档案室(泛黄纸 + 蓝黑墨水);supersedes ADR-0006 的 D1'(陶土橙 accent)与 D3'(牛皮纸书皮 + 陶土色板);保留 0006 的 D2'(换皮机制)、0005 的 D2/D4/D5。
- 关联:ADR-0006(被取代 D1'/D3')、ADR-0005(D2/D4/D5 继续)、CONTEXT.md「主题」节、ADR-0003(layer2 SPA 不破坏三层)

## 背景

ADR-0006(2026-07-07)定 Draft 走 Anthropic 档案材质色:陶土橙 `#d97757` accent + kraft 牛皮纸书皮 + manilla 信封展台 + 暖米白底。落地后观感「烟熏 + 老旧」:

1. **烟熏**:hero 标题 text-shadow、drawer-pull knob 辉光、fairy 行扫描亮峰等用陶土橙做的「辉光」,在浅底上不是发光而是发糊,标题周围橙褐烟雾。
2. **配色浑浊**:页面 `#f0efea` + 展台 `#eeece6` + 书皮 `#e4d1c2` + 陶土橙,全挤在暖褐窄带,无冷暖对比。
3. **假复古**:ADR-0006 只借了材质色名(clay/kraft/manilla),没做真复古的任何质感(纸纹不可见、全 sans 无衬线、无做旧),是「挂复古名的暖褐脏色」。

一次 grilling session(五轮)厘清:问题不是「配色丑」本身,是方向只走到取色、没走到质感,且暖橙满铺与浅色阅读氛围冲突。决策:留复古方向(B),但把形态从「暖纸陶土」改成「档案室(Registrar's Office)」--深色 Archive = 档案库夜灯(不动),浅色 Draft = 档案室日灯。

## 决策

### D1'':Draft accent 改蓝黑墨水 `#2b4a6f`(supersedes ADR-0006 D1')

- **Archive** accent 仍是靛青 `#6b8fc7`(不动)。
- **Draft** accent 改蓝黑墨水 `#2b4a6f`(档案登记本钢笔墨水),配套 `--accent-soft:#4a6b8f` / `--accent-bright:#3a5d85`。
- **与 Archive 同源蓝系**:靛青 `#6b8fc7` ↔ 蓝黑墨水 `#2b4a6f`。切换主题时 accent 不再从陶土橙跳靛青--修掉 ADR-0006 D1' 的「accent 跳变是有意为之」副作用,是净改进。
- **陶土橙不删除**:`#d97757` 从 Draft 主 accent 降级为 `DRAFT_ACCENTS` 案卷色板的一席偶发暖点缀(见 D3'')。保留 ADR-0006 的材质正色传承,只是不当主 accent。
- 已落地:`global.css` 的 `:root[data-theme="draft"]` 块 accent 系 token 全换;`--glow-accent`(focus/hover ring)改墨水描边去发光。

### D3'':Draft 书皮改泛黄纸 + 案卷色板(supersedes ADR-0006 D3')

书皮与展台在 Draft 下从「kraft 牛皮纸 + 陶土色板」改「泛黄纸 + 案卷色板」:

| 层 | Archive(暗,不动) | Draft(浅,新) |
|----|-------------------|----------------|
| 展台底 `--surface-shelf` | `#12121a` | `#ece4d2`(比页面略深的纸色) |
| 书皮底 `DRAFT_COLORS.darkBase` | `#12121a` | `#e8e0cc`(泛黄纸书皮) |
| 纸边 `DRAFT_COLORS.paper` | `#e8ddd0` | `#fdfbf5`(最亮纸白,书顶/书底/书边跳出) |
| 书 accent 色板 | ARCHIVE_ACCENTS(靛青系 6 色) | DRAFT_ACCENTS(案卷色板 6 色,见下) |
| 书脊装饰线 `topAccent` / rim 光 | `#6b8fc7` 靛青 | `#2b4a6f` 蓝黑墨水 |

层次:页面 `#f7f3ec` < 展台 `#ece4d2` < 书皮 `#e8e0cc`,纸边 `#fdfbf5` 最浅跳出(沿 ADR-0006 D3' 的分层原则:浅底同色会糊,必须分层)。

**Draft 案卷色板**(`DRAFT_ACCENTS`,按书名 hash 分配,主色对齐 Draft accent):

```
#2b4a6f  蓝黑墨水(主,对齐 Draft accent)
#5a7a5a  档案局墨绿
#8a3a2f  朱砂戳印红(偶发暖)
#b88a4a  陶土橙(ADR-0006 材质正色传承,降级偶发暖点缀)
#6a5a8a  墨紫
#4a6a6a  灰青
```

### D4'':动效--辉光去除 + 扫描转墨迹

浅色下辉光即烟熏,装饰辉光全去;Archive 招牌扫描动效结构保留,语义转墨迹:

- **去除**:`.hero h1` text-shadow(浅色下 none)、`.drawer-pull-knob` box-shadow 辉光段(只留描边)、`.drawer-pull-line` box-shadow(全去)、`--glow-accent`(focus/hover ring 改 `0 0 0 1px var(--accent-border)` 描边,去 `0 0 14px` 发光)。
- **转墨迹**:`.hero::before/::after` 横扫、`.chat-row-fairy::before` 竖扫的亮峰,从 `transparent -> accent-border -> transparent` 渐变(光束感)改 `transparent -> accent -> accent -> transparent` 实色细线(墨迹);hover 透明度上限 `0.9` -> `0.5`。用 `background-image` 覆盖(不重置 `background-size`,动画位移不破坏)。
- **不动**:动画 `@keyframes` 周期与位移;`.header::after` 45° 警戒带斜纹(封条语言);`.section-heading::before` 色条;`.hero-bg` 横线纹理(登记本格线)。
- **理由**:切主题时扫描线不突现/突灭(沿 ADR-0006 D2' 换皮不重建的同款精神);浅色获独立动效身份(墨迹),非深色监控台的「删减版」。

### D5'':字体--标题衬线 + 正文 sans + mono 标签

新增 `--serif` 字体栈与语义 token `--heading-font`:

- `--serif: Georgia, "Songti SC", "STSong", "SimSun", "Noto Serif SC", serif`(macOS Songti SC / Windows SimSun / Noto Serif SC / 默认 serif 逐级回落)。
- `--heading-font: var(--sans)`(放 `:root`,默认 sans,Archive 继承);`:root[data-theme="draft"]` 覆盖 `--heading-font: var(--serif)`。
- 标题(`.prose h1/h2/h3`、`.card-title`、`.section-heading`)用 `var(--heading-font)`:Draft 下衬线(档案出版物气质),Archive 下 sans(零回归)。`.hero h1` 保留 sans(两主题一致)--hero 大字横幅,衬线在大字号下不合适,经反馈保留 sans。
- 正文 `.prose` / body 保 `var(--sans)` 不动(中文长文可读,衬线小字号发虚是硬伤)。
- **mono 扩大**:档案标签语义元素(`.card-sections`、`.page-nav-direction`、`.bottom-drawer-section-title`、`.bottom-drawer-count`、`.bottom-drawer-section-count` 等)统一 `var(--mono)`,强化打字机档案语言。
- **对 ADR-0005 D2 的小扩展**:D2 原「Draft 块仅覆盖颜色 token」,本决策让 Draft 块也覆盖字体语义 token(`--heading-font`)。这是必要的最小扩展--标题衬线是档案室形态的核心一笔,无法只靠颜色 token 实现。

### D6'':纸纹提强

body 背景噪点 SVG `opacity` 从 `0.022`(基本不可见)提到 `0.04`(可见但不抢)。让纸像纸,补「真复古」的纸质感。`.hero-bg` 横线纹理保留作「登记本格线」。

## 后果

- **ADR-0006 D1'/D3' 被 supersede**:本文 D1''/D3'' 取代。0006 的 D2'(换皮机制)继续 accepted。0005 的 D2(受本 D5'' 小扩展)/D4/D5 继续 accepted。
- **浅深 accent 同源不跳变**:切 Archive↔Draft 时 accent 在靛青↔蓝黑墨水间过渡(同源蓝系),修掉 0006 D1' 的「跳变有意」副作用。
- **陶土橙降级非删除**:`#d97757` 留在 `DRAFT_ACCENTS` 色板一席,作为 ADR-0006 材质正色传承。后人若问「为何浅色留一抹陶土橙」--答案是传承,非遗漏。
- **Draft 覆盖块扩展到字体 token**:`--heading-font` 是 D5'' 对 ADR-0005 D2 的扩展点。未来加第三主题若需不同标题字体,沿用此 token。
- **深色 Archive 零改动**:`:root` 块、`ARCHIVE_COLORS`、`ARCHIVE_ACCENTS`、动画发光全保留。切 Archive 后靛青 accent、glow、扫描亮峰、sans 标题全在,是硬性验收点。
- **后人疑问预案**:为何 Draft 用蓝黑墨水而 Archive 用靛青?--同源蓝系,浅色归档案登记本墨水(本文 D1'')。为何 Draft 书皮泛黄纸而 Archive 深舞台?--Draft 是档案室日灯,Archive 是档案库夜灯(本文 D3'' + 0005 D3 隐喻)。为何浅色留一抹陶土橙?--ADR-0006 材质正色传承(本文 D1'')。
