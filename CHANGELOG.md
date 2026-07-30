# Changelog

> 版本号遵循 SemVer。各版本按发布时间升序排列。

---

## v0.5.1 (2026-07-30)

### ✨ 新功能

- **收件交互重做** —— Modal 改为胶囊（开关 + 复制按钮），说明文档改为收件提示词形态，保留内容粘贴位（ADR-0026）
- **更新 feed 内置默认** —— 打包 app 自动从 GitHub releases/latest 检查更新，无需手动设 env

### 🐛 修复

- **打包 dmg glob** —— release 全量档 glob 多一段 `*-` 导致匹配不到产物
- **增量包旧残留** —— `package-update-bundles` 按 mtime 选最新 unpacked，修增量包抽取旧版残留
- **Makefile release 双修** —— 补 .PHONY、recipe 内注释移出避免静默 exit 0

### ⚠️ 提醒

v0.5.0 及之前的安装版 updater 因缺少内置 feed 地址从未运行，请手动下载完整包安装。

---

## v0.5.0 (2026-07-29)

### ✨ 新功能

- **编译小结** —— ingest 完成通知展示 agent 收尾文本（新建/合并/更新 + 涉及文件 + 理由）
- **INGEST 日志兜底** —— agent 漏记 log.md 时 server 补记

### 🐛 修复

- **依赖漏洞** —— protobufjs/brace-expansion 嵌套漏洞修复
- **依赖升级** —— @fastify/static 10.1.2 + react-router 8.3.0
- **find-my-way CVE** —— 9.6.0 → 9.7.0
- **CI/发布加固** —— 产物校验前置 + glob 收紧 + repository 字段补全 + fetch-tool-bins 找回 + pre-commit hook 修复
- **chat-input 滚动条** —— 对齐全站细条样式

### 📖 文档

- CLAUDE.md ADR 逐行索引收缩为目录指引，supersede 链回归 ADR 自承载

---

## v0.4.2 (2026-07-22)

### 🐛 修复

- **代码块滚动条** —— 横向滚动条改为细条样式
- **CI 权限** —— 补 CI/release.yml workflow permissions（CodeQL）
- **typecheck/fetch-tool-bins** —— 修复 scripts typecheck 与 win32-arm64 下载失败

### 🔧 杂项

- **自动发版分层检测** —— `make release AUTO=1` 按变更范围自动选更新档（code/app/full）
- **开源准备** —— CONTRIBUTING/CODE_OF_CONDUCT/CI/Issue 模板基础文件

---

## v0.4.1 (2026-07-21)

### 🔧 杂项

- **make release 单命令** —— 一体化打包 + tag + GitHub release + 上传
- **clean-release 策略** —— 只留打包缓存，所有成品包全删
- **文档** —— CLAUDE.md 补 make release/clean-release + ADR-0022 + 更新发版流程

---

## v0.4.0 (2026-07-21)

### ✨ 新功能

- **A2A 收件** —— Agent 间内容投递 + quickbar 按钮分组
- **程序化封面画** —— 书皮改中性载体 + 封面画构图原型（几何色块/色带/大字号等）

### 🐛 修复

- **轨道球 virtual 书架** —— orbitAlignTarget 加 virtual 参数，防止 virtual 书架进轨道球时 clamp 跳书
- **依赖漏洞** —— protobufjs/brace-expansion 嵌套漏洞修复
- **pi-coding-agent 适配** —— v0.80.10 breaking API 变更（AuthStorage → ModelRuntime）
- **安全补丁** —— npm 传递依赖 + CodeQL 误报注释

### 🎨 样式

- **书架书皮** —— 程序化封面画（中性载体 + 构图原型）

### 📖 文档

- **README 重设计** —— 门面风排版 + 折叠运维细节
- **用户名迁移** —— ASmallMatch → ember-hearted（LICENSE/README/SECURITY）

---

## v0.3.2 (2026-07-20)

### ✨ 新功能

- **POST /api/ingest 端点** —— Claude Code 直发内容触发编译
- **SECURITY.md** —— 安全策略文档
- **PR 模板 + release.yml** —— 配合 label 分类 release notes

