# CLI 参考

> 目标读者：需要查命令、参数、默认值、退出码的用户。命令与参数口径取自 `opsbox --help` 与各子命令 `--help`（两者冲突时以 `--help` 为准）。

## 解决什么问题

README 只给最常用示例；本篇是完整的命令字典，覆盖全部参数与边界行为。

## 全局

**调用方式**：下文示例统一用 `opsbox <command>` 直调（已全局安装）或 `pnpm exec opsbox <command>`（项目 devDependency，npm 用户 `npx opsbox`）；不安装临时执行用 `pnpm dlx @fxri/opsbox <command>`。

```text
Usage: opsbox [options] [command]

跨平台运维工具集：以「能力」为单位组织，所有能力默认全平台支持。

Options:
  -v, --version                                   显示版本号
  -h, --help                                      显示帮助

Commands:
  mysql-recover [options] [command]               从重装后遗留的数据目录恢复 MySQL 库（跨平台）
  project-rename [options] <old-path> <new-path>  项目目录改名，并迁移各宿主中跟随目录名的关联状态（跨平台）
  config [options] [command]                      配置分层：只读查看三层配置文件（全局层 / 项目层 / 本地层）的生效情况与来源
  help [command]                                  显示帮助
```

| 参数 | 说明 |
| --- | --- |
| `-h, --help` | 显示帮助（全局或子命令） |
| `-v, --version` | 显示版本号 |

平台在运行期自动探测，无需手工指定；未命中中文映射的 commander 原生错误（帮助 / 版本）原样放行。

## mysql-recover

从重装后遗留的数据目录恢复 MySQL 库（跨平台）。

```bash
opsbox mysql-recover --help    # 打印本能力帮助（子命令清单）
```

子命令：

| 子命令 | 行为 |
| --- | --- |
| `ddl [options]` | 从数据目录的 SDI 还原建表 DDL 与产物清单 |
| `restore [options]` | 依 DDL 产物把孤儿库文件重新挂回 MySQL 实例 |

### mysql-recover ddl

```text
Usage: opsbox mysql-recover ddl [options]

从数据目录的 SDI 还原建表 DDL 与产物清单
```

| 选项 | 说明 |
| --- | --- |
| `--data <dir>` | MySQL 数据目录（默认取当前平台约定） |
| `--out <dir>` | 产物输出目录（默认 `.opsbox`） |
| `--ibd2sdi <path>` | ibd2sdi 可执行文件路径（默认取二进制目录） |
| `--cache <dir>` | ibd2sdi 结果缓存目录（默认 `<out>/.cache`） |
| `--only <lib>` | 仅处理指定库（可多次传入；缺省处理全部，默认 `[]`） |
| `--format <format>` | 输出格式（`json`，产物清单输出到 stdout） |

产物布局（`--out` 指定，默认 `.opsbox`）：`ddl/`（建库语句 + 逐表 `CREATE TABLE`）、`manifest.json`（产物清单，`restore` 的输入契约）、`.cache/`（ibd2sdi 结果缓存）。

### mysql-recover restore

```text
Usage: opsbox mysql-recover restore [options]

依 DDL 产物把孤儿库文件重新挂回 MySQL 实例
```

| 选项 | 说明 |
| --- | --- |
| `--data <dir>` | MySQL 数据目录（默认取当前平台约定） |
| `--bin <dir>` | MySQL 二进制目录（默认取当前平台约定） |
| `--work <dir>` | DDL 产物目录（含 `manifest.json` 与 `ddl/`，默认 `.opsbox`） |
| `--backup <dir>` | 整目录冷备目标（默认取当前平台约定） |
| `--staging <dir>` | 孤儿库临时停靠目录（默认取当前平台约定） |
| `--service <name>` | MySQL 服务名（默认取当前平台约定） |
| `--user <name>` | 连接用户（默认 `root`） |
| `--password <pwd>` | 连接口令（缺省则交互式输入） |
| `--skip-backup` | 跳过整目录冷备 |
| `--skip-validate` | 跳过恢复后校验 |
| `--dry-run` | 仅做前置校验并打印执行计划 |

⚠️ 缺失 `manifest.json` 产物时以明确中文错误终止，提示先执行 `ddl`；口令缺省走交互式掩码输入，非交互终端拒绝读取。

## project-rename

```text
Usage: opsbox project-rename [options] <old-path> <new-path>

项目目录改名，并迁移各宿主中跟随目录名的关联状态（跨平台）
```

参数：

| 参数 | 说明 |
| --- | --- |
| `<old-path>` | 旧目录路径 |
| `<new-path>` | 新目录路径 |

| 选项 | 说明 |
| --- | --- |
| `--dry-run` | 仅输出迁移计划，不落盘 |
| `--yes` | 跳过交互确认 |
| `--host <id>` | 限定宿主（可多次传入；缺省迁移全部检出宿主，默认 `[]`） |
| `--backup-dir <dir>` | 备份目录（默认取配置 `project-rename.backupDir`，否则 `<旧路径>/.opsbox/project-rename/<时间戳>`） |
| `--no-backup` | 跳过备份（危险：将无法回滚） |
| `--resume` | 执行第二趟：复制二进制状态并清理旧工作区目录 |
| `--format <format>` | 输出格式（`json`，结果摘要输出到 stdout） |

⚠️ 迁移前须先关闭目标宿主；新工作区 id 不可推算，故需先执行第一趟、待宿主生成新 id 目录后再用 `--resume` 做第二趟。

## config

```text
Usage: opsbox config [options] [command]

配置分层：只读查看三层配置文件（全局层 / 项目层 / 本地层）的生效情况与来源
```

子命令：

| 子命令 | 行为 |
| --- | --- |
| `status [options]` | 配置分层只读体检：三层命中 / 来源层 / 环境变量层（只读、退出码恒 0；可用 `--cwd` 指定查找起点） |

### config status

| 选项 | 说明 |
| --- | --- |
| `--cwd <path>` | 向上查找的起始目录（缺省当前工作目录） |
| `--format <format>` | 输出格式（`json`，输出到 stdout） |

`config status` **一律不打印配置值**（只列来源层与命中的环境变量键名），避免个人规则、本机路径落到终端 / CI 日志；只读、退出码恒 0（仅 `--format` 非法与 `--cwd` 非法时按参数错误退出）。字段与语义见[配置参考](./config)。

## 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功（含 `config status` 正常路径） |
| `1` | 操作失败或参数错误 / 校验不通过 / 文件、目录异常等 |

`--format` 传入非法值时 stderr 告警并置退出码 1，不产出载荷。

## 相关页面

- [完整攻略](./guide)：架构与能力完整流程
- [配置参考](./config)：三层配置文件全部字段
- [API 参考](./api)：以上能力的库形态
