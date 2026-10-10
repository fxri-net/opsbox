# 配置参考

> 目标读者：需要按项目定制行为的用户。字段枚举与 `src/config.ts` 解析代码同源。

## 解决什么问题

不同项目对数据目录、二进制目录、备份目录的需求不同；`.opsboxrc.json` 让这些定制随仓库走、团队共享。个人偏好（关升级提示、个人路径等）不必污染团队配置，按作用域分两处落：跨项目的放全局文件 `~/.opsboxrc.json`，仅本项目的放本地文件 `.opsboxrc.local.json`（默认不入库）。

## 配置文件三层

| 层 | 文件 | 定位方式 | 用途 |
| --- | --- | --- | --- |
| 全局层 | `~/.opsboxrc.json` | 固定路径 | 个人跨项目偏好，不随 git 分发，换机器需手动迁移 |
| 项目层 | `.opsboxrc.json` | 自 `process.cwd()` 向上逐级查找最近一份（**一路查到文件系统根**） | 团队共享配置，随仓库走 |
| 本地层 | `.opsboxrc.local.json` | 自 `process.cwd()` 向上逐级查找最近一份（**止于 home**） | 个人按项目、仅本人可见，默认被 git 忽略 |

- **各自独立查找**：项目层与本地层分别向上查找最近一份，不要求命中同一目录——monorepo 子目录只放本地文件时不会吞掉上层团队配置
- **本地层止于 home**：向上查到 `~` 即停，避免把 `~/.opsboxrc.local.json` 误当项目下的本地层命中（全局层读的是 `~/.opsboxrc.json`，两者并非一对）；⚠️ cwd 不在 home 之下时（如 Windows `D:\…`、home 在 `C:\Users\…`）该边界不触发，退化为查到盘根为止
- **命中路径可能位于仓库根之上**：向上查找不设仓库根边界，父目录散落的配置文件也会被命中

## 合并语义

- **全局层 → 项目层：段级整体覆盖**——项目配置出现的段**整体覆盖**全局同名段（非字段级深合并：项目写了某段，该段内未写的子字段也不会落到全局），项目未配的段取全局
- **项目层 → 本地层：段内字段级浅合并**——本地层只覆盖显式写出的子字段，未写的子字段保留团队值

| 层间跳变 | 粒度 | 数组字段行为 |
| --- | --- | --- |
| 全局层 → 项目层 | 段级整体覆盖 | 整体替换 |
| 项目层 → 本地层 | 段内字段级浅合并 | 整体替换（非追加） |

⚠️ 合并深度**严格一层**（段 → 字段）：字段值本身是对象时整体替换、不递归，更深的嵌套子键不会被保留。

⚠️ 本地层**不支持删除 / 清空团队键**：字段写 `null` 与未写等价（团队值保留）。

⚠️ 任一层的**段值为非对象**（如 `"updateCheck": "off"`、`"mysql-recover": 123`）时告警 + **整段按未写处理**（不覆盖 / 不顶掉其他层的同类段）。

**三层取值示例**（同一份配置在全局 / 项目 / 本地各写一段，演示两种粒度）：

```json
// ~/.opsboxrc.json（全局层）
{ "updateCheck": { "enabled": false } }

// .opsboxrc.json（项目层）
{ "mysql-recover": { "dataDir": "/srv/mysql/data", "backupDir": "/srv/backup" } }

// .opsboxrc.local.json（本地层）
{ "mysql-recover": { "stagingDir": "/tmp/opsbox-staging" } }
```

- `mysql-recover`：全局层未配该段，项目层的 `dataDir` / `backupDir` 生效；本地层**字段级浅合并**只补出 `stagingDir`，`dataDir` / `backupDir` 仍是团队值
- `updateCheck.enabled`：仅全局层写 → `false`（升级检查关闭）
- 若本地层对 `mysql-recover` 整段重写，则**只覆盖显式写出的子字段**，未写的回落项目层团队值

## 其余规则

