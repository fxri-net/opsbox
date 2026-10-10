# 完整攻略

> 目标读者：已在用本工具集、想了解整体架构与进阶用法的用户。

## 解决什么问题

新手指南只覆盖最短路径；本篇回答日常使用的全部问题：能力怎么组织、平台差异怎么隔离、两个能力各自的完整流程、三层配置怎么合并、机器可读输出怎么消费、升级提示怎么关。

## 架构总览

工具集而非单脚本：以「能力」为单位组织，一能力一目录、自注册进单一 CLI 入口。

```
src/
├── cli.ts              # 单一可执行入口：装配命令树、统一错误收口、升级检查接线
├── index.ts            # 库出口：聚合对外能力
├── config.ts           # 三层配置加载与合并（全局 / 项目 / 本地）
├── platform/           # 平台层：适配层契约 + 跨平台原语
├── mysql-recover/      # 能力：MySQL 库恢复
└── project-rename/     # 能力：项目目录改名与宿主状态迁移
```

- **单一入口 + 多能力自注册**：`dist/cli.js`（`bin` 名 `opsbox`）装配命令树，各能力在自己的目录里注册命令，新增能力不动其余代码
- **平台运行期探测**：不依赖编译期条件或用户手工指定；未知平台以明确中文错误终止
- **库出口与 CLI 同源**：`src/index.ts` 聚合对外能力，作为库引入时与 CLI 共享同一份实现

## 平台适配层

平台无关核心**只**经 `PlatformAdapter` 调用平台特有操作，不得直接使用平台特有命令或路径。

| 端 | id | 停服 | 权限复位 |
| --- | --- | --- | --- |
| Linux | `linux` | `systemctl` → `brew services` → `mysql.server`，随后等待 `mysqld` 退出 | `chown -R <属主> <目标>` |
| macOS | `darwin` | 同 Linux | 无操作（属主为空） |
| Windows | `win32` | `sc` 失败回退 `net` | `icacls <目标> /reset /T /C /Q` |

`PlatformDefaults` 字段：`dataDir`（数据目录）、`binDir`（二进制目录）、`serviceName`（服务名）、`backupDir`（冷备目标）、`stagingDir`（孤儿库停靠目录，须与数据目录同卷）、`dataOwner`（属主，unix 用；空串表示无需变更）。

两条跨平台原语纪律：

- **命令执行一律以 argv 数组传参、不经 shell**，避免 win32 下含空格参数被 shell 拆断
- **文件系统操作**（拷贝 / 移动 / 体积 / 可用空间等）由纯 Node 实现，各端行为一致；适配层只保留服务控制与权限复位两类平台特有操作

## MySQL 库恢复（mysql-recover）

分两阶段：`ddl` 只读数据目录、不触碰实例；`restore` 依产物把孤儿库文件重新挂回实例。

### 阶段一：ddl（只读）

从数据目录的 SDI 还原逐表建表 DDL 与产物清单：

```bash
node dist/cli.js mysql-recover ddl --data <数据目录> --out .opsbox
```

产物布局（`--out` 指定，默认 `.opsbox`）：

```
.opsbox/
├── ddl/
│   ├── _databases.sql        # 建库语句
│   └── <库>/<表>.sql          # 逐表 CREATE TABLE
├── manifest.json            # 产物清单（restore 的输入契约，原子写）
└── .cache/                  # ibd2sdi 结果缓存
```

`manifest.json` 至少含 `generatedAt`、`dataDir`、`libs`、`tableCount`、`tables`、`warnings`；`--only <库>` 可只处理指定库（可多次传入）。

### 阶段二：restore（挂回实例）

依 DDL 产物把孤儿库文件重新挂回 MySQL 实例，分五个阶段：

