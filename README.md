# 方弦运维工具箱（opsbox）

跨平台运维工具集：以「能力」为单位组织，所有能力默认全平台支持。

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

## 🚀 快速上手

```bash
# 安装依赖后本地构建
pnpm install
pnpm build

# 查看帮助
node dist/cli.js --help

# 一个典型恢复流程：先生成 DDL 产物，再依产物把孤儿库挂回实例
node dist/cli.js mysql-recover ddl --data <MySQL 数据目录> --out .opsbox
node dist/cli.js mysql-recover restore --work .opsbox --user root

# 项目目录改名并迁移宿主状态（双趟）：先预览，再执行，最后续迁二进制状态
node dist/cli.js project-rename <旧路径> <新路径> --dry-run
node dist/cli.js project-rename <旧路径> <新路径>
node dist/cli.js project-rename <旧路径> <新路径> --resume
```

`restore` 缺省交互式输入口令（可用 `--password` 传入）；`--dry-run` 仅做前置校验并打印执行计划。

`project-rename` 迁移前须先关闭目标宿主；`--host` 可限定宿主，`--no-backup` 跳过备份（危险）。

## Node API

```ts
import { recover, generateDdl, resolveAdapter, MysqlClient } from "@fxri/opsbox"

const adapter = resolveAdapter()
const manifest = generateDdl({ dataDir: adapter.defaults.dataDir, outDir: ".opsbox", ibd2sdiExe: "ibd2sdi", cacheDir: ".opsbox/.cache", only: [] })
```

## 开发

| 命令 | 说明 |
| --- | --- |
| `pnpm verify` | 唯一验收门禁（类型检查 + 静态检查 + 单测 + 覆盖率 + 构建 + CLI 冒烟 + 任务区体检） |
| `pnpm build` | 生产构建（tsup，cjs + esm 双格式 + dts） |
| `pnpm dev` | 开发构建并运行 CLI |
| `pnpm test` | 单元测试（vitest） |

协作规范沉淀于 `.tasks/conventions/`，实现须遵循其中条文（首条 C-1：能力全平台）。

## 📄 版权信息

作者：唐启云 <tqy@fxri.net>

出品：方弦研究所

版权：Copyright © 2026 唐启云. All rights reserved.

网站：[方弦研究信息网](https://fxri.net:444/)

协议：[MIT License](./LICENSE)

商标："方弦®"为第42类注册商标（注册号89648411），本开源许可不授予商标使用权，详见 [TRADEMARK.md](./TRADEMARK.md)

> 方弦研究所为唐启云个人项目品牌与出品方，非独立法人实体；本软件著作权归唐启云所有。
