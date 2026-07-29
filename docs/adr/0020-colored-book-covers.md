# ADR-0020: 书架彩色书皮(书皮按 accent 派生)+ Archive 色板鲜明化

- 状态:partially superseded(D1 满铺混色由 ADR-0023 取代、D2 Archive 具体色值由 ADR-0022 更新;D2 色板机制、D3 细节自适应保留)
- 日期:2026-07-17
- 范围:layer2(web)首页 3D 书架的书本配色;supersedes ADR-0013 D3'' 的「固定书皮色」部分(Draft 泛黄纸书皮 `#e8e0cc`、Archive 深色书皮 `#12121a`),案卷色板、展台分层原则保留
- 关联:ADR-0013(被部分 supersede)、ADR-0006 D2'(换皮机制,不动)、ADR-0005 D3(展台恒深,不动)、CONTEXT.md「主题」节

## 背景

书架书本的配色机制是「固定书皮底色 + 按书名 hash 分配 accent 色板」,但 accent 只出现在 CAUTION 胶带/工业边框/卷号标等约 5% 面积的细线上。结果:

1. **色板机制白做**:6 色 accent 色板存在感≈0,一排书看起来颜色全一样——Archive 下是「一排黑盒子」(书皮 `#12121a` ≈ 展台 `#12121a`),Draft 下是「一排米色纸板」(书皮 `#e8e0cc` ≈ 展台 `#ece4d2`)。
2. **书与展台糊在一起**:两主题的书皮色都与展台色几乎相同,书的轮廓靠阴影硬撑。

方向经用户确认:彩色书皮——每本书的书皮直接用该书 accent 的深/浅变体,像真实图书馆书墙。

## 决策

### D1: 书皮底色改 per-book 派生 —— `coverBase(accent, theme)`

- **Archive**:`mixColor(accent, '#12121a', 0.62)` —— accent 混展台深底 62%,深彩书皮,在深展台上亮出一档。
- **Draft**:`mixColor(accent, DRAFT_COLORS.paper, 0.58)` —— accent 混纸白 58%,粉彩书皮(雾蓝/豆绿/砖粉/杏黄/藕紫/青瓷),与暖纸展台 `#ece4d2` 靠色相+明度分层。
- `BookThemeColors` 删 `darkBase`/`topAccent` 字段;`makeSkinPool` 对每本书算 `dark = coverBase(accentHex, theme)` 传给封面/书脊/背面三个纹理函数,纹理函数签名不变。

### D2: ARCHIVE_ACCENTS 换鲜明色板

原莫兰迪低饱和 6 色(灰蓝/暖褐/暗鼠尾草/薰衣草灰/暗金褐)混黑 62% 后色相全灭,换成中高明度鲜明 6 色:

```
#6b8fc7  靛青(主 accent,不动)
#5ea89a  松石绿
#b86a76  茜红
#c08a4a  琥珀
#9378b8  堇紫
#5f96b5  青蓝
```

DRAFT_ACCENTS(案卷色板)不动 —— ADR-0013 刚定,混白 58% 后 6 色区分度天然成立;陶土橙 `#b88a4a` 传承保留。

### D3: 细节色按明暗/同族自适应

彩色书皮引入后,原本「深书皮/浅书皮各一套硬编码色」的细节需要跟着书皮明暗走:

- **胶带 CAUTION 字 / 卷号标字**:`#000` 硬编码 → `contrastColor(accent)`(Draft 深 accent 上白字,Archive 亮 accent 上深字)。
- **`contrastColor` 阈值 0.55 → 0.5**:靛青 `#6b8fc7`(lum≈0.54)、陶土橙 `#b88a4a`(lum≈0.57)等中明度 accent 上深字对比更高;书皮明暗判断离 0.5 都远,不受影响。
- **底部档案条**:`rgba(0,0,0,0.5)` 「黑屁股」→ `mixColor(accent, '#000', 0.3)` accent 暗化,与胶带/边框/卷号同族,整书收敛到「accent 亮件 + accent 派生书皮 + 纸边」三色体系。
- **书顶/书底装饰线**:共享纹理不再用统一 accent(避免与各色书皮撞色),改 `shadeColor(paper, -55)` 纸色暗化中性线。
- **书脊边线 / 背面条码 / 封面内框线**:白色硬编码 → 按 `textColor`(即书皮明暗)派生深/白;书脊弧面高光浅书皮上加到 0.22 才可见。

## 后果

- **ADR-0013 D3'' 部分被 supersede**:「泛黄纸书皮 `#e8e0cc`」废止;案卷色板(DRAFT_ACCENTS)、「浅底必须分层」原则保留——分层手段从「固定色明度差」改为「粉彩书皮 vs 暖纸展台的色相+明度差」。D1''(蓝黑墨水 accent)、D4''(墨迹动效)、D5''(衬线标题)、D6''(纸纹)不动。
- **页面 token 零改动**:tokens.css 两主题调色板不动,本次只动书架 canvas 绘制;切 Archive 后靛青 accent、glow、扫描亮峰全在(硬性验收点)。
- **展台色不动**:Archive `#12121a` / Draft `#ece4d2`,彩色书皮在两展台上都已验证可立住。
- **hash 撞色难免**:相邻书可能分到同色(8 本撞 1-2 本常态),是 hashAccent 机制固有,不换机制。
- **后人疑问预案**:为何没有固定书皮色?——固定色让 6 色 accent 色板存在感≈0,彩色书皮让色板成为主角(本文 D1)。为何 Archive 色板鲜亮?——要混黑 62% 成书皮,低饱和原色混完色相全灭(本文 D2)。为何底条不是黑色?——彩色书皮上黑条是「黑屁股」,accent 暗化同族更收敛(本文 D3)。
