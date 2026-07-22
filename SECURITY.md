# 安全策略

## 报告安全漏洞

如果发现安全漏洞，**不要**在 GitHub Issues 公开提。请通过以下方式直接联系：

- 在 GitHub 上创建 Security Advisory：
  https://github.com/ember-hearted/z-wiki/security/advisories/new

我们会尽快确认并修复。预期响应时间：**48 小时内回复**。

## 受支持的版本

| 版本 | 支持状态 |
|------|----------|
| 最新 Release | ✅ 安全更新 |
| 旧版本 | ❌ 不再维护 |

## 关注范围

本项目关注以下安全方面：

- **本地数据安全**：知识库内容存储在用户本地，不自动上传到云端。
- **依赖漏洞**：npm 传递依赖补丁通过 Dependabot 跟踪。

## 安全实践

- 依赖通过 Dependabot 自动更新
- Secret scanning 已启用，防止密钥泄露
- `config.json` 包含 LLM API Key，已配置 `.gitignore` 阻止误提交
- agent 工具限定 `kb/` 沙箱内（详见 ADR-0016），不会越界访问文件系统
- pandoc 通过 spawn argv 调用，不经 shell，无注入面（详见 ADR-0011）
