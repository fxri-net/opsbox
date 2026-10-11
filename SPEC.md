# opsbox 规范（SPEC）

> 规范更新时间 2026-10-11。本规范内容变更时以变更时刻更新此值。

本文件定义 `@fxri/opsbox` 的结构约定与对外契约，实现方与规范快照据此对照是否失同步。协作规范沉淀于 `.tasks/conventions/`，与本文件冲突时以 `.tasks/conventions/` 为准。

## 0. 定位

- **工具集而非单脚本**：以「能力」为单位组织，一能力一目录、自注册进 CLI。
- **全平台**（C-1）：所有能力默认支持 Linux / macOS / Windows；平台差异经适配层隔离，平台无关核心只写一份。
- **不绑定宝塔**：宝塔只是其中一种运行环境，核心编排与具体安装形态无关，路径/服务名等经平台默认值提供且可覆盖。

## 1. 目录结构

```
src/
├── cli.ts              # 单一可执行入口：装配命令树、统一错误收口、升级检查接线
├── index.ts            # 库出口：聚合对外能力
├── about.ts            # 工具集描述（CLI 与帮助共用）
├── config.ts           # 三层配置加载与合并（全局 / 项目 / 本地）
├── config-status.ts    # config status 只读体检渲染
├── date.ts             # 本地时间取值单一入口（本地时区口径）
├── errors.ts           # commander 解析错误中文化
├── git-ignore.ts       # git 探测：忽略 / 仓库根 / 已跟踪判定与路径归一
├── help.ts             # 帮助口径统一（中文化 + 父级清单对齐）
├── json-output.ts      # 机器可读输出统一出口（schemaVersion 锚点）
├── prompt.ts           # 交互式口令输入
├── read-text.ts        # 文本读取 + BOM 剥离
├── update-check.ts     # 升级检查（父进程读缓存、worker 联网刷新）
├── version.ts          # registry 最新版本查询与版本号比较
├── write-atomic.ts     # 原子写文件
├── platform/           # 平台层：适配层契约 + 跨平台原语
│   ├── index.ts        # 平台层出口
│   ├── types.ts        # PlatformAdapter / PlatformDefaults / PlatformId
│   ├── detect.ts       # 运行期平台探测与适配解析
│   ├── exec.ts         # 外部命令执行（无 shell）
│   ├── fsx.ts          # 跨平台文件系统原语
│   └── adapters/
│       ├── unix.ts     # Linux / macOS 适配（含默认值）
│       └── windows.ts  # Windows 适配（含默认值）
├── mysql-recover/      # 能力：MySQL 库恢复
│   ├── index.ts        # 能力出口
│   ├── command.ts      # 命令注册
│   ├── recover.ts      # 恢复编排（平台无关核心）
│   ├── sdi-to-ddl.ts   # SDI → DDL 生成
│   ├── mysql-client.ts # MySQL 客户端封装
│   ├── report.ts       # 报告器
│   ├── sql.ts          # SQL 字面量转义
│   └── types.ts        # 定义集合
└── project-rename/     # 能力：项目目录改名与宿主状态迁移
    ├── index.ts        # 能力出口
    ├── command.ts      # 命令注册
    ├── engine.ts       # 迁移编排（平台无关核心，含双趟）
    ├── plan.ts         # 迁移计划构建
    ├── paths.ts        # URI 构造与改写原语
    ├── artifacts.ts    # 载体抽象与动作原语
    ├── sqlite.ts       # SQLite 状态库路径改写（纯 WASM 驱动）
    └── adapters/
        ├── types.ts    # HostAdapter 契约
        ├── vscode-family.ts # VS Code 系宿主适配（参数化）
        └── registry.ts # 宿主注册与解析
```

## 2. 平台层契约

### 2.1 端口（Ports）

平台无关核心**只**经 `PlatformAdapter` 调用平台特有操作，不得直接使用平台特有命令或路径。

