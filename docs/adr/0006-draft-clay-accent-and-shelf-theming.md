# ADR-0006: Draft 主题独立陶土橙 accent + 书架随主题浅化

- 状态:partially superseded(D1' 陶土橙 accent、D3' 牛皮纸书皮由 ADR-0013 取代,D2' 换皮机制及其余决策 accepted)
- 日期:2026-07-07
- 范围:layer2(web)Draft 主题 accent 改陶土橙(不再与 Archive 同源);3D 书架展台与书皮在 Draft 下随主题浅化。**supersedes ADR-0005 的 D1(共享靛青 accent)与 D3(书架恒深色展台)**;0005 的 D2(token 拆分)/D4(localStorage + FOUC)/D5(硬编码收口)继续 accepted。
- 关联:ADR-0005(被取代 D1/D3)、CONTEXT.md「主题」节、ADR-0003(layer2 SPA 不破坏三层)

## 背景

ADR-0005(2026-07-06)定了两条:Draft 与 Archive **共享靛青 accent** `#6b8fc7`(D1,切换时品牌色不断裂);Draft 下**书架画布恒深色展台**(D3,有意不一致)。D3 末尾自己预言:"若将来要让书架跟浅,需重写 `BookShelf3D.tsx` 的 canvas 调色板 + 把 `--surface-shelf` 移入 Draft 覆盖块"。

两件事触发了这次修订:

1. **配色参考更迭**:Draft 从原"冷蓝图纸"改为参考 Claude Code 文档浅色(实测抓取其 CSS 变量:`--background-light:#fdfdf7`、`--primary:#0e0e0e`、`--accent-brand:hsl(15,63.1%,59.6%)≈#d97757` 陶土橙,以及一组档案材质色变量 `clay`/`kraft`/`manilla`/`book-cloth`)。陶土橙是 Anthropic 档案正色,浅色归它。这直接冲掉 D1 的"共享靛青"——浅深 accent 不再同源。
2. **全浅书架需求**:Draft 主背景已是暖米白 `#f0efea`(第一轮降亮后定),若书架区仍恒深 `#12121a`,浅色外围里嵌一块黑舞台,对比突兀。用户要"全浅",触发 D3 末尾预言的那次重写。

## 决策

### D1':Draft accent 改陶土橙 `#d97757`,不再与 Archive 同源(supersedes D1)

> **[2026-07-13 superseded by ADR-0013 D1'']** Draft accent 已改蓝黑墨水 `#2b4a6f`(档案登记本钢笔墨水),陶土橙 `#d97757` 降级为书架色板偶发暖点缀。本条的"陶土橙 accent / 切换时品牌色跳变是有意"结论已废止。详见 ADR-0013。

- **Archive** accent 仍是靛青 `#6b8fc7`(不动)。
- **Draft** accent 改陶土橙 `#d97757`(对齐 Claude 文档 `--accent-brand`),配套 `--accent-soft:#d4a27f` / `--accent-bright:#e88a6a`。
- **取舍**:切换主题时 accent 会从陶土橙跳靛青(不再"不断裂")。这是有意为之——浅色归 Anthropic 档案材质正色,深色 Archive 保留其冷调工业身份。两套主题各自完整,不再强求共用一个工作色。
- 已落地:`global.css` 的 `:root[data-theme="draft"]` 块 + hero/drawer-pull 的 10 处硬编码靛青光晕已改 `color-mix(var(--accent-*)…)` 跟随 token。

### D3':Draft 主题下书架随主题浅化(supersedes D3)

> **[2026-07-13 superseded by ADR-0013 D3'']** Draft 书皮改泛黄纸 `#e8e0cc` + 案卷色板(蓝黑墨水/墨绿/朱砂/陶土橙/墨紫/灰青)。本条的"kraft 牛皮纸书皮 + 陶土色板"结论已废止。换皮机制(本条 D2')不变。详见 ADR-0013。

书架展台与书皮在 Draft 下从"恒深"改为"随主题浅化",走 Claude 文档材质色:

| 层 | Archive(暗,不动) | Draft(浅,新) |
|----|-------------------|----------------|
| 展台底 `--surface-shelf` | `#12121a` | `#eeece6`(manilla 信封色) |
| 书皮底 `DARK_BASE` | `#12121a` | `#e4d1c2`(kraft 牛皮纸) |
| 纸边 `PAPER_CREAM` | `#e8ddd0` | `#fdfdf7`(暖白纸页) |
| 书 accent 色板 | ARCHIVE_ACCENTS(靛青系 6 色) | DRAFT_ACCENTS(陶土橙系 6 色,见下) |

层次:页面 `#f0efea` < 展台 `#eeece6` < 书皮 `#e4d1c2`,纸边 `#fdfdf7` 最浅跳出。书皮比展台略深,让书从展台立住轮廓(浅底同色会糊,必须分层)。

**Draft 书 accent 色板**(按书名 hash 分配,主色对齐 Draft accent):

```
#d97757  陶土橙(主,对齐 Draft accent)
#c66b5a  砖红
#b88a5a  赭石
#8a8a5a  橄榄
#5a8a8a  鸭蛋青(冷色平衡,避免全暖偏腻)
#8a6a7a  紫褐
```

### D2':实现机制 —— theme prop + 换 texture,不重建场景

`BookShelf3D` 现有滚动虚拟化换皮机制(`book.coverMat.uniforms.uTexture.value = skin.cover` + `needsUpdate`,`BookShelf3D.tsx:517`)——换 texture 不重建场景是现成能力。复用它做主题换皮:

- `BookShelf3D` props 加 `theme: 'archive' | 'draft'`(Home 用 `useTheme()` 传入)。
- 主 `useEffect` 依赖 **不变**(仍 `[pages, onBookClick]`),尊重 `Home.tsx:27` 刻意避免 WebGL 场景重建/重播入场的设计。
- 新增副 `useEffect([theme])`:按 theme 选 ARCHIVE/DRAFT 两套 skin 池,用现成换皮机制替换 cover/spine/back/topBot 纹理;灯光参数(DirectionalLight 强度、rim PointLight 颜色)一并按 theme 切。几何/相机/动画时间轴不动。
- 展台底色走 CSS:`--surface-shelf` 移入 `:root[data-theme="draft"]` 覆盖块(Draft = `#eeece6`),`.book-shelf-3d` 背景 = `var(--surface-shelf)` 自然随主题。

**被否的备选**:theme 进主 `useEffect` 依赖 → 切换时整场景重建 + 重播入场。实现更简,但破坏 Home.tsx 避免重建的刻意设计,切换体验差(白屏 + 动画重放)。

### 灯光调整(Draft 下)

浅展台不靠灯光提亮,反而要避免过曝:`DirectionalLight` 强度 1.1 → 0.8;rim `PointLight` 颜色硬编码靛青 `0x6b8fc7` → 陶土橙 `0xd97757`(对齐 Draft accent);`AmbientLight` 不变。Archive 下灯光参数不动。

## 后果

- **ADR-0005 D1/D3 被 supersede**:本文 D1'/D3' 取代。0005 的 D2/D4/D5 继续 accepted。
- **浅深 accent 不同源**:切 Archive↔Draft 时 accent 在靛青↔陶土橙间跳变。是有意为之,不再追求"品牌色不断裂"。
- **书架 canvas 颜色不再与 CSS token 解耦**:`BookShelf3D.tsx` 现消费 `theme` prop,有 ARCHIVE/DRAFT 两套常量。代价是 canvas 调色面增大;收益是书架真正随主题。
- **`--surface-shelf` 进入 Draft 覆盖块**:不再是"两主题都继承 `:root` 深色"的恒深 token。
- **后人疑问预案**:为何 Draft 用陶土橙而 Archive 用靛青?——浅色归 Anthropic 档案正色(本文 D1')。为何书架在 Draft 下变浅而 Archive 下恒深?——Draft 是"图纸台 + 展柜"统一浅化,Archive 的深色舞台是其档案身份的一部分(本文 D3')。