- 覆盖链：CLI `--flag` > 环境变量 > 本地层 > 项目层 > 全局层 > 平台默认值
- 某级文件存在但非法（JSON 解析失败、或顶层非对象）：跳过该级继续向上，都不合法视为无配置。**降级不静默**：命中时 stderr 告警一次（同一进程内同一「文件 + 键」只提示一次），提示按「未配置」处理
- 配置段显式写出但类型不符（非对象）同样告警后按未配置处理
- **字段级类型校验**：`updateCheck.enabled`（须布尔）与 `mysql-recover.dataDir` / `binDir` / `backupDir` / `stagingDir`、`project-rename.backupDir`（须**非空**字符串）类型不符时 stderr 告警并**按未写处理**（回落团队值 / 默认值）；字符串写空串同样告警并按未写处理
- 带 UTF-8 BOM 的配置文件可正常解析（Windows 下 PowerShell 写出场景）
- 未找到：全部使用默认值
- 不设强制 schema/版本字段：未知字段忽略，配置项变更随版本记录于 CHANGELOG，读取向后兼容
- **配置文件中路径字段的相对路径解析基准为 `process.cwd()`**（非配置文件所在目录），monorepo 子目录运行时须留意

## 字段总览

```json
{
  "updateCheck":    { "enabled": true },
  "mysql-recover":  { "dataDir": "", "binDir": "", "backupDir": "", "stagingDir": "" },
  "project-rename": { "backupDir": "" }
}
```

## updateCheck：升级检查提示

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 升级检查总开关；`false` 时 CLI 不发起任何网络请求 |

CLI 每次命令执行时**同步读取本地缓存**，检测到新版本时向 **stderr** 输出一行升级提示；缓存不新鲜时派生一个**分离的后台子进程**联网查询 npm registry 最新版本，父进程不联网、不等待结果，**不阻塞命令、不影响退出码**。查询结果缓存在系统临时目录 `{tmpdir}/.opsbox-update-check.json`：成功结果缓存 24 小时、失败结果缓存 1 小时（避免离线环境每条命令都重试联网）。提示只来自缓存，因此首次运行只静默刷新缓存、下一次命令才提示新版本。关闭方式二选一：环境变量 `OPSBOX_NO_UPDATE_CHECK` 设为真值（`0/false/off/no` 视为未关闭，其余视为关闭），或本配置项设为 `false`（关闭后不派生后台进程、不发起任何网络请求）。

## mysql-recover：目录默认档

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `dataDir` | string | 空（取平台约定） | MySQL 数据目录；`ddl` 与 `restore` 的 `--data` 缺省值 |
| `binDir` | string | 空（取平台约定） | MySQL 二进制目录；`restore` 的 `--bin` 缺省值 |
| `backupDir` | string | 空（取平台约定） | 整目录冷备目标；`restore` 的 `--backup` 缺省值 |
| `stagingDir` | string | 空（取平台约定） | 孤儿库临时停靠目录；`restore` 的 `--staging` 缺省值 |

字段为空或未写时回落**当前平台的默认值**（见[完整攻略 · 平台适配层](./guide#平台适配层)）；命令行的 `--data` / `--bin` / `--backup` / `--staging` 优先级高于本段。

## project-rename：备份目录

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `backupDir` | string | 空（回落 `<旧路径>/.opsbox/project-rename/<时间戳>`） | 迁移前备份目录；`--backup-dir` 的缺省值 |

## 环境变量覆盖

环境变量优先级高于三层文件，是配置的最后一档覆盖（低于 CLI `--flag`）：

| 环境变量 | 目标配置键 | 说明 |
| --- | --- | --- |
| `OPSBOX_NO_UPDATE_CHECK` | `updateCheck.enabled` | 设为真值即关闭升级检查（`0/false/off/no` 视为未关闭） |

⚠️ 环境变量覆盖组与展示键清单同源（`CONFIG_ENV_OVERRIDES`）：`config status` 展示的「环境变量层」即取自本表。`config status` **一律不打印配置值**（只列来源层与命中的环境变量键名），避免个人规则、本机路径落到终端 / CI 日志。

## 相关页面

- [CLI 参考 · config](./cli#config)：`config status` 命令用法
- [完整攻略 · 三层配置体系](./guide#三层配置体系)：覆盖链与合并语义的完整说明