```ts
interface PlatformAdapter {
  readonly id: PlatformId                 // "linux" | "darwin" | "win32" | "unknown"
  readonly label: string                  // 平台显示名
  readonly defaults: PlatformDefaults     // 各端默认路径 / 服务名
  stopService(name: string): Promise<void> // 停服并等待进程退出
  startService(name: string): Promise<void> // 起服（可连接性由核心经客户端探测）
  resetPermissions(target: string): Promise<void> // 权限复位
}
```

`PlatformDefaults` 字段：`dataDir`（数据目录）、`binDir`（二进制目录）、`serviceName`（服务名）、`backupDir`（冷备目标）、`stagingDir`（孤儿库停靠目录，须与数据目录同卷）、`dataOwner`（属主，unix 用；空串表示无需变更）。

### 2.2 适配器

| 端 | id | 停服 | 权限复位 |
| --- | --- | --- | --- |
| Linux | `linux` | `systemctl` → `brew services` → `mysql.server`，随后等待 `mysqld` 退出 | `chown -R <dataOwner> <target>` |
| macOS | `darwin` | 同 Linux | 无操作（`dataOwner` 为空） |
| Windows | `win32` | `sc` 失败回退 `net` | `icacls <target> /reset /T /C /Q` |

### 2.3 跨平台原语

- **命令执行**：一律以 argv 数组传参、**不经 shell**（避免 win32 下含空格参数被 shell 拆断）。
- **文件系统**：拷贝/移动/体积/可用空间等由纯 Node 实现（`fsx.ts`），各端行为一致；适配层只保留服务控制与权限复位两类平台特有操作。

## 3. CLI 契约

- **入口**：`dist/cli.js`（`bin` 名为 `opsbox`），单一入口 + 多能力自注册。
- **平台探测**：运行期完成，不依赖编译期条件或用户手工指定；未知平台以明确中文错误终止。
- **错误收口**：`exitOverride` + 缓存 commander 英文错误，命中中文映射则替换、未命中（帮助/版本）原样放行；退出码沿用 commander 的 `exitCode`。
- **帮助口径**：帮助文案中文化；父级清单条目与子命令自身 Usage 行同源。
- **口令安全**：`--password` 之外支持交互式掩码输入；非交互终端拒绝读取，避免半截输入造成误连。

## 4. 配置契约

三层配置文件，文件名以 `opsbox` 为前缀：

| 层 | 文件 | 定位方式 | 用途 |
| --- | --- | --- | --- |
| 全局层 | `~/.opsboxrc.json` | 固定路径 | 个人跨项目偏好，不随 git 分发 |
| 项目层 | `.opsboxrc.json` | 自 `process.cwd()` 向上逐级查找最近一份（一路查到文件系统根） | 团队共享，随仓库走 |
| 本地层 | `.opsboxrc.local.json` | 自 `process.cwd()` 向上逐级查找最近一份（**止于 home**） | 个人按项目、仅本人可见，默认被 git 忽略 |

- **结构**：顶层为对象，键为能力域段名；当前读取 `updateCheck`、`mysql-recover`、`project-rename` 三段，各能力域按需取自己的段。
- **合并粒度分层**：全局层 → 项目层为**段级整体覆盖**（项目写了某段即整体顶掉全局同名段，段内未写的字段也不落全局）；项目层 → 本地层为**段内字段级浅合并**（本地层只覆盖显式写出的子字段，未写的保留团队值）；合并深度严格一层，字段值为对象时整体替换、不递归。数组字段整体替换、非追加；本地层不支持删除 / 清空团队键（字段写 `null` 与未写等价）。
- **覆盖链**：CLI `--flag` > 环境变量 > 本地层 > 项目层 > 全局层 > 平台默认值。
- **降级不静默**：某级文件存在但非法（JSON 解析失败 / 顶层非对象 / 段值非对象 / 展示键类型不符）→ 跳过该级或该键，stderr 告警一次（同一进程内同一「文件 + 键」只提示一次），按未配置处理。
- **字段级校验**：展示键类型表与 `src/config.ts` 同源——`updateCheck.enabled`（布尔）、`mysql-recover.dataDir/binDir/backupDir/stagingDir`、`project-rename.backupDir`（须非空字符串）；类型不符按未写处理、回落团队值或默认值。该表 ⊇ 环境变量覆盖组目标键（不变式）。
- **环境变量覆盖组**：`OPSBOX_NO_UPDATE_CHECK` → `updateCheck.enabled`（与配置文件同源、优先级更高）。
- **忽略与自查**：本地层不作为唯一自查通道（其忽略提示可被本地层自身开关静音），由 `opsbox config status` 兜底——该提示不受任何配置开关影响。

