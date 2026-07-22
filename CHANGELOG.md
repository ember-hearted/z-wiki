# Changelog

## [0.4.1] - 2026-07

### Added
- `wiki/` → `output/` 晋升去重，相同内容不再重复晋升
- `promoted-to` 健康检查

### Changed
- `make release` 单命令完成打包 + tag + 发布全流程
- `clean-release` 只留打包缓存，所有成品包全删

### Documentation
- CLAUDE.md 补发版流程说明 + ADR-0022
- CLAUDE.md 更新发版步骤指引

## [0.4.0] - 2026-07

### Added
- A2A 收件功能：Agent 间内容投递
- Quickbar 按钮分组
- 3D 书架书皮改程序化封面画（中性载体 + 构图原型）

### Fixed
- `orbitAlignTarget` 加 `virtual` 参数，防止 virtual 书架进轨道球时 clamp 跳书
- npm overrides 修复 protobufjs/brace-expansion 嵌套漏洞
- 适配 pi-coding-agent v0.80.10 breaking API 变更（AuthStorage → ModelRuntime）
- 修复安全漏洞：npm 传递依赖补丁 + CodeQL 误报注释

### Changed
- 用户名 ASmallMatch → ember-hearted

## [0.3.2] - 2026-05

### Added
- `POST /api/ingest` 端点：Claude Code 直接发送内容触发编译
- SECURITY.md 安全策略
- PR 模板（配合 label 分类 release notes）
- `release.yml` 自动生成发版说明模板

### Changed
- PR 模板和 CLAUDE.md worktree 开发工作流更新

## [0.3.1] - 2026-05

### Fixed
- 书架中心抽出本书 hover 显示 pointer 光标
- 轨道球惯标
- 移除设置页 number input 右侧步进箭头

## [0.3.0] - 2026-05

### Added
- Draft 主题改「净纸白 + 明快墨蓝」清爽现代化（ADR-0022）
- 书架两主题同色相族
- 展厅视觉语言对齐（分级柔化 + kicker + 按钮/卡片 finish）
- 思考控制两档化（toggle）+ reasoning 恒 true 乐观声明（ADR-0021）

### Fixed
- Linux 视口滚动条全端隐藏
- Developer 角色 400 错误 + DeepSeek 思考 off 失效
- Linux 菜单栏默认隐藏
- CodeQL 首扫 9 条告警（XSS 属性注入/URL 校验/ReDoS/CI 权限）
- Linux AppImage 命名 x86_64 → x64

### Changed
- 依赖升级：electron 38.8.6 → 39.8.5
- 依赖升级：@fastify/static 8.3.0 → 10.1.0

### Refactored
- 删除迁移遗留的 Stop 死钩子

## [0.2.0] - 2026-04

### Added
- 自建三档增量更新分发（ADR-0018）：代码包 / 应用包 / 完整包
- `incremental-update` 全套实现（打包→分发→安装→降级）
- 书架彩色书皮（ADR-0020）：书皮按 accent 派生，Archive 色板鲜明化
- `ingest` 角标改进：消化系文本 + 里程碑进度（ADR-0019）
- 支持 .txt/.text/.log 纯文本上传
- agent 文件工具路径沙箱锁 `kb/` 内（ADR-0016）
- 限制 pi skill 加载到 z-wiki 自有（ADR-0017）
- CI: Node.js CI（typecheck + lint + test，Node 22 单版本）
- MIT LICENSE + README 开源协议节

### Fixed
- `isWithinKb` 误拦 `kb/` 根
- `ensureFirstRun` 自愈 `kb/` 缺失
- `clean-release` 版本过滤
- 三处 pre-existing lint

### Documentation
- GitHub Pages 项目介绍落地页（docs/index.html）
- README 重新设计与补充
- ADR-0018 三档增量更新
- CONTEXT 术语簇 + PRD

## [0.1.0] - 2026-03

### Added
- 初始版本。3D 书架首页、文章阅读、agent 对话、多 Vault 管理
- Electron 桌面应用（macOS/Windows/Linux）
- 有限虚拟位 + slot 0 体系
- 搜索结果页（cmd focus + launch darkly 探索）
- 纯 HTTP buildView（不写盘）
- 平台分支就地判断（ADR-0008）
- thinking 模式可用

### Fixed
- z-wiki.bat 纯英文（修 GBK cmd 中文乱码）
