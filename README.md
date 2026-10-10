<p align="center">
  <img src="./docs/public/logo.png" width="128" alt="方弦运维工具箱">
</p>

# 方弦运维工具箱（opsbox）

[![CI](https://github.com/fxri-net/opsbox/actions/workflows/ci.yml/badge.svg)](https://github.com/fxri-net/opsbox/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@fxri/opsbox)](https://www.npmjs.com/package/@fxri/opsbox)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](./docs/getting-started.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

跨平台运维工具集：以「能力」为单位组织，所有能力默认全平台支持。

> 国内网络建议优先 [Gitee 镜像](https://gitee.com/fxri/opsbox)（与 GitHub 同源同步）；问题反馈走 [GitHub Issues](https://github.com/fxri-net/opsbox/issues) 或 [Gitee Issues](https://gitee.com/fxri/opsbox/issues)。

> 定位：把一次性运维脚本沉淀为可长期演进的工具集。平台差异经适配层隔离，平台无关核心只写一份，Linux / macOS / Windows 开箱即用——能力不限于宝塔，宝塔只是其中一种运行环境。

## ✨ 能力矩阵

| 能力 | 适用场景 | 命令 |
| --- | --- | --- |
| MySQL 库恢复（mysql-recover） | 重装 MySQL 后，从遗留的数据目录还原库结构与数据 | `opsbox mysql-recover` |
| 项目目录改名（project-rename） | 目录改名后，迁移各宿主中跟随目录名的关联状态（⚠️ 需先关闭目标宿主） | `opsbox project-rename <旧路径> <新路径>` |

## 平台支持

| 平台 | 适配层 | 服务控制 | 权限复位 |
| --- | --- | --- | --- |
| Linux | unix | `systemctl` → `brew services` → `mysql.server` | `chown -R mysql:mysql` |
| macOS | unix | 同 Linux | 跳过 |
| Windows | windows | `sc` → `net` | `icacls /reset` |

平台在运行期自动探测，无需手工指定；数据目录、二进制目录、服务名等默认值随平台给出，均可经命令选项覆盖。

## 📚 文档

| 文档 | 适合谁 |
| --- | --- |
| [新手指南](./docs/getting-started.md) | 第一次接触，想 30 秒跑起来 |
| [操作手册](./docs/handbook.md) | 日常照着做：每个能力该说什么、做什么 |
| [完整攻略](./docs/guide.md) | 了解架构：能力组织、平台适配层、三层配置、机器可读输出 |
| [CLI 参考](./docs/cli.md) | 查命令、参数、默认值、退出码 |
| [API 参考](./docs/api.md) | 作为库引入 Node 项目 |
| [配置参考](./docs/config.md) | 查 `.opsboxrc.json` 字段（全局 / 项目 / 本地三层） |
| [更新日志](./CHANGELOG.md) | 查各版本变更内容 |
| [FAQ](./docs/faq.md) | 遇到问题先来这里找 |
| [推荐 AI 全局规则](./docs/ai-rules.md) | 想让 AI 助手按同一套纪律协作 |
| [推荐提交信息规则](./docs/commit-rules.md) | 想让 AI 按统一格式写 git 提交信息 |
| [完整文档站](https://fxri-net.github.io/opsbox/) | 在线阅读体验 |

## 📦 安装

已发布到 npm（`@fxri/opsbox`），按场景三选一：

```bash
pnpm i -g @fxri/opsbox          # 全局安装（推荐个人多项目；npm 用户 npm i -g）
pnpm add -D @fxri/opsbox        # 项目 devDependency（推荐团队项目）
pnpm dlx @fxri/opsbox --help    # 不安装、临时执行
```

方式取舍与 yarn / bun 等价命令见[新手指南 · 安装](./docs/getting-started.md#安装)。

## 🚀 快速上手

```bash
# 查看帮助
opsbox --help

# 一个典型恢复流程：先生成 DDL 产物，再依产物把孤儿库挂回实例
opsbox mysql-recover ddl --data <MySQL 数据目录> --out .opsbox
opsbox mysql-recover restore --work .opsbox --user root

# 项目目录改名并迁移宿主状态（双趟）：先预览，再执行，最后续迁二进制状态
opsbox project-rename <旧路径> <新路径> --dry-run
opsbox project-rename <旧路径> <新路径>
opsbox project-rename <旧路径> <新路径> --resume
```

`restore` 缺省交互式输入口令（可用 `--password` 传入）；`--dry-run` 仅做前置校验并打印执行计划。

`project-rename` 迁移前须先关闭目标宿主；`--host` 可限定宿主，`--no-backup` 跳过备份（危险）。

## Node API

```ts
import { recover, generateDdl, resolveAdapter, MysqlClient } from "@fxri/opsbox"

const adapter = resolveAdapter()
const manifest = generateDdl({ dataDir: adapter.defaults.dataDir, outDir: ".opsbox", ibd2sdiExe: "ibd2sdi", cacheDir: ".opsbox/.cache", only: [] })
```

## 📄 版权信息

作者：唐启云 <tqy@fxri.net>

出品：方弦研究所

版权：Copyright © 2026 唐启云. All rights reserved.

网站：[方弦研究信息网](https://fxri.net:444/)

协议：[MIT License](./LICENSE)

商标："方弦®"为第42类注册商标（注册号89648411），本开源许可不授予商标使用权，详见 [TRADEMARK.md](./TRADEMARK.md)

> 方弦研究所为唐启云个人项目品牌与出品方，非独立法人实体；本软件著作权归唐启云所有。
