# 新手指南

> 目标读者：第一次接触本工具集的用户。读完能跑通「安装 → 查看命令树 → 跑通一个能力」最短路径，并知道去哪查更细的内容。

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

## 安装

本工具集是已发布到 npm 的 Node 包（`@fxri/opsbox`）。三种方式按场景选一：**个人多项目推荐方式一**（全局安装，所有项目开箱即用）；**团队项目建议方式二**（版本随仓库锁定，成员与 CI 自动一致）。

### 方式一：全局安装（推荐个人多项目）

```bash
pnpm i -g @fxri/opsbox   # pnpm（bin 落在 pnpm home，不受 nvm 切版本影响）
npm i -g @fxri/opsbox    # npm（bin 硬链在 Node 目录，切版本需重装）
yarn global add @fxri/opsbox   # 仅 yarn 1.x；v2+ 默认禁用 global，建议改用 pnpm
bun i -g @fxri/opsbox    # bun
```

适合个人在多个项目间快速使用。⚠️ 使用 nvm/fnm 等切换 Node 版本的工具时，npm 的全局包**绑定在安装时的 Node 版本上**，切版本后会「消失」——重新执行安装命令即可（pnpm 全局目录独立于 Node 版本，或用方式三规避）。

### 方式二：项目 devDependency（推荐团队项目）

```bash
pnpm add -D @fxri/opsbox   # npm 用户：npm install -D @fxri/opsbox
```

版本随项目锁定、随仓库走，团队成员与 CI 在项目内用 `pnpm exec opsbox`（npm 用户 `npx opsbox`）即可用。

### 方式三：不安装、临时执行

```bash
pnpm dlx @fxri/opsbox --help   # pnpm
npx @fxri/opsbox --help        # npm / yarn
bunx @fxri/opsbox --help       # bun
```

零安装先体验。⚠️ 首次执行有下载耗时，且每次都解析最新版本，不适合高频使用。

### 安装方式对比

| | 方式一 全局 | 方式二 项目 devDep | 方式三 临时执行 |
| --- | --- | --- | --- |
| 团队共享版本 | ❌ 各装各的 | ✅ 锁定 | ❌ 总是最新 |
| 离线可用 | ✅ | ✅ | ❌ |
| nvm 切版本影响 | npm ⚠️ 需重装；pnpm ✅ 不受影响 | 无 | 无 |
| 推荐包管理器 | pnpm | pnpm | pnpm dlx |
| 适合场景 | 个人多项目 | 团队 / 长期项目 | 快速试用 |

### 调用方式

```bash
opsbox <command>              # 全局安装后直调
pnpm exec opsbox <command>    # 项目 devDependency（npm 用户 npx opsbox）
pnpm dlx @fxri/opsbox <command>   # 不安装、临时执行
```

## 30 秒上手

```bash
# 1. 看命令树（有哪些能力）
opsbox --help

# 2. 看某个能力的用法与选项
opsbox mysql-recover --help
opsbox project-rename --help
opsbox config status --help

# 3. 跑一个恢复流程：先生成 DDL 产物（只读数据目录）
opsbox mysql-recover ddl --data <MySQL 数据目录> --out .opsbox

# 4. 依产物把孤儿库挂回实例（缺省交互式输入口令）
opsbox mysql-recover restore --work .opsbox --user root

# 5. 或跑一个目录改名（先预览，再执行，最后续迁二进制状态）
opsbox project-rename <旧路径> <新路径> --dry-run
opsbox project-rename <旧路径> <新路径>
opsbox project-rename <旧路径> <新路径> --resume
```

`--dry-run` 只做前置校验并打印计划，不落盘；`project-rename` 迁移前须先关闭目标宿主。

## 下一步

- 每个能力该说什么、做什么 → [操作手册](./handbook)
- 架构与完整流程 → [完整攻略](./guide)
- 查命令参数 → [CLI 参考](./cli)
- 作为库使用 → [API 参考](./api)
- 配置分层 → [配置参考](./config)
- 遇到问题 → [FAQ](./faq)