## 5. 机器可读输出契约

- **stdout 专用通道**：机器可读 JSON 只走 stdout，一切诊断 / 提示 / 告警走 stderr（含配置降级告警、`--format` 非法告警、升级提示）。
- **统一载荷**：`toJsonText(payload)` 前置 `schemaVersion: 1` 锚点（缩进 2），消费方可据此判断结构版本；`printJson(payload)` 为其 stdout 出口。二者下沉到 `src/json-output.ts` 供各能力共用。
- **`--format` 取值**：当前仅支持 `json`；非法值 stderr 告警并置退出码 1，调用方直接 return、不产出载荷。
- **已支持命令**：`mysql-recover ddl --format json`（产物清单）、`project-rename --format json`（结果摘要）、`config status --format json`（体检报告）。`mysql-recover restore` 返回 `void`，未接入 `--format`。
- **json 模式静默**：命令在 json 模式下须抑制人类可读日志（如 project-rename 的 `quiet` 档、ddl 的 `makeLogger`），使 stdout 只含一份载荷。
- **产物清单**：`ddl` 落盘的 `manifest.json` 经 `toJsonText` 写入，携带 `schemaVersion` 锚点（`restore` 消费方以 `as Manifest` 解析，新增字段无害）。

## 6. mysql-recover 能力规范

### 6.1 两阶段

- `mysql-recover ddl`：只读数据目录，从 SDI 还原建表 DDL 与产物清单，**不触碰数据库实例**。
- `mysql-recover restore`：依 DDL 产物把孤儿库文件重新挂回实例。

### 6.2 restore 阶段划分

| 阶段 | 动作 |
| --- | --- |
| Phase 0 | 停机 → 整目录冷备 → 孤儿库目录挪到 staging → 起服 |
| Phase 1 | 运行中建库建表（InnoDB 建表后追加 `DISCARD TABLESPACE`） |
| Phase 2 | 运行中把旧 `.ibd` 拷回并逐表 `IMPORT TABLESPACE` |
| Phase 3 | 停机把旧 MyISAM 的 `.MYD`/`.MYI` 换回 → 起服 |
| Phase 4 | 运行中校验（表数 / `CHECK TABLE` / 逐库体积 / 行数抽样） |

`--dry-run` 仅做前置校验并打印计划；`--skip-backup` / `--skip-validate` 分别跳过冷备与 Phase 4。

### 6.3 产物契约

`ddl` 产物布局（`--out` 指定，默认 `.opsbox`）：

```
.opsbox/
├── ddl/
│   ├── _databases.sql        # 建库语句
│   └── <库>/<表>.sql          # 逐表 CREATE TABLE
├── manifest.json            # 产物清单（restore 的输入契约，原子写）
└── .cache/                  # ibd2sdi 结果缓存
```

`manifest.json` 至少含 `generatedAt`、`dataDir`、`libs`、`tableCount`、`tables`、`warnings`。`restore` 缺失该产物时以明确中文错误终止，提示先执行 `ddl`。

## 7. project-rename 能力规范

### 7.1 定位与边界