| 阶段 | 动作 |
| --- | --- |
| Phase 0 | 停机 → 整目录冷备 → 孤儿库目录挪到 staging → 起服 |
| Phase 1 | 运行中建库建表（InnoDB 建表后追加 `DISCARD TABLESPACE`） |
| Phase 2 | 运行中把旧 `.ibd` 拷回并逐表 `IMPORT TABLESPACE` |
| Phase 3 | 停机把旧 MyISAM 的 `.MYD` / `.MYI` 换回 → 起服 |
| Phase 4 | 运行中校验（表数 / `CHECK TABLE` / 逐库体积 / 行数抽样） |

```bash
node dist/cli.js mysql-recover restore --work .opsbox --user root
```

- `--dry-run` 仅做前置校验并打印计划
- `--skip-backup` / `--skip-validate` 分别跳过冷备与 Phase 4
- `--password` 之外支持交互式掩码输入；非交互终端拒绝读取，避免半截输入造成误连
- `restore` 缺失 `manifest.json` 产物时以明确中文错误终止，提示先执行 `ddl`

## 项目目录改名（project-rename）

把项目目录改名，并把各宿主（IDE / 编辑器）中**跟随目录名**的关联状态一并迁移到新路径。项目目录内的内容不动，由改名动作自身承载。

### 载体分类

| 类别 | 处置 |
| --- | --- |
| text | 文本（含路径引用）：改写路径 |
| binary | 二进制不透明（如工作区 `state.vscdb`）：整文件搬迁，**绝不解析改写** |
| sqlite | SQLite 状态库（如全局 `state.vscdb` 的 `ItemTable`）：解析并改写含旧路径的键值，做实验性项目重关联 |
| cache | 缓存：直接丢弃，由应用按需重生成 |
| dir | 目录（如 `worktrees/`）：整体随新名搬迁 |

### 双趟迁移

新工作区 id 不可推算，需宿主先生成新 id 目录后再做第二趟：

```bash
# 第一趟：改写文本载体、丢弃缓存、搬迁目录、备份二进制状态，落 resume.json，最后移动项目目录
node dist/cli.js project-rename <旧路径> <新路径>

# 第二趟：按清单定位宿主生成的新 id 目录，落位二进制状态副本并清理旧工作区目录
node dist/cli.js project-rename <旧路径> <新路径> --resume
```

- `--dry-run` 仅输出迁移计划、不落盘；`--yes` 跳过交互确认
- `--host <id>` 限定宿主（可多次传入；缺省迁移全部已检出宿主）
- `--backup-dir <dir>` 指定备份根；`--no-backup` 跳过备份（危险：将无法回滚）
- 备份目录默认 `<旧路径>/.opsbox/project-rename/<时间戳>`，随目录改名移动到 `<新路径>` 下；`resume.json` 记录二进制备份**相对本目录**的路径，保证改名后仍可解析

### 宿主适配

- 契约：`HostAdapter { readonly id; readonly label; detect(): boolean; scan(oldPath, newPath): Artifact[] }`
- 首发 VS Code 系宿主（参数化适配）：Trae CN / Trae / VS Code / Cursor / Windsurf / VSCodium，共享 `User/`（`workspaceStorage`、`History`、`globalStorage`）与用户数据根下 `worktrees/`、`hub_event_cache/`、`mcps/` 布局
- 会话 / 任务正文绑定工作区身份、不可文件层搬运；本能力只改写宿主中的**项目关联引用**，使新路径被识别为同一项目（实验性重关联，尽力而为）

⚠️ **迁移前须先关闭目标宿主**，避免其改写状态文件造成竞争。

## 三层配置体系

| 层 | 文件 | 定位方式 | 用途 |
| --- | --- | --- | --- |
| 全局层 | `~/.opsboxrc.json` | 固定路径 | 个人跨项目偏好，不随 git 分发 |
| 项目层 | `.opsboxrc.json` | 自 `process.cwd()` 向上逐级查找最近一份 | 团队共享，随仓库走 |
| 本地层 | `.opsboxrc.local.json` | 自 `process.cwd()` 向上逐级查找最近一份（**止于 home**） | 个人按项目、仅本人可见，默认被 git 忽略 |

