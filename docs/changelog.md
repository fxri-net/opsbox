---
outline: [2, 2]
---

# 更新日志

> 完整变更历史以随包发布的 CHANGELOG.md 为准，本页由 `pnpm sync:changelog-doc` 从根 CHANGELOG.md 自动同步，请勿手改。

## 0.1.3

> 2026-10-11 发布

### ✨ 新增功能

- `opsbox --help` 顶层帮助新增页脚，给出文档站入口（新手指南 / 完整攻略 / 全部文档），新用户不必翻源码或 README 即可从命令行跳转线上文档

## 0.1.2

> 2026-10-11 发布

### 🔧 功能调整

- `mysql-recover ddl` 产物 `manifest.json` 的 `generatedAt` 由 UTC ISO 时刻（如 `2026-10-11T04:11:00.000Z`）改为运行环境本地时区的 `YYYY-MM-DD HH:mm:ss`，便于使用者直接对读，不再需要按 8 小时时差换算；该字段无下游代码解析，`restore` 行为不受影响
- 随包分发的 `SPEC.md` 首行「规范更新时间」锚点由仅日期 `YYYY-MM-DD` 改为精确到分 `YYYY-MM-DD HH:mm`（24 小时制、本机时区）

## 0.1.1

> 2026-10-11 发布

### 🐛 问题修复

- 修正用户文档与 README 的安装形态口径：以 npm 发布形态（全局安装为主，项目 devDependency / 临时执行为备选）替换原「本地构建」描述，命令示例统一为 `opsbox <command>`。

## 0.1.0

> 2026-10-11 发布

### ✨ 新增功能

- 首个版本：确立「跨平台运维工具集」定位，单一 CLI 入口（`opsbox`），以「能力」为单位组织，一能力一目录自注册，所有能力默认全平台支持
- 新增 MySQL 库恢复能力（`mysql-recover`）：重装 MySQL 后从遗留数据目录还原库结构与数据，含 `ddl`（提取 SDI 生成建表 DDL 产物）与 `restore`（依产物把孤儿库挂回实例）两个子命令
- 新增 project-rename 能力：项目目录改名后自动迁移各宿主跟随目录名的关联状态
  - 新增 `project-rename` 命令与 `--dry-run` / `--yes` / `--host` / `--backup-dir` / `--no-backup` / `--resume` 选项
  - 双趟迁移：第一趟改写文本与全局状态库引用、目录改名、丢弃缓存；第二趟按新工作区反查并补齐状态库、清理旧目录
- 新增平台适配层：Linux / macOS / Windows 差异统一经适配层隔离，运行期自动探测，平台无关核心只写一份
- 新增横切基础设施：三层配置体系（全局 / 项目 / 本地）与 `opsbox config status` 命令，机器可读输出契约（`--format json` / manifest `schemaVersion`），版本比较与升级提示（`OPSBOX_NO_UPDATE_CHECK`），以及 NOTICE / TRADEMARK.md 版权法务文件
- 新增工程化外围：VitePress 文档站与随包发布的 CHANGELOG.md、仓库 AI 协作规则（AGENTS.md 及引导壳）、GitHub Actions 与 GitLab CI 配置；README 增徽章与文档站、更新日志入口