- 把项目目录改名，并把各宿主（IDE/编辑器）中**跟随目录名**的关联状态一并迁移到新路径。
- 只处理宿主关联状态；项目目录内的内容不动，由改名动作自身承载。
- 平台无关核心（`engine.ts` / `plan.ts`）经宿主适配层（`HostAdapter`）调用宿主特有操作。

### 7.2 载体分类

| 类别 | 处置 |
| --- | --- |
| text | 文本（含路径引用）：改写路径 |
| binary | 二进制不透明（如工作区 `state.vscdb`）：整文件搬迁，**绝不解析改写** |
| sqlite | SQLite 状态库（如全局 `state.vscdb` 的 `ItemTable`）：解析并改写含旧路径的键值，做实验性项目重关联 |
| cache | 缓存：直接丢弃，由应用按需重生成 |
| dir | 目录（如 `worktrees/`）：整体随新名搬迁 |

`sqlite` 改写经 `node-sqlite3-wasm`（纯 WASM、无需原生构建），故 `tsup` 须将其列入 `external` 保留自身路径解析。`text` / `sqlite` 之外的字节内容一律不改写。

### 7.3 双趟迁移（two-pass）

新工作区 id 不可推算，需宿主先生成新 id 目录后再做第二趟：

- **第一趟**：改写文本载体、丢弃缓存、搬迁目录、备份二进制状态，并落 `resume.json` 续迁清单，最后移动项目目录。
- **第二趟**（`--resume`）：按清单定位宿主生成的新 id 目录，把二进制状态副本落位并清理旧工作区目录。

### 7.4 备份与回滚

- 备份目录默认 `<旧路径>/.opsbox/project-rename/<时间戳>`，随目录改名移动到 `<新路径>` 下。
- `resume.json` 记录二进制备份**相对本目录**的路径，保证改名后仍可解析。
- `--backup-dir` 可指定备份根；`--no-backup` 跳过备份（危险：将无法回滚）。

### 7.5 宿主适配

- 契约：`HostAdapter { readonly id; readonly label; detect(): boolean; scan(oldPath, newPath): Artifact[] }`。
- 首发 VS Code 系宿主（参数化适配 `vscode-family`）：Trae CN / Trae / VS Code / Cursor / Windsurf / VSCodium，共享 `User/`（`workspaceStorage`、`History`、`globalStorage`）与用户数据根下 `worktrees/`、`hub_event_cache/`、`mcps/` 布局。
- 会话 / 任务正文绑定工作区身份、不可文件层搬运；本能力只改写宿主中的**项目关联引用**（如 `globalStorage/state.vscdb` 的 `solo-lite.local-project-folders`），使新路径被识别为同一项目（实验性重关联，尽力而为）。
- `<用户数据根>/mcps/s_<目录名>-<8位hash>/` 为宿主自动生成的 MCP 工具描述，改名后旧目录作残留按缓存丢弃，新目录由宿主重建。
- `--host <id>` 限定宿主（可多次传入）；缺省迁移全部已检出宿主。误纳无关工作区以 `workspace.json` 的 `folder` 严格匹配新/旧 URI 规避。
- ⚠️ 迁移前须先关闭目标宿主，避免其改写状态文件造成竞争。

## 8. 验收

- **单一门禁真源**：`pnpm verify` 定义全部验收步骤并按序执行，本地与 CI 共用同一份清单。
- 步骤：安装依赖（frozen 锁文件）→ 类型检查 → 静态检查（冷缓存）→ 单元测试 → 覆盖率 → 构建 → CLI 冒烟（各命令 `--help` + `config status`）。
- 时区约定：合成数据步骤钉 `TZ=UTC`。
- 冒烟步骤 `config status` 钉 `OPSBOX_NO_UPDATE_CHECK=1`：只读体检退出码恒 0，且门禁须无外部依赖、可重复（不派生联网 worker）。