---

## v0.3.1 (2026-07-20)

### 🐛 修复

- **书架中心本 hover** —— 显示 pointer 光标
- **轨道球 bug** —— 全态修复
- **Number input** —— 设置页移除右侧步进箭头（上下文窗口手输大数）

---

## v0.3.0 (2026-07-18)

### ✨ 新功能

- **Draft 浅色主题** —— 净纸白 + 明快墨蓝清爽现代化（ADR-0022）
- **展厅视觉语言** —— 分级柔化 + kicker + 按钮/卡片 finish 统一
- **思考控制两档化** —— toggle 开关 + reasoning 恒 true（ADR-0021）
- **electron 升级 38→39**
- **@fastify/static 升级** —— 8.3.0 → 10.1.0

### 🐛 修复

- **linux 滚动条** —— 全端隐藏（经典条常驻占位 + 切主题闪白）
- **custom provider 兼容** —— developer 角色 400 + DeepSeek 思考 off 失效
- **linux 菜单栏** —— autoHideMenuBar 补 linux 默认隐藏
- **CodeQL 告警** —— XSS 属性注入/URL 校验/ReDoS/CI 权限
- **增量更新** —— linux AppImage 命名 x86_64 → x64

### 🔧 杂项

- **gitignore .scratch/** —— 工作流临时 issue/PRD 笔记不提交
- **清理** —— 删除迁移遗留的 Stop 死钩子

---

## v0.2.0 (2026-07-17)

### ✨ 新功能

- **增量更新机制** —— 自建三档覆盖式更新（代码包/应用包/完整包），含 ADR-0018 决策 + 8 切片实现
- **书架彩色书皮** —— 书皮按 accent 派生（6 色色相族）+ Archive 色板鲜明化
- **纯文本上传** —— 支持 .txt/.text/.log 三分读法
- **ingest 角标改进** —— 消化系文本 + 里程碑进度（ADR-0019）
- **clean-release 版本过滤** —— 发新版后旧版本包自动全删
- **CI** —— Node.js CI（typecheck + lint + test，Node 22）
- **agent 路径沙箱** —— 文件工具锁 kb/ 内（ADR-0016）
- **限 pi skill 加载** —— 只加载 z-wiki 自有（ADR-0017）

### 🐛 修复

- **ingest 里程碑** —— 取 read 的 path 字段 + done 平滑收尾
- **isWithinKb 误拦** —— kb/ 根（ls . / grep . 被误报越界）
- **ensureFirstRun 自愈** —— kb/ 缺失时补复制
- **三处 pre-existing lint**

### 📖 文档

- **GitHub Pages 落地页** —— 项目介绍（docs/index.html）
- **README** —— 改项目主张与描述，补 mac 未签名首次打开说明
- **ADR-0018** —— 自建三档增量更新 + CONTEXT 术语簇 + PRD

---

## v0.1.0 (2026-07-16)

首个可分发版本。

### ✨ 新功能

- **三层架构落地** —— kb/(layer1) / web/(layer2 SPA) / server/(layer3 Fastify+pi agent)
- **ADR-0001~0017** —— 17 篇架构决策记录
- **Electron 桌面** —— electron-builder 三平台打包（mac/win/linux）
- **3D 书架** —— Three.js 圆柱书架、拖拽滑轨、slot 系统、轨道球交互（ADR-0015）
- **LLM 对话** —— Fastify + pi-coding-agent，思考过程展开/折叠
- **Ingest 上传** —— md 与 pandoc 格式（pdf/docx）上传编译
- **主题系统** —— Archive(暗) / Archive Invert(亮) 双主题
- **设置页** —— Vault 切换，provider/model/context window 配置
- **Windows 兼容** —— NSIS + zip 便携，旧 Win 自动 GPU/沙箱降级
- **README + CONTEXT.md + CLAUDE.md** 开发指引

---

## 格式

```
## vX.Y.Z (YYYY-MM-DD)

### ✨ 新功能
### 🐛 修复
### 🎨 样式
### 📖 文档
### 🔧 杂项
```