合并粒度**分层**：

- 全局层 → 项目层：**段级整体覆盖**（项目写了某段即整体顶掉全局同名段）
- 项目层 → 本地层：**段内字段级浅合并**（本地层只覆盖显式写出的子字段）
- 合并深度严格一层，字段值为对象时整体替换、不递归；数组字段整体替换、非追加

覆盖链：CLI `--flag` > 环境变量 > 本地层 > 项目层 > 全局层 > 平台默认值。

**降级不静默**：某级文件存在但非法（JSON 解析失败 / 顶层非对象 / 段值非对象 / 展示键类型不符）→ 跳过该级或该键，stderr 告警一次并按未配置处理。

字段与示例见[配置参考](./config)。

## 机器可读输出

关键命令的 JSON 载荷统一走 stdout，供脚本消费。

- **stdout 专用通道**：机器可读 JSON 只走 stdout，一切诊断 / 提示 / 告警走 stderr
- **统一载荷**：前置 `schemaVersion: 1` 锚点（缩进 2），消费方可据此判断结构版本
- **`--format` 取值**：当前仅支持 `json`；非法值 stderr 告警并置退出码 1，不产出载荷
- **json 模式静默**：命令在 json 模式下抑制人类可读日志，使 stdout 只含一份载荷

```bash
node dist/cli.js config status --format json
node dist/cli.js mysql-recover ddl --data <数据目录> --format json
node dist/cli.js project-rename <旧路径> <新路径> --format json
```

⚠️ `ddl` 落盘的 `manifest.json` 经同一出口写入、携带 `schemaVersion` 锚点；`restore` 返回 `void`，未接入 `--format`。

## 升级检查提示

CLI 每次命令执行时**同步读取本地缓存**，检测到新版本时向 **stderr** 输出一行升级提示；缓存不新鲜时派生一个**分离的后台子进程**联网查询 registry 最新版本，父进程不联网、不等待结果，**不阻塞命令、不影响退出码**。查询结果缓存在系统临时目录，成功结果缓存 24 小时、失败结果缓存 1 小时。

关闭方式二选一：

```bash
OPSBOX_NO_UPDATE_CHECK=1 node dist/cli.js --help    # 环境变量
```

或在配置里写 `"updateCheck": { "enabled": false }`（关闭后不派生后台进程、不发起任何网络请求）。

## 验收门禁

**单一门禁真源**：`pnpm verify` 定义全部验收步骤并按序执行，本地与 CI 共用同一份清单。

```
安装依赖（frozen 锁文件）→ 类型检查 → 静态检查（冷缓存）→ 单元测试 → 覆盖率
  → 构建 → CLI 冒烟（各命令 --help + config status）→ 任务区体检
```

时区约定：合成数据步骤钉 `TZ=UTC`；读真实任务数据的步骤钉 `TZ=Asia/Shanghai`。冒烟步骤 `config status` 钉 `OPSBOX_NO_UPDATE_CHECK=1`，保证门禁无外部依赖、可重复。

## 环境与版本兼容

- 环境要求 Node.js >= 20.19.0（`engines.node` 同源，见 `package.json`）
- 依赖：`commander`（命令树）、`node-sqlite3-wasm`（`project-rename` 的 SQLite 改写经纯 WASM 驱动，无需原生构建）
- 构建：`tsup` 产出 cjs + esm 双格式与 dts；`node-sqlite3-wasm` 须列入 `external` 保留自身路径解析

## 相关页面

- [新手指南](./getting-started)：安装与最短路径
- [操作手册](./handbook)：每个能力该说什么、做什么
- [CLI 参考](./cli)：命令字典
- [API 参考](./api)：能力的库形态
- [配置参考](./config)：三层配置全部字段
