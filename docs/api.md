# API 参考

> 目标读者：把本工具作为库引入 Node 项目（自动化脚本、内部平台）的开发者。导出清单与 `src/index.ts` 实际导出同源。

## 解决什么问题

CLI 面向人与 AI 交互；库形态让你把平台适配、MySQL 库恢复、项目目录改名嵌入自己的脚本或平台，而不是去解析终端输出。

## 安装与引入

```bash
pnpm add @fxri/opsbox   # 库使用时作为正式依赖
```

```typescript
import { recover, generateDdl, resolveAdapter, MysqlClient } from "@fxri/opsbox"
```

ESM 与 CJS 双形态入口（`import` / `require` 均可），随包提供类型声明。

## 元信息

| 导出 | 说明 |
| --- | --- |
| `DESCRIPTION` | 能力集定位文案（站点与包描述共用，与 `src/about.ts` 同源） |

## 平台适配层

平台差异统一收敛在 `PlatformAdapter` 端口，平台无关核心只写一份。平台在运行期探测，无需手工指定。

| 导出 | 说明 |
| --- | --- |
| `PlatformId` | 平台标识联合类型（`linux` / `darwin` / `win32`） |
| `PlatformDefaults` | 平台默认值结构（数据目录、二进制目录、服务名等） |
| `PlatformAdapter` | 平台适配器接口：探测 + 平台特有操作（停服 / 起服 / 权限复位） |
| `currentPlatformId()` | 取当前平台标识 |
| `resolveAdapter(id?)` | 按（缺省当前）平台解析适配器 |
| `DARWIN_DEFAULTS` / `LINUX_DEFAULTS` | macOS / Linux 的默认值常量 |
| `deriveWindowsDefaults()` | 派生 Windows 的默认值 |

执行与文件系统辅助（被各能力复用）：

| 导出 | 说明 |
| --- | --- |
| `run(cmd, args, opts?)` / `runOrThrow(...)` | 执行外部命令并收集结果 / 非零退出即抛错 |
| `hasCommand(name)` / `hasProcess(name)` | 探测可执行文件 / 进程是否存在 |
| `sleep(ms)` / `waitProcessExit(name, opts?)` | 延时 / 等待进程退出 |
| `RunOptions` / `RunResult` | 执行选项 / 结果结构 |
| `copyFile` / `copyTree` / `movePath` | 复制文件 / 复制目录树 / 移动路径 |
| `ensureDir` / `isDir` / `listDir` | 建目录 / 判目录 / 列目录 |
| `dirSize` / `freeSpace` / `formatSize` | 目录体积 / 剩余空间 / 体积格式化 |

## MySQL 库恢复

重装 MySQL 后，从遗留的数据目录经 SDI 还原建表 DDL（`ddl`），再把孤儿库文件重新挂回实例（`restore`）。

| 导出 | 说明 |
| --- | --- |
| `recover(opts, adapter)` | 执行恢复流程（`restore` 阶段的库形态），依 `RecoverPlan` 落位孤儿库文件 |
| `RecoverContext` / `RecoverOptions` / `RecoverPlan` | 恢复上下文 / 选项 / 执行计划结构 |
| `generateDdl(options)` | `ddl` 阶段的库形态：从数据目录的 SDI 还原建表 DDL 与产物清单，返回 `Manifest` |
| `resolveTool(name, opts?)` / `MysqlClient` | 定位 MySQL 工具可执行文件 / 连接实例执行 SQL 的客户端 |
| `MysqlClientOptions` / `MysqlExecOptions` | 客户端构造选项 / 单次执行选项 |
| `Reporter` / `ReportLevel` | 进度报告器 / 报告级别联合类型 |
| `quoteIdent(name)` / `quoteStr(value)` / `restoreGenerationExpr(...)` | 标识符转义 / 字符串转义 / 生成列表达式还原 |
| `DdlOptions` | `ddl` 阶段入参（数据目录、输出目录、ibd2sdi 路径、缓存目录、仅处理库列表） |
| `Manifest` / `ManifestTable` / `TableEntry` | 产物清单 / 清单中单表条目 / 表条目 |
| `SdiTable` / `SdiColumn` / `SdiIndex` / `SdiIndexElement` | SDI 解析后的表 / 列 / 索引 / 索引元素结构 |

## 项目目录改名

目录改名后，迁移各宿主（IDE / 编辑器）中跟随目录名的关联状态（两趟：先落计划，再续迁二进制状态）。

| 导出 | 说明 |
| --- | --- |
| `renameProject(options)` | 执行改名与迁移（受 `RenameOptions` 支配），返回结果摘要 |
| `RenameOptions` | 改名选项（旧路径、新路径、宿主限定、备份、续迁等） |
| `buildPlan(input)` | 仅构建迁移计划，不落盘（`--dry-run` 的库形态） |
| `BuildPlanInput` / `MigrationPlan` | 计划输入 / 计划结构 |
| `allHosts()` / `resolveHosts(ids?)` | 取全部检出宿主 / 按 id 解析宿主 |
| `HostAdapter` | 宿主适配器接口 |
| `VSCODE_FAMILY_VARIANTS` / `createVscodeFamilyAdapter(variant)` | VS Code 家族宿主变体表 / 按变体创建适配器 |
| `HostRoots` / `HostVariant` | 宿主根目录结构 / 宿主变体标识 |
| `Artifact` / `ArtifactKind` / `TwoPassMeta` | 迁移物结构 / 迁移物分类 / 双趟续迁元数据 |
| `pathName(p)` / `replaceUri(uri, from, to)` / `toFileUri(p)` | 取路径名 / 替换 URI 内路径 / 转 `file://` URI |

## 最小示例

```typescript
import { generateDdl, resolveAdapter } from "@fxri/opsbox"

// 取当前平台适配器，按其默认数据目录生成建表 DDL 与产物清单
const adapter = resolveAdapter()
const manifest = generateDdl({
  dataDir: adapter.defaults.dataDir,
  outDir: ".opsbox",
  ibd2sdiExe: "ibd2sdi",
  cacheDir: ".opsbox/.cache",
  only: [],
})
```

## 相关页面

- [CLI 参考](./cli)：命令行形态
- [完整攻略](./guide)：平台适配层与两个能力的完整流程
