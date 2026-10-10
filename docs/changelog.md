---
outline: [2, 2]
---

# 更新日志

> 完整变更历史以随包发布的 CHANGELOG.md 为准，本页由 `pnpm sync:changelog-doc` 从根 CHANGELOG.md 自动同步，请勿手改。

## 0.1.0

> 2026-10-11 发布

### ✨ 新增功能

- 首个版本：确立「跨平台运维工具集」定位，单一 CLI 入口（`opsbox`），以「能力」为单位组织，一能力一目录自注册，所有能力默认全平台支持
- 新增 MySQL 库恢复能力（`mysql-recover`）：重装 MySQL 后从遗留数据目录还原库结构与数据，含 `ddl`（提取 SDI 生成建表 DDL 产物）与 `restore`（依产物把孤儿库挂回实例）两个子命令
- 新增平台适配层：Linux / macOS / Windows 差异统一经适配层隔离，运行期自动探测，平台无关核心只写一份
