# ADR-0008: 平台分支保持就地判断 —— 不抽平台分发表 / 统一 adapter

- 状态:accepted
- 日期:2026-07-07
- 范围:z-wiki 桌面端 rg/fd 预置二进制的平台 if/else 分支处理策略,判断"是否该抽象统一平台 adapter / 平台分发表"。决策对象仅 rg/fd(ADR-0003 D6 预置);pandoc 在 ADR-0007(proposed,未落地),不在本决策范围,但在 D2/D3 说明与其关系。
- 关联:ADR-0003 D1(跨平台)/ D6(预置 rg/fd)、ADR-0007 决策 3(pandoc 下载管理,触发回头审抽象的候选条件)

## 背景

平台分支盘点(2026-07-07)结论:产品代码共 12 处平台 if/else,集中在 2 个文件:

- `scripts/fetch-tool-bins.ts`(构建时预下载 rg/fd 进 bundle,10 处):rg/fd 各一套 darwin/linux/win32 包名分发(L42-48 / L60-62)+ `binaryInArchive` 三元(L51 / L65)+ win32 解压 / 非 win32 chmod(L99 / L143)
- `desktop/src/toolBins.ts`(运行时安装二进制,2 处):win32 加 `.exe` 后缀(L22)+ 非 win32 `chmodSync`(L78)

非分支但平台相关:`desktop/src/pathUtils.ts:7` 用 `` `${process.platform}-${process.arch}` `` 拼平台标识符(数据驱动,非 if/else);`fetch-tool-bins.ts:70-75` `TARGETS` 平台-arch 矩阵(数据,非分支)。

web/layer2 与 server/layer3 零平台分支——平台差异被 `desktop/` shell 收拢(ADR-0003 D1)。

问题:rg/fd 的平台分发(L42-48 与 L60-62)是同构重复,是否该抽"平台分发表"统一?

## 决策

### D1: 保持就地 if/else,不抽平台分发表 / 统一 platform adapter

rg/fd 的平台分支保持现状的就地判断,不引入"平台 × 工具 × 属性"分发表,也不抽统一的 `platform.ts` adapter。理由:

1. **Deletion test 不通过**:对 L42-48 / L60-62 的平台分发做分发表抽象,删掉抽象后复杂度只是回到现状的线性 if 链,不会浓缩——抽象是 shallow 的。引入矩阵 schema 的认知开销(读者要先理解矩阵再看分发)大于它消除的重复(现在是线性、一眼可读的 if 链)。
2. **Locality 优先**:平台分支就地判断(`.exe` 后缀紧贴二进制命名 L22、chmod 紧贴文件写入 L78/L143)。抽统一 adapter 反而破坏 locality——读者要在调用处与 adapter 间跳,才能知道".exe 后缀怎么来的"。当前就地判断 locality 更好。
3. **规模在"复制两次"阈值内**:rg + fd 各一套平台分发 = 两次复制。CLAUDE.md "copy-paste twice before you abstract"——未到第三次,抽象不划算。`isMac`/`isWindows` 派生变量零命中,无重复派生逻辑可收敛。
4. **已是合理 depth**:`fetch-tool-bins.ts` 的 `ToolSpec` interface(每工具自描述 `archiveName(plat)` / `binaryInArchive(plat)`)已是干净 module 边界,分发逻辑共享、平台差异内聚到每工具自描述。interface 比 implementation 简单,depth 合格。
5. **数据驱动已用在正确处**:`pathUtils.ts` 的平台标识符拼接、`fetch-tool-bins.ts:70-75` 的 `TARGETS` 矩阵已是数据驱动模式。该用数据处已用数据,该用分支处(命名 / chmod / 解压)用分支——分布正确,不需要把分支也改成数据。

### D2: 回头审抽象的触发条件 —— 第三个预置工具落地

本决策在 rg/fd 双工具阶段有效。触发回头审抽象的条件(满足其一):

- **ADR-0007 落地引入 pandoc 平台分支**:ADR-0007 决策 3 自行实现 pandoc 下载管理(按平台选 asset / 解压,新增平台分支)。届时 rg/fd + pandoc = 3 个工具的平台分发,到达"复制第三次",值得提取数据表(平台 × 工具 × archiveName × binaryInArchive)。
- **或新增 bat / eza 等第四个预置工具**:同上触发。

回头审时的候选抽象:`fetch-tool-bins.ts` 的 `ToolSpec` 已是雏形,可把 L70-75 `TARGETS` 矩阵扩展为完整分发表,把 L42-48 / L60-62 的 if 链改为表查询。**仅在三工具落地后做,不在双工具阶段预先抽象**(YAGNI)。

### D3: pandoc 下载管理不与 rg/fd 合并(ADR-0007 独立路径)

ADR-0007 决策 3 的 pandoc 下载管理"仿 `ensureTool` 思路但针对 pandoc"自行实现,与 rg/fd 的 `fetch-tool-bins.ts` 是不同机制:

- rg/fd:pi 的 `ensureTool` 硬编码支持(`utils/tools-manager.d.ts:2` 限 `"fd" | "rg"`),z-wiki 在构建时预置进 bundle 免运行时下载。
- pandoc:pi `ensureTool` 不支持,需自行实现下载管理(ADR-0007 决策 3),桌面打包时进 `extraResources`。

两者时机(构建时预置 vs 打包时进 extraResources)、来源(pi 内置 vs GitHub releases)不同,不合并下载管理代码。D2 的"平台分发表"抽象只针对"平台 × 工具"的属性分发(archiveName / binaryInArchive),不含下载管理机制统一——下载管理是各自工具的 concern。

## 后果

- **不新增 module**:不引入 `platform.ts` adapter / 平台分发表,`desktop/` 与 `scripts/` 维持现状。
- **rg/fd 平台分支就地维护**:新增平台(如未来 freebsd)时,要在 L42-48 / L60-62 两处 if 链各加一条——可接受(双工具,改动小,且 freebsd 不是目标平台)。
- **ADR-0007 落地时触发 D2 回头审**:若 pandoc 引入第三套平台分支,本 ADR 的 D1 需重新评估,可能 supersede 为分发表抽象。届时本 ADR 标记 superseded,新 ADR 接管。
- **未来架构 review 不重复提议**:遇到"平台分支是否该抽象"时,据本 ADR D1 / D2 判断——双工具阶段不抽象,三工具阶段才回头。避免重复 litigate。
