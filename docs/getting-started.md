# 新手指南

> 目标读者：第一次接触本工具集的用户。读完能跑通「安装构建 → 查看命令树 → 跑通一个能力」最短路径，并知道去哪查更细的内容。

## 解决什么问题

你手上有一堆运维脚本——恢复数据库、清理目录、迁移工程——它们：
- 只写一次就跑完，过阵子复用要重读源码
- 换平台（Linux / macOS / Windows）就得改写一遍
- 出了问题只能靠 `echo` 调试，没有统一的退出码与错误文案

本工具集用一套**「能力」为单位 + 单一 CLI 入口 + 平台适配层**的结构解决它：把脚本沉淀为可长期演进的能力，平台差异只隔离一处，平台无关核心只写一份。

## 谁适合用

| 角色 | 典型用法 |
| --- | --- |
| 运维 / SRE | 重装 MySQL 后经 `mysql-recover` 还原库；跨平台执行同一套命令，无需按端改写 |
| 开发 / 技术负责人 | 项目目录改名后用 `project-rename` 迁移 IDE 关联状态，避免历史、工作区失效 |
| 平台 / 基建开发者 | 作为库引入 `@fxri/opsbox`，把能力嵌入内部平台或自动化脚本 |
| 能力贡献者 | 按「一能力一目录、自注册」的结构新增能力，复用平台适配层 |

⚠️ 两条诚实边界：本工具集面向**确定性、可预演的运维操作**（恢复、迁移、检查），不含监控告警、持续部署编排这类运行时服务；`mysql-recover` / `project-rename` 涉及停机与文件搬迁，操作前请先阅读对应能力的边界与回滚说明。

## 几个术语，先说人话

| 术语 | 说人话 |
| --- | --- |
| 能力（capability） | 一类运维工作（如「恢复 MySQL 库」）的完整实现，占一个源码目录，自注册进 CLI |
| CLI | 命令行入口，就是本文的 `opsbox` 命令 |
| 平台适配层 | 把「停服 / 起服 / 权限复位」等平台特有操作封装成同一接口，核心代码据此调用 |
| 三层配置 | 全局层 / 项目层 / 本地层，按作用域分别落盘、按粒度合并 |
| 机器可读输出 | `--format json` 把结果作为 JSON 载荷输出到 stdout，供脚本消费 |
| 孤儿库 | 重装 MySQL 后，数据目录里还在、但实例上找不到的库 |

## 安装与构建

本工具集是 Node 包（`@fxri/opsbox`），当前版本以本地构建使用：

```bash
pnpm install
pnpm build          # 生产构建（tsup，cjs + esm 双格式 + dts）
```

构建产物落在 `dist/`，CLI 入口为 `dist/cli.js`（`bin` 名 `opsbox`）。开发期也可用：

```bash
pnpm dev            # 开发构建并运行 CLI
```

### 调用方式

```bash
node dist/cli.js --help              # 本地构建产物直调
pnpm exec opsbox --help              # 全局安装后（npm 用户 npx opsbox）
```

## 30 秒上手

```bash
# 1. 看命令树（有哪些能力）
node dist/cli.js --help

# 2. 看某个能力的用法与选项
node dist/cli.js mysql-recover --help
node dist/cli.js project-rename --help
node dist/cli.js config status --help

# 3. 跑一个恢复流程：先生成 DDL 产物（只读数据目录）
node dist/cli.js mysql-recover ddl --data <MySQL 数据目录> --out .opsbox

# 4. 依产物把孤儿库挂回实例（缺省交互式输入口令）
node dist/cli.js mysql-recover restore --work .opsbox --user root

# 5. 或跑一个目录改名（先预览，再执行，最后续迁二进制状态）
node dist/cli.js project-rename <旧路径> <新路径> --dry-run
node dist/cli.js project-rename <旧路径> <新路径>
node dist/cli.js project-rename <旧路径> <新路径> --resume
```

`--dry-run` 只做前置校验并打印计划，不落盘；`project-rename` 迁移前须先关闭目标宿主。

## 下一步

- 每个能力该说什么、做什么 → [操作手册](./handbook)
- 架构与完整流程 → [完整攻略](./guide)
- 查命令参数 → [CLI 参考](./cli)
- 作为库使用 → [API 参考](./api)
- 配置分层 → [配置参考](./config)
- 遇到问题 → [FAQ](./faq)
