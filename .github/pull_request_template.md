## 描述

<!-- 简要说明改动内容 -->

## 类型

<!-- 选择一个 label,提 PR 后在右侧 Labels 面板打上对应标签 -->

- [ ] feat: New feature
- [ ] fix: Bug fix
- [ ] style: Style / UI
- [ ] refactor: Refactor
- [ ] chore: Maintenance, dependencies, build, CI
- [ ] test: Tests
- [ ] docs: Documentation

## Worktree 工作流

```bash
# 1. 在主仓库根目录起 worktree
EnterWorktree(name="fix/<slug>")

# 2. 在 worktree 里开发、提交、推送
git push -u origin HEAD

# 3. GitHub 创建 PR, 打 label
# 4. 合并后退出 worktree
ExitWorktree(action="remove")
```

## 检查清单

- [ ] `make typecheck` 通过
- [ ] `make lint` 无新增告警
- [ ] `make format` 已跑
- [ ] 涉及变更已自测
