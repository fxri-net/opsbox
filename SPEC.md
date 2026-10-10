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
├── cli.ts              # 单一可执行入口：装配命令树、统一错误收口
├── index.ts            # 库出口：聚合对外能力
├── about.ts            # 工具集描述（CLI 与帮助共用）
├── errors.ts           # commander 解析错误中文化
├── help.ts             # 帮助口径统一（中文化 + 父级清单对齐）
├── prompt.ts           # 交互式口令输入
├── read-text.ts        # 文本读取 + BOM 剥离
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
└── mysql-recover/      # 能力：MySQL 库恢复
    ├── index.ts        # 能力出口
    ├── command.ts      # 命令注册
    ├── recover.ts      # 恢复编排（平台无关核心）
    ├── sdi-to-ddl.ts   # SDI → DDL 生成
    ├── mysql-client.ts # MySQL 客户端封装
    ├── report.ts       # 报告器
    ├── sql.ts          # SQL 字面量转义
    └── types.ts        # 定义集合
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

## 4. mysql-recover 能力规范

### 4.1 两阶段

- `mysql-recover ddl`：只读数据目录，从 SDI 还原建表 DDL 与产物清单，**不触碰数据库实例**。
- `mysql-recover restore`：依 DDL 产物把孤儿库文件重新挂回实例。

### 4.2 restore 阶段划分

| 阶段 | 动作 |
| --- | --- |
| Phase 0 | 停机 → 整目录冷备 → 孤儿库目录挪到 staging → 起服 |
| Phase 1 | 运行中建库建表（InnoDB 建表后追加 `DISCARD TABLESPACE`） |
| Phase 2 | 运行中把旧 `.ibd` 拷回并逐表 `IMPORT TABLESPACE` |
| Phase 3 | 停机把旧 MyISAM 的 `.MYD`/`.MYI` 换回 → 起服 |
| Phase 4 | 运行中校验（表数 / `CHECK TABLE` / 逐库体积 / 行数抽样） |

`--dry-run` 仅做前置校验并打印计划；`--skip-backup` / `--skip-validate` 分别跳过冷备与 Phase 4。

### 4.3 产物契约

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

## 5. 验收

- **单一门禁真源**：`pnpm verify` 定义全部验收步骤并按序执行，本地与 CI 共用同一份清单。
- 步骤：安装依赖（frozen 锁文件）→ 类型检查 → 静态检查（冷缓存）→ 单元测试 → 覆盖率 → 构建 → CLI 冒烟 → 任务区体检。
- 时区约定：合成数据步骤钉 `TZ=UTC`；读真实任务数据的步骤钉 `TZ=Asia/Shanghai`。
